import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import {
  searchOfferSchema,
  searchViewSchema,
  type SearchGoal,
} from "./buyer-search-types";
import { allocation, recommendBundles } from "./buyer-search-domain";

export class SearchError extends Error {}

const indexTasks = new WeakMap<Db, Promise<void>>();

export function ensureSearchIndexes(db: Db): Promise<void> {
  const previous = indexTasks.get(db);
  if (previous) return previous;

  const task = Promise.all([
    ...[
      "buyerSearches",
      "buyerSearchOffers",
      "buyerSearchMessages",
      "buyerSearchDrafts",
      "buyerSearchReplies",
    ].map((name) =>
      db.collection(name).createIndex({ id: 1 }, { unique: true }),
    ),
    db
      .collection("buyerSearchOffers")
      .createIndex({ searchId: 1, merchantId: 1 }, { unique: true }),
    db
      .collection("buyerSearchPhotos")
      .createIndex({ searchId: 1, id: 1 }, { unique: true }),
    db
      .collection("buyerSearchLinks")
      .createIndex({ bindingId: 1, chatId: 1, messageId: 1 }, { unique: true }),
    db
      .collection("buyerSearchSessions")
      .createIndex({ bindingId: 1 }, { unique: true }),
  ])
    .then(() => undefined)
    .catch((error) => {
      indexTasks.delete(db);
      throw error;
    });

  indexTasks.set(db, task);
  return task;
}

export async function createSearch(
  db: Db,
  ownerId: string,
  goal: SearchGoal,
  mode: string,
) {
  await ensureSearchIndexes(db);

  const bindings = await db
    .collection("merchant_telegram_bindings")
    .find({ active: true, mode })
    .limit(50)
    .toArray();

  const profiles = await db
    .collection("merchant_profiles")
    .find({
      active: true,
      merchantId: { $in: bindings.map((b) => b.merchantId) },
    })
    .toArray();

  const recipients = profiles
    .filter((profile) => goal.items.some((item) => item.kind === profile.kind))
    .flatMap((profile) => {
      const binding = bindings.find((b) => b.merchantId === profile.merchantId);

      return binding
        ? [
            {
              merchantId: profile.merchantId as string,
              name: profile.name as string,
              kind: profile.kind as "parts" | "repair",
              bindingId: binding.id as string,
              chatId: binding.chatId as string,
              userId: binding.userId as string,
              status: "queued",
            },
          ]
        : [];
    });

  if (!recipients.length) {
    throw new SearchError(
      "Telegram-тай холбогдсон лангуу алга. /merchant дээр эхлээд лангуугаа холбоорой.",
    );
  }

  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();

  await db.collection("buyerSearches").insertOne({
    id,
    ownerId,
    goal,
    recipients,
    expiresAt,
    createdAt: now.toISOString(),
    status: "searching",
    negotiationPending: false,
  });

  return getSearch(db, ownerId, id);
}

export async function getSearch(db: Db, ownerId: string, id: string) {
  const search = await db.collection("buyerSearches").findOne({ id, ownerId });

  if (!search) throw new SearchError("Хүсэлт олдсонгүй.");

  const documents = await db
    .collection("buyerSearchOffers")
    .find({ searchId: id, status: "published" })
    .toArray();

  const offers = documents.map((doc) => searchOfferSchema.parse(doc));
  const bundles = recommendBundles(search.goal, offers);

  const pending = await db.collection("buyerSearchMessages").countDocuments({
    searchId: id,
    purpose: "negotiate",
    status: { $in: ["queued", "sending", "sent"] },
    resolved: { $ne: true },
  });

  return searchViewSchema.parse({
    ...search,
    offers,
    bundles,
    negotiationPending: pending > 0,
    recipients: search.recipients.map(
      (r: { name: string; kind: string; status: string }) => ({
        name: r.name,
        kind: r.kind,
        status: r.status,
      }),
    ),
  });
}

