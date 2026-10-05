import { createHash } from "node:crypto";
import type {
  SearchGoal,
  SearchOffer,
  SearchBundle,
} from "./buyer-search-types";

// Хүссэн бүх сэлбэг/ажлыг хамарсан багцыг харьцуулна.
export function recommendBundles(
  goal: SearchGoal,
  offers: SearchOffer[],
): SearchBundle[] {
  const candidates = goal.items.map((item, itemIndex) =>
    offers
      .flatMap((offer) =>
        offer.lines
          .filter(
            (line) =>
              line.itemIndex === itemIndex &&
              line.quantity >= item.quantity &&
              offer.kind === item.kind &&
              (item.kind !== "parts" ||
                goal.preference === "Any" ||
                line.condition === goal.preference.toLowerCase()),
          )
          .map((line) => ({
            ...line,
            quantity: item.quantity,
            offerId: offer.id,
            revision: offer.revision,
            merchantName: offer.merchantName,
          })),
      )
      .sort(
        (a, b) =>
          a.unitPrice - b.unitPrice || a.offerId.localeCompare(b.offerId),
      ),
  );

  function bundle(lines: SearchBundle["lines"]): SearchBundle {
    const missing = goal.items.flatMap((_, index) =>
      lines.some((line) => line.itemIndex === index) ? [] : [index],
    );

    const total = lines.reduce(
      (sum, line) => sum + line.quantity * line.unitPrice,
      0,
    );

    if (!Number.isSafeInteger(total)) {
      throw new Error("Үнийн нийлбэр хэтэрсэн байна.");
    }

    const key = createHash("sha256")
      .update(
        JSON.stringify(
          lines.map((line) => [
            line.itemIndex,
            line.offerId,
            line.revision,
            line.unitPrice,
            line.quantity,
          ]),
        ),
      )
      .digest("hex");

    return {
      key,
      total,
      lines,
      complete: missing.length === 0,
      missing,
    };
  }

  const cheapest = bundle(
    candidates.flatMap((rows) => (rows[0] ? [rows[0]] : [])),
  );

  const alternatives = offers.map((offer) =>
    bundle(
      candidates.flatMap((rows) => {
        const same = rows.find((row) => row.offerId === offer.id);
        return same ? [same] : rows[0] ? [rows[0]] : [];
      }),
    ),
  );

  const unique = new Map(
    [cheapest, ...alternatives]
      .filter((value) => value.lines.length > 0)
      .map((value) => [value.key, value]),
  );

  return [...unique.values()]
    .sort(
      (a, b) => Number(b.complete) - Number(a.complete) || a.total - b.total,
    )
    .slice(0, 6);
}

// Нийт зорилтот үнийг лангуу бүрд хувь тэнцүүлж хуваарилна.
// Хэрэглэгч үнэ өгөөгүй бол 5% хөнгөлөлт хүснэ.
export function allocation(bundle: SearchBundle, target?: number) {
  const total = target ?? Math.max(1, Math.floor(bundle.total * 0.95));

  if (!Number.isSafeInteger(total) || total <= 0 || total >= bundle.total) {
    throw new Error("Зорилтот үнэ одоогийн үнээс бага бүхэл төгрөг байна.");
  }

  const grouped = new Map<string, number>();

  for (const line of bundle.lines) {
    grouped.set(
      line.offerId,
      (grouped.get(line.offerId) ?? 0) + line.unitPrice * line.quantity,
    );
  }

  const entries = [...grouped.entries()];

  const values = entries.map(([offerId, amount], index) => ({
    offerId,
    amount,
    target:
      index === entries.length - 1
        ? 0
        : Number((BigInt(total) * BigInt(amount)) / BigInt(bundle.total)),
  }));

  values[values.length - 1].target =
    total - values.slice(0, -1).reduce((sum, item) => sum + item.target, 0);

  if (values.some((value) => value.target < 1)) {
    throw new Error("Зорилтот үнэ хэт бага байна.");
  }

  return { total, values };
}
