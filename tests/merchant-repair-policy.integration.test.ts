import { test } from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoRFQStore } from "../merchant/a2a/store";
import { calculateMerchantRFQ } from "../merchant/a2a/engine";
import type { MerchantRFQEnvelope } from "../merchant/a2a/contracts";
import { NegotiationStore } from "../merchant/negotiation/store";
import { negotiateQuoteRequestSchema } from "../merchant/negotiation/contracts";
import { seedDemoMerchants } from "../merchant/server/seed";
import { TelegramMerchantStore } from "../merchant/telegram/store";
import { createTelegramRuntime } from "../merchant/telegram/service";
import { readTelegramConfig } from "../merchant/telegram/config";
import type { TelegramAPI } from "../merchant/telegram/api";
import type { AIProvider } from "../merchant/server/providers";
import { quoteSchema, type Quote } from "../shared/merchant-contracts";

test("repair quote keeps human floor private, escalates, and caps rounds in MongoDB", {
  skip: process.env.MERCHANT_REPAIR_POLICY_INTEGRATION !== "true", timeout: 180000,
}, async () => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger", ip: "127.0.0.1" } });
  const client = new MongoClient(replica.getUri()), db = client.db("merchant_repair_policy_disposable");
  const merchantId = "demo-auto-care", buyerId = "repair-policy-buyer", rfqId = "repair-policy-rfq";
  const mnt = (amount: number) => ({ amountMinor: amount * 100, currency: "MNT" });
  try {
    await client.connect();
    await seedDemoMerchants(client, db);
    for (const slot of await db.collection("merchant_slots").find({ merchantId }).toArray()) {
      const startsAt = new Date(Date.now() + 86400000);
      await db.collection("merchant_slots").updateOne({ merchantId, id: slot.id }, { $set: {
        startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 8 * 3600000).toISOString(),
      } });
    }

    const input: MerchantRFQEnvelope = { contractVersion: "1", correlationId: `corr-${rfqId}`,
      expiresAt: new Date(Date.now() + 3600000).toISOString(), rfq: { contractVersion: "1", id: rfqId, merchantId,
        buyerId, createdAt: new Date(Date.now() - 1000).toISOString(), kind: "repair",
        vehicle: { make: "Toyota", model: "Prius 30", year: 2012 },
        items: [{ description: "Гупер солих", quantity: 1 }], status: "received" } };
    const initialResponse = await new MongoRFQStore(client, db).processOnce(merchantId, buyerId, input,
      (data, now) => calculateMerchantRFQ(merchantId, input, data, now));
    assert.ok(initialResponse.quote);
    const quote = quoteSchema.parse({ ...initialResponse.quote,
      lines: initialResponse.quote.lines.map(line => ({ ...line, unitPrice: mnt(380000) })),
      total: mnt(380000), repairEstimate: { laborPrice: mnt(380000), partsPrice: null, totalPrice: mnt(380000),
        customerSuppliedPartsAccepted: true, estimatedDuration: "1 өдөр", earliestAvailableAt: null,
        notes: "Сэлбэгээ өөрөө авчирна." } });
    input.rfq.humanOfferRequired = true;
    await db.collection("merchant_quotes").replaceOne({ merchantId, id: quote.id, revision: quote.revision }, quote);
    await db.collection("merchant_rfq_processing").updateOne({ merchantId, id: rfqId }, {
      $set: { "envelope.rfq.humanOfferRequired": true, "response.quote": quote },
    });
    const storedRFQ = await db.collection("merchant_rfq_processing").findOne({ merchantId, id: rfqId });
    const slot = await db.collection("merchant_slots").findOne({ merchantId, serviceIds: quote.lines[0].resourceId,
      startsAt: storedRFQ?.response?.serviceWindow?.startsAt, endsAt: storedRFQ?.response?.serviceWindow?.endsAt });
    assert.ok(slot);
    await db.collection("merchant_telegram_drafts").insertOne({ contractVersion: "1", id: "repair-policy-confirmed-draft",
      merchantId, rfqId, quoteId: quote.id, quoteRevision: quote.revision, status: "confirmed", createdAt: new Date().toISOString(),
      draft: { lines: quote.lines.map((line, itemIndex) => ({ itemIndex, resourceId: line.resourceId, quantity: line.quantity,
        unitPrice: line.unitPrice, condition: null, available: true, warranty: null })), slotId: slot.id,
        repairEstimate: { laborPrice: mnt(380000), partsPrice: null, customerSuppliedPartsAccepted: true,
          estimatedDuration: "1 өдөр", earliestAvailableAt: null, notes: "Сэлбэгээ өөрөө авчирна." },
        repairNegotiationPolicy: { floorPrice: mnt(330000), humanApprovalBelow: mnt(350000),
          automaticNegotiationEnabled: true, maxRounds: 3 } } });
    await db.collection("merchant_settings").updateOne({ merchantId, id: merchantId }, { $set: {
      negotiationEnabled: true, humanApprovalRequired: false, automaticNegotiationEnabled: true, maxNegotiationRounds: 5,
    } });

    const request = (quoteVersion: Quote, id: string, total: number) => negotiateQuoteRequestSchema.parse({
      contractVersion: "1", action: "negotiate_quote", rfqId, correlationId: input.correlationId,
      expiresAt: new Date(Date.now() + 600000).toISOString(), negotiation: { contractVersion: "1", id, merchantId,
        buyerId, createdAt: new Date(Date.now() - 1000).toISOString(), quoteId: quoteVersion.id,
        quoteRevision: quoteVersion.revision, requestedTotal: mnt(total), status: "requested" },
    });
    const negotiations = new NegotiationStore(client, db);
    const belowFloor = await negotiations.submit(merchantId, buyerId, request(quote, "repair-policy-below-floor", 320000));
    assert.equal(belowFloor.outcome, "rejected"); assert.equal(belowFloor.code, "price_rejected");
    assert.ok(!JSON.stringify(belowFloor).includes("33000000"));

    const pending = await negotiations.submit(merchantId, buyerId, request(quote, "repair-policy-escalation", 340000));
    assert.equal(pending.outcome, "pending");
    const processing = await db.collection("merchant_negotiation_processing")
      .findOne({ merchantId, id: "repair-policy-escalation" });
    assert.ok(processing?.telegramHandle); assert.equal(processing.notificationStatus, "pending");
    assert.ok(!JSON.stringify(pending).includes("33000000"));
    const telegramStore = new TelegramMerchantStore(client, db);
    const invite = await telegramStore.issueInvite(merchantId, "59101", "demo", "repair-policy-admin");
    const binding = await telegramStore.bind(invite.token, "59101", "59101", "demo");
    const telegram: TelegramAPI = { async sendMessage() { return { message_id: 1 }; }, async answerCallbackQuery() {},
      async getMe() { return { id: 123456, is_bot: true }; }, async deleteWebhook() {}, async setWebhook() {},
      async getUpdates() { return []; }, async getWebhookInfo() { return { url: "", pending_update_count: 0 }; } };
    const ai: AIProvider = { async generate() { throw new Error("Unexpected AI request in repair policy test"); } };
    const runtime = createTelegramRuntime({ client, db, telegram, ai,
      config: readTelegramConfig({ NODE_ENV: "test", MERCHANT_TELEGRAM_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyz_test_token", MERCHANT_TELEGRAM_AUTH_MODE: "demo",
        MERCHANT_TELEGRAM_DEMO_ENABLED: "true" }) });
    await runtime.flushNotifications();
    const notified = await db.collection("merchant_negotiation_processing")
      .findOne({ merchantId, id: "repair-policy-escalation" });
    assert.equal(notified?.notificationBindingId, binding.id);
    const humanResult = await negotiations.decideHuman(binding, processing.telegramHandle, "accept");
    assert.equal(humanResult.outcome, "accepted");
    assert.equal(humanResult.quote?.total.amountMinor, 34000000);
    assert.equal(humanResult.quote?.repairEstimate?.partsPrice, null);
    assert.equal(humanResult.quote?.repairEstimate?.totalPrice.amountMinor, 34000000);
    assert.ok(!JSON.stringify(humanResult).includes("33000000"));

    const third = await negotiations.submit(merchantId, buyerId, request(humanResult.quote!, "repair-policy-round-three", 335000));
    assert.equal(third.outcome, "pending");
    const fourth = await negotiations.submit(merchantId, buyerId, request(humanResult.quote!, "repair-policy-round-four", 332000));
    assert.equal(fourth.outcome, "rejected"); assert.equal(fourth.code, "round_limit");
  } finally {
    await client.close();
    await replica.stop();
  }
});