export async function negotiateSearch(
  db: Db,
  ownerId: string,
  id: string,
  key: string,
  target?: number,
) {
  const view = await getSearch(db, ownerId, id);

  if (view.status !== "searching" || Date.parse(view.expiresAt) <= Date.now()) {
    throw new SearchError("Хайлт хаагдсан эсвэл хугацаа дууссан байна.");
  }

  const bundle = view.bundles.find((b) => b.key === key && b.complete);

  if (!bundle) {
    throw new SearchError(
      "Бүрэн багцаа дахин сонгоно уу. Үнийн санал шинэчлэгдсэн байж болно.",
    );
  }

  const { total, values } = allocation(bundle, target);
  const roundId = randomUUID();
  const session = db.client.startSession();

  try {
    await session.withTransaction(async () => {
      const acquired = await db.collection("buyerSearches").updateOne(
        {
          id,
          ownerId,
          status: "searching",
          negotiationPending: false,
          expiresAt: { $gt: new Date().toISOString() },
        },
        {
          $set: {
            negotiationPending: true,
            roundId,
            negotiationTarget: total,
          },
        },
        { session },
      );

      if (!acquired.modifiedCount) {
        throw new SearchError("Өмнөх хэлэлцээний хариуг хүлээгээрэй.");
      }

      for (const value of values) {
        const offer = view.offers.find((o) => o.id === value.offerId)!;

        const guarded = await db.collection("buyerSearchOffers").updateOne(
          {
            id: offer.id,
            searchId: id,
            status: "published",
            revision: offer.revision,
          },
          { $inc: { operationVersion: 1 } },
          { session },
        );

        if (!guarded.matchedCount) {
          throw new SearchError(
            "Үнэ шинэчлэгдсэн байна. Шинэ багцаа сонгоорой.",
          );
        }
      }

      const search = await db
        .collection("buyerSearches")
        .findOne({ id, ownerId }, { session });

      await db.collection("buyerSearchMessages").insertMany(
        values.map((value) => {
          const offer = view.offers.find((o) => o.id === value.offerId)!;
          const recipient = search!.recipients.find(
            (r: { merchantId: string }) => r.merchantId === offer.merchantId,
          );
          const lines = bundle.lines.filter(
            (line) => line.offerId === value.offerId,
          );

          return {
            id: randomUUID(),
            searchId: id,
            roundId,
            offerId: offer.id,
            offerRevision: offer.revision,
            merchantId: offer.merchantId,
            bindingId: recipient.bindingId,
            chatId: recipient.chatId,
            userId: recipient.userId,
            purpose: "negotiate",
            status: "queued",
            resolved: false,
            text: [
              `Сайн байна уу! ${view.goal.vehicle}-ийн энэ саналд үнэ тохиролцох гэсэн юм.`,
              ...lines.map(
                (line) =>
                  `${line.itemIndex + 1}. ${line.description} — ${line.quantity} ширхэг`,
              ),
              `Одоогийн нийлбэр: ${value.amount}₮. ${value.target}₮ болгох боломжтой юу?`,
              "Боломжтой бол бараа тус бүрийн шинэ нэгж үнийг бичээрэй. Өөр үнэ санал болгож эсвэл татгалзаж болно.",
              "Бараа захиалаагүй; үнэ тохиролцож байна.",
            ].join("\n"),
            offeredTotal: value.amount,
            target: value.target,
            itemIndices: lines.map((line) => line.itemIndex),
            nextAttemptAt: new Date(),
            attempts: 0,
          };
        }),
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  return {
    search: await getSearch(db, ownerId, id),
    message: `Agent ${total.toLocaleString("mn-MN")}₮ зорилтот үнээр лангууны эзэдтэй ярилцаж байна.`,
  };
}

export async function selectSearch(
  db: Db,
  ownerId: string,
  id: string,
  key: string,
  approvedTotal: number,
) {
  const view = await getSearch(db, ownerId, id);
  const bundle = view.bundles.find((b) => b.key === key && b.complete);

  if (
    !bundle ||
    bundle.total !== approvedTotal ||
    view.negotiationPending ||
    Date.parse(view.expiresAt) <= Date.now()
  ) {
    throw new SearchError(
      "Үнэ шинэчлэгдсэн эсвэл хэлэлцээ хүлээгдэж байна. Багцаа дахин шалгаарай.",
    );
  }

  const session = db.client.startSession();

  try {
    await session.withTransaction(async () => {
      const result = await db.collection("buyerSearches").updateOne(
        {
          id,
          ownerId,
          status: "searching",
          negotiationPending: false,
          expiresAt: { $gt: new Date().toISOString() },
        },
        {
          $set: {
            status: "selected",
            selected: bundle,
            selectedAt: new Date().toISOString(),
          },
        },
        { session },
      );

      if (!result.modifiedCount) {
        throw new SearchError(
          "Хүсэлт аль хэдийн сонгогдсон эсвэл хаагдсан байна.",
        );
      }

      for (const line of bundle.lines) {
        const guarded = await db.collection("buyerSearchOffers").updateOne(
          {
            id: line.offerId,
            searchId: id,
            status: "published",
            revision: line.revision,
          },
          { $inc: { operationVersion: 1 } },
          { session },
        );

        if (!guarded.matchedCount) {
          throw new SearchError(
            "Үнэ шинэчлэгдсэн байна. Шинэ багцаа сонгоорой.",
          );
        }
      }

      const search = await db
        .collection("buyerSearches")
        .findOne({ id, ownerId }, { session });

      const offerIds = [...new Set(bundle.lines.map((line) => line.offerId))];

      await db.collection("buyerSearchMessages").insertMany(
        offerIds.map((offerId) => {
          const offer = view.offers.find((row) => row.id === offerId)!;
          const recipient = search!.recipients.find(
            (row: { merchantId: string }) =>
              row.merchantId === offer.merchantId,
          );
          const lines = bundle.lines.filter((line) => line.offerId === offerId);

          return {
            id: randomUUID(),
            searchId: id,
            merchantId: offer.merchantId,
            bindingId: recipient.bindingId,
            chatId: recipient.chatId,
            userId: recipient.userId,
            purpose: "selected",
            status: "queued",
            resolved: false,
            attempts: 0,
            itemIndices: lines.map((line) => line.itemIndex),
            nextAttemptAt: new Date(),
            text: [
              `Хэрэглэгч ${view.goal.vehicle}-ийн дараах саналыг сонирхож сонголоо:`,
              ...lines.map(
                (line) =>
                  `${line.description} — ${line.quantity} ширхэг, ${line.unitPrice}₮ / ширхэг`,
              ),
              "Энэ нь багцын сонголт. Бараа резервлээгүй, төлбөр хийгээгүй.",
            ].join("\n"),
          };
        }),
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  return getSearch(db, ownerId, id);
}
