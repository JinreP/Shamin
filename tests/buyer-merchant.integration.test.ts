import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, type Document } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createBuyerMerchantGateway } from "../lib/buyer-merchant-client";
import { BuyerMerchantWorkflow, BuyerWorkflowError } from "../lib/buyer-merchant-workflow";
import { authenticateA2A } from "../merchant/a2a/auth";
import { calculateMerchantRFQ } from "../merchant/a2a/engine";
import { loadScopedRFQContext } from "../merchant/a2a/data";
import { getA2AMerchantDirectory, merchantAgentCardJSON } from "../merchant/a2a/cards";
import { handleMerchantA2A } from "../merchant/a2a/transport";
import { createMerchantRFQProcessor } from "../merchant/a2a/service";
import { handleCommerceMCP } from "../merchant/commerce/mcp";
import { CommerceStore } from "../merchant/commerce/store";
import { seedDemoMerchants } from "../merchant/server/seed";
import { closeMerchantConnection } from "../merchant/server/database";
import { quoteSchema } from "../shared/merchant-contracts";

test("Buyer uses official A2A/MCP SDKs with persisted request ownership and explicit approval", {
  skip: process.env.BUYER_MERCHANT_LOCAL_INTEGRATION !== "true", timeout: 180_000,
}, async t => {
  // Created by this test only: never uses a shared URI or loads .env.local.
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger", ip: "127.0.0.1" } });
  const client = await new MongoClient(replica.getUri()).connect();
  const db = client.db("buyer_merchant_disposable");
  const oldEnv = { ...process.env };
  const origin = "http://localhost:3000", token = "test-service-token-with-at-least-32-characters", buyerId = "demo-buyer-test";
  const env = { NODE_ENV: "test", BUYER_MERCHANT_ORIGIN: origin, BUYER_MERCHANT_BUYER_ID: buyerId,
    MERCHANT_A2A_ORIGIN: origin, MERCHANT_A2A_AUTH_MODE: "demo", MERCHANT_A2A_DEMO_ENABLED: "true",
    MERCHANT_A2A_DEMO_TOKEN: token, MERCHANT_A2A_DEMO_BUYER_ID: buyerId,
    MERCHANT_MCP_ENABLED: "true", MERCHANT_MCP_AUTH_MODE: "token", MERCHANT_MCP_TOKEN: token,
    MERCHANT_MCP_BUYER_ID: buyerId, MERCHANT_MCP_MERCHANT_IDS: "demo-prius-parts,demo-japan-used,demo-oem-center,demo-auto-care,demo-quick-garage",
    MERCHANT_MCP_APPROVAL_ORIGIN: origin, MONGODB_URI: replica.getUri(), MONGODB_DB: db.databaseName };
  Object.assign(process.env, env);
  const processor = createMerchantRFQProcessor(async () => ({ client, db }));
  const fetchHandler: typeof fetch = async (input, init) => {
    const request = new Request(input, init), path = new URL(request.url).pathname;
    if (path === "/api/a2a/discovery") return Response.json(getA2AMerchantDirectory(origin));
    if (path === "/api/mcp/commerce") return handleCommerceMCP(request);
    const route = /^\/api\/a2a\/([^/]+)(\/\.well-known\/agent-card\.json)?$/.exec(path);
    if (!route) return new Response(null, { status: 404 });
    if (route[2]) return Response.json(merchantAgentCardJSON(route[1], origin));
    return handleMerchantA2A(request, route[1], { origin, processRFQ: processor,
      authenticate: (request, merchantId) => authenticateA2A(request, merchantId, env) });
  };
  const gateway = createBuyerMerchantGateway(env, fetchHandler);
  const workflow = new BuyerMerchantWorkflow(db, "owner-a", gateway);
  const goal = { vehicle: "Toyota Prius 30", parts: "Урд бампер, зүүн урд гэрэл", tasks: "Солих, бампер будах", budget: 2_000_000, days: 30, preference: "Any" };
  async function draft(ownerId = "owner-a") {
    const id = randomUUID();
    await db.collection<Document & { _id: string }>("repairRequests").insertOne({ _id: id, ownerId, status: "draft", version: 1, quotes: [], updatedAt: new Date() });
    return id;
  }
  try {
    await seedDemoMerchants(client, db);
    await db.collection("merchant_settings").updateMany({}, { $set: { humanApprovalRequired: false, automaticNegotiationEnabled: true } });

    const foreignId = await draft("owner-b");
    await t.test("foreign owner and incomplete goals cannot obtain repair bundles", async () => {
      await assert.rejects(() => workflow.quotes(foreignId, goal), BuyerWorkflowError);
      const id = await draft();
      const result = await workflow.quotes(id, { ...goal, tasks: "Хөдөлгүүр солих" });
      assert.equal(result.quotes.length, 0);
    });

    const id = await draft();
    const offers = await workflow.quotes(id, goal);
    assert.equal(offers.quotes.length, 6);
    const offered = offers.quotes[0];
    assert.equal(offered.parts + offered.labor, offered.total);
    assert.ok(offered.merchant);

    await t.test("negotiation updates merchant revisions and invalidates overlapping old combinations", async () => {
      const result = await workflow.negotiate(id, offered.token, offered.total - 10_000);
      assert.equal(result.pending, false);
      assert.equal(result.quote.revision, 2);
      assert.ok(result.quote.total <= offered.total);
      const saved = await db.collection<Document & { _id: string }>("repairRequests").findOne({ _id: id });
      assert.ok(saved?.quotes.some((quote: { expiresAt: number }) => quote.expiresAt === 0));
      assert.notEqual(result.quote.token, offered.token);
    });

    const saved = await db.collection<Document & { _id: string }>("repairRequests").findOne({ _id: id });
    const selected = saved!.selectedQuote;
    const commerceStore = new CommerceStore(client, db, origin);
    let checkout: { approvalUrl?: string; transactionId: string };
    await t.test("Confirm creates only an approval link, never an order before the user approves", async () => {
      const result = await workflow.confirm(id, selected.token, selected.total);
      assert.ok("checkout" in result && result.checkout);
      checkout = result.checkout;
      assert.equal(await db.collection("merchant_parts_orders").countDocuments(), 0);
      assert.equal(await db.collection("merchant_repair_bookings").countDocuments(), 0);
      const again = await workflow.confirm(id, selected.token, selected.total);
      assert.ok("checkout" in again);
      assert.equal(again.checkout?.transactionId, checkout.transactionId);
      assert.equal(await db.collection("merchant_commerce_approvals").countDocuments(), 1);
      await assert.rejects(() => workflow.quotes(id, goal), BuyerWorkflowError);
      await assert.rejects(() => workflow.confirm(id, selected.token, selected.total + 1), BuyerWorkflowError);
    });

    await t.test("explicit approval is followed by a persisted order, booking, mock payment and idempotent receipt", async () => {
      const challenge = new URL(checkout!.approvalUrl!).pathname.split("/").pop()!;
      await commerceStore.approveByChallenge(challenge, "approve"); // Models the user's explicit page action.
      const result = await workflow.confirm(id, selected.token, selected.total);
      assert.ok("receipt" in result && result.receipt);
      assert.equal(result.receipt.source, "merchant");
      assert.equal(result.receipt.quote.total, selected.total);
      const again = await workflow.confirm(id, selected.token, selected.total);
      assert.deepEqual(again, result);
      assert.equal(await db.collection("merchant_parts_orders").countDocuments(), 1);
      assert.equal(await db.collection("merchant_repair_bookings").countDocuments(), 1);
      assert.equal(await db.collection("merchant_mock_payments").countDocuments(), 1);
      assert.equal((await db.collection<Document & { _id: string }>("repairRequests").findOne({ _id: id }))?.status, "completed");
    });

    await t.test("pending human negotiations survive retries without generating new IDs", async () => {
      await db.collection("merchant_settings").updateMany({}, { $set: { humanApprovalRequired: true } });
      const pendingId = await draft(), offers = await workflow.quotes(pendingId, goal), offer = offers.quotes[0];
      const target = offer.total - 10000;
      const first = await workflow.negotiate(pendingId, offer.token, target);
      assert.equal(first.pending, true);
      const before = await db.collection<Document & { _id: string }>("repairRequests").findOne({ _id: pendingId });
      const again = await workflow.negotiate(pendingId, offer.token, target);
      assert.equal(again.pending, true);
      const after = await db.collection<Document & { _id: string }>("repairRequests").findOne({ _id: pendingId });
      assert.deepEqual(after?.pendingNegotiation.inputs, before?.pendingNegotiation.inputs);
      await assert.rejects(() => workflow.negotiate(pendingId, offer.token, target - 1), BuyerWorkflowError);
      await assert.rejects(() => workflow.confirm(pendingId, offer.token, offer.total), BuyerWorkflowError);
    });

    await t.test("assessment routes only to repair shops and completes a standalone human repair booking", async () => {
      const repairRequestId = await draft();
      const assessment = { sourceDocumentRef: "assessment-doc-1", sourceDocument: "Toyota Prius 30 damage report",
        damageItems: [{ id: "damage-bumper", component: "Урд гупер", description: "Хагарсан",
          assessmentAmount: { amountMinor: 45000000, currency: "MNT" }, imageRefs: ["data:image/png;base64,aGVsbG8="] }],
        totalAssessmentAmount: { amountMinor: 45000000, currency: "MNT" }, notes: "Ослын үнэлгээ" };
      const initial = await workflow.quotes(repairRequestId, goal, assessment);
      assert.equal(initial.quotes.length, 0);
      const buyerRequest = await db.collection<Document & { _id: string }>("repairRequests").findOne({ _id: repairRequestId });
      assert.ok(buyerRequest?.quoteBatchId);
      const repairIds = ["demo-auto-care", "demo-quick-garage"];
      const repairRFQs = await db.collection("merchant_rfq_processing").find({
        merchantId: { $in: repairIds }, id: { $in: repairIds.map(id => `rfq-${buyerRequest!.quoteBatchId}-${id}`) },
      }).toArray();
      assert.equal(repairRFQs.length, 2);
      assert.ok(repairRFQs.every(record => record.envelope.rfq.kind === "repair" &&
        record.envelope.rfq.damageAssessment.damageItems[0].assessmentAmount.amountMinor === 45000000 &&
        record.envelope.rfq.damageAssessment.damageItems[0].imageRefs.length === 1));
      assert.equal(await db.collection("merchant_rfq_processing").countDocuments({
        id: { $regex: `^rfq-${buyerRequest.quoteBatchId}-` }, merchantId: { $in: ["demo-prius-parts", "demo-japan-used", "demo-oem-center"] },
      }), 0);

      for (const merchantId of repairIds) {
        const rfqId = `rfq-${buyerRequest.quoteBatchId}-${merchantId}`;
        const session = client.startSession();
        let context;
        try {
          context = await session.withTransaction(() => loadScopedRFQContext(db, merchantId, rfqId, session));
        } finally { await session.endSession(); }
        assert.ok(context);
        const automatic = calculateMerchantRFQ(merchantId, { ...context.envelope,
          rfq: { ...context.envelope.rfq, humanOfferRequired: false } }, context.data, new Date(context.envelope.rfq.createdAt));
        assert.ok(automatic.quote && automatic.serviceWindow);
        const repairEstimate = { laborPrice: automatic.quote.total, partsPrice: null, totalPrice: automatic.quote.total,
          customerSuppliedPartsAccepted: true, estimatedDuration: "1 өдөр", earliestAvailableAt: automatic.serviceWindow.startsAt,
          notes: "Сэлбэгээ өөрөө авчирна." };
        const humanQuote = quoteSchema.parse({ ...automatic.quote, repairEstimate });
        await db.collection("merchant_quotes").insertOne(humanQuote);
        await db.collection("merchant_quote_publications").insertOne({ contractVersion: "1", id: humanQuote.id, merchantId,
          rfqId, buyerId, quoteId: humanQuote.id, quoteRevision: humanQuote.revision, source: "human_confirmed",
          status: "published", correlationId: context.envelope.correlationId, createdAt: humanQuote.createdAt,
          serviceWindow: automatic.serviceWindow });
        const slot = context.data.slots.find(item => item.startsAt === automatic.serviceWindow!.startsAt &&
          item.endsAt === automatic.serviceWindow!.endsAt);
        assert.ok(slot);
        await db.collection("merchant_telegram_drafts").insertOne({ contractVersion: "1", id: `buyer-repair-draft-${merchantId}`,
          merchantId, rfqId, quoteId: humanQuote.id, quoteRevision: humanQuote.revision, status: "confirmed",
          createdAt: humanQuote.createdAt, draft: { lines: humanQuote.lines.map((line, itemIndex) => ({ itemIndex,
            resourceId: line.resourceId, quantity: line.quantity, unitPrice: line.unitPrice, condition: null, available: true, warranty: null })),
            slotId: slot.id, repairEstimate: { laborPrice: humanQuote.total, partsPrice: null, customerSuppliedPartsAccepted: true,
              estimatedDuration: "1 өдөр", earliestAvailableAt: automatic.serviceWindow.startsAt, notes: "Сэлбэгээ өөрөө авчирна." },
            repairNegotiationPolicy: { floorPrice: { amountMinor: 10000000, currency: "MNT" }, humanApprovalBelow: null,
              automaticNegotiationEnabled: true, maxRounds: 3 } } });
      }

      const refreshed = await workflow.quotes(repairRequestId, goal, assessment);
      assert.equal(refreshed.quotes.length, 2);
      assert.ok(refreshed.quotes.every(offer => offer.merchant && !("parts" in offer.merchant)));
      const standalone = refreshed.quotes[0];
      assert.ok(standalone.merchant && !("parts" in standalone.merchant));
      assert.equal(standalone.total, standalone.merchant.repair.quote.total.amountMinor / 100);
      assert.equal(standalone.merchant.repair.quote.repairEstimate?.partsPrice, null);

      const negotiated = await workflow.negotiate(repairRequestId, standalone.token, standalone.total - 10000);
      assert.equal(negotiated.pending, false);
      assert.ok(negotiated.quote.merchant && !("parts" in negotiated.quote.merchant));
      const checkout = await workflow.confirm(repairRequestId, negotiated.quote.token, negotiated.quote.total);
      assert.ok("checkout" in checkout && checkout.checkout?.approvalUrl);
      const challenge = new URL(checkout.checkout.approvalUrl).pathname.split("/").pop()!;
      await new CommerceStore(client, db, origin).approveByChallenge(challenge, "approve");
      const completed = await workflow.confirm(repairRequestId, negotiated.quote.token, negotiated.quote.total);
      assert.ok("receipt" in completed && completed.receipt);
      assert.equal(completed.receipt.orderId, undefined);
      const booking = await db.collection("merchant_repair_bookings").findOne({ transactionId: checkout.checkout.transactionId });
      assert.ok(booking);
      assert.equal(booking.repairEstimate.partsPrice, null);
      assert.equal(booking.repairEstimate.totalPrice.amountMinor, Math.round(negotiated.quote.total * 100));
      assert.equal(await db.collection("merchant_parts_orders").countDocuments({ transactionId: checkout.checkout.transactionId }), 0);
      assert.ok(!JSON.stringify(completed).includes("floorPrice"));
    });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
    await closeMerchantConnection();
    await client.close();
    await replica.stop();
  }

});
