import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getMerchantDb } from "@/merchant/server/database";
import { getBuyerSession } from "@/lib/buyer-session";
import { searchBundleSchema } from "@/lib/buyer-search-types";
import { demoPaymentSchema, type DemoPayment } from "@/lib/buyer-payment-types";

export const runtime = "nodejs";

type StoredPayment = DemoPayment & {
  _id: string;
  ownerId: string;
};

const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    searchId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("confirm"),
    searchId: z.string().uuid(),
    approved: z.literal(true),
    approvedAmount: z.number().int().positive(),
  }),
]);

function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function result(doc: StoredPayment | null) {
  if (!doc) return json({ payment: null });

  const payment = demoPaymentSchema.parse(doc);

  const qr =
    payment.status === "pending"
      ? await QRCode.toDataURL(
          [
            "ZahAgent DEMO ONLY",
            payment.receiptId,
            `Deposit: ${payment.deposit} MNT`,
            "No bank transfer",
          ].join("\n"),
          { width: 240, margin: 4 },
        )
      : undefined;

  return json({ payment, qr });
}

function failed(error: unknown) {
  const invalid = error instanceof z.ZodError || error instanceof SyntaxError;

  return json(
    {
      error: invalid
        ? "Хүсэлтийн мэдээлэл буруу байна."
        : "Demo төлбөрийг боловсруулахад алдаа гарлаа. Дахин оролдоорой.",
    },
    invalid ? 400 : 503,
  );
}

export async function GET(request: Request) {
  if (process.env.MOCK_PAYMENTS_ENABLED !== "true") {
    return json({ error: "Demo төлбөр идэвхгүй." }, 403);
  }

  try {
    const searchId = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get("searchId"));

    const ownerId = await getBuyerSession();
    const db = await getMerchantDb();

    const search = await db
      .collection("buyerSearches")
      .findOne({ id: searchId, ownerId });

    if (!search) {
      return json({ error: "Хүсэлт олдсонгүй." }, 404);
    }

    const payment = await db
      .collection<StoredPayment>("buyerDemoPayments")
      .findOne({ _id: searchId, ownerId });

    return await result(payment);
  } catch (error) {
    return failed(error);
  }
}

export async function POST(request: Request) {
  if (process.env.MOCK_PAYMENTS_ENABLED !== "true") {
    return json({ error: "Demo төлбөр идэвхгүй." }, 403);
  }

  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return json({ error: "Хүсэлтийн эх үүсвэр тохирохгүй." }, 403);
  }

  try {
    const input = inputSchema.parse(await request.json());
    const ownerId = await getBuyerSession();
    const db = await getMerchantDb();

    const search = await db.collection("buyerSearches").findOne({
      id: input.searchId,
      ownerId,
      status: "selected",
    });

    if (!search) {
      return json({ error: "Эхлээд багц сонголтоо батална уу." }, 409);
    }

    const payments = db.collection<StoredPayment>("buyerDemoPayments");

    if (input.action === "create") {
      const bundle = searchBundleSchema.parse(search.selected);

      if (!bundle.complete || bundle.total <= 0) {
        return json({ error: "Бүрэн багц шаардлагатай." }, 409);
      }

      const deposit = Math.ceil((bundle.total * 30) / 100);

      const payment: StoredPayment = {
        _id: input.searchId,
        ownerId,
        searchId: input.searchId,
        receiptId: `DEMO-${input.searchId.toUpperCase()}`,
        vehicle: String(search.goal.vehicle),
        total: bundle.total,
        deposit,
        remaining: bundle.total - deposit,
        status: "pending",
        mode: "demo",
        createdAt: new Date().toISOString(),
      };

      // Давтан дарахад өмнөх баримт, төлөвийг өөрчлөхгүй.
      await payments.updateOne(
        { _id: input.searchId },
        { $setOnInsert: payment },
        { upsert: true },
      );
    } else {
      const payment = await payments.findOne({
        _id: input.searchId,
        ownerId,
      });

      if (!payment || payment.deposit !== input.approvedAmount) {
        return json({ error: "Урьдчилгааны дүнгээ дахин шалгана уу." }, 409);
      }

      const session = db.client.startSession();

      try {
        await session.withTransaction(async () => {
          const updated = await payments.updateOne(
            {
              _id: input.searchId,
              ownerId,
              status: "pending",
            },
            {
              $set: {
                status: "demo_paid",
                paidAt: new Date().toISOString(),
              },
            },
            { session },
          );

          // Давтан дарахад мэдэгдэл дахин үүсгэхгүй.
          if (!updated.modifiedCount) return;

          const bundle = searchBundleSchema.parse(search.selected);

          const recipients = z
            .array(
              z.object({
                merchantId: z.string(),
                bindingId: z.string(),
                chatId: z.string(),
                userId: z.string(),
              }),
            )
            .parse(search.recipients);

          const offerIds = [
            ...new Set(bundle.lines.map((line) => line.offerId)),
          ];

          let cumulative = 0;
          let allocated = 0;

          const money = (value: number) => `${value.toLocaleString("mn-MN")}₮`;

          for (const offerId of offerIds) {
            const offer = await db
              .collection("buyerSearchOffers")
              .findOne({ id: offerId, searchId: input.searchId }, { session });

            const recipient = recipients.find(
              (row) => row.merchantId === offer?.merchantId,
            );

            if (!recipient) {
              throw new Error("Payment recipient missing");
            }

            const lines = bundle.lines.filter(
              (line) => line.offerId === offerId,
            );

            const total = lines.reduce(
              (sum, line) => sum + line.unitPrice * line.quantity,
              0,
            );

            // Олон лангуутай багцын урьдчилгааг хуваарилна.
            cumulative += total;

            const next = Number(
              (BigInt(payment.deposit) * BigInt(cumulative)) /
                BigInt(payment.total),
            );

            const deposit = next - allocated;
            allocated = next;

            await db.collection("buyerSearchMessages").insertOne(
              {
                id: randomUUID(),
                searchId: input.searchId,
                ...recipient,
                purpose: "payment",
                status: "queued",
                resolved: false,
                attempts: 0,
                nextAttemptAt: new Date(),
                itemIndices: [],
                text: [
                  "✅ Demo урьдчилгаа орж ирлээ!",
                  `Машин: ${payment.vehicle}`,
                  ...lines.map(
                    (line) => `• ${line.description} — ${line.quantity} ширхэг`,
                  ),
                  `Танай саналын нийт үнэ: ${money(total)}`,
                  `Demo урьдчилгаа: ${money(deposit)}`,
                  `Үлдэгдэл: ${money(total - deposit)}`,
                  `Баримт: ${payment.receiptId}`,
                  "🧪 Туршилтын мэдэгдэл. Бодит мөнгө шилжээгүй, бараа резервлээгүй.",
                ].join("\n"),
              },
              { session },
            );
          }
        });
      } finally {
        await session.endSession();
      }
    }

    return await result(
      await payments.findOne({
        _id: input.searchId,
        ownerId,
      }),
    );
  } catch (error) {
    return failed(error);
  }
}
