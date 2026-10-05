import { NextResponse } from "next/server";
import { z } from "zod";
import { getMerchantDb } from "@/merchant/server/database";
import { readTelegramConfig } from "@/merchant/telegram/config";
import { getBuyerSession } from "@/lib/buyer-session";
import { searchInputSchema } from "@/lib/buyer-search-types";
import {
  createSearch,
  getSearch,
  negotiateSearch,
  selectSearch,
  SearchError,
} from "@/lib/buyer-search-store";

export const runtime = "nodejs";

const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    goal: searchInputSchema,
  }),
  z.object({
    action: z.literal("negotiate"),
    id: z.string().uuid(),
    key: z.string().length(64),
    target: z.number().int().positive().optional(),
  }),
  z.object({
    action: z.literal("select"),
    id: z.string().uuid(),
    key: z.string().length(64),
    approved: z.literal(true),
    approvedTotal: z.number().int().positive(),
  }),
]);

const noStore = {
  headers: { "Cache-Control": "no-store" },
};

function failure(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message ?? "Мэдээллээ шалгаарай." },
      { status: 400 },
    );
  }

  if (error instanceof SearchError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  return NextResponse.json(
    {
      error:
        "Хайлтыг боловсруулах боломжгүй байна. MongoDB болон Telegram тохиргоогоо шалгаарай.",
    },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  try {
    const id = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get("id"));

    const db = await getMerchantDb();
    const ownerId = await getBuyerSession();
    const search = await getSearch(db, ownerId, id);

    return NextResponse.json({ search }, noStore);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");

  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json(
      { error: "Хүсэлтийн эх үүсвэр тохирохгүй." },
      { status: 403 },
    );
  }

  try {
    const body = inputSchema.parse(await request.json());
    const db = await getMerchantDb();
    const ownerId = await getBuyerSession();

    if (body.action === "create") {
      const config = readTelegramConfig();

      if (process.env.NODE_ENV === "production") {
        throw new SearchError("Энэ урсгалыг одоогоор локал demo дээр туршина.");
      }

      const search = await createSearch(
        db,
        ownerId,
        body.goal,
        config.merchantAuthMode,
      );

      return NextResponse.json({ search }, noStore);
    }

    if (body.action === "negotiate") {
      const result = await negotiateSearch(
        db,
        ownerId,
        body.id,
        body.key,
        body.target,
      );

      return NextResponse.json(result, noStore);
    }

    const search = await selectSearch(
      db,
      ownerId,
      body.id,
      body.key,
      body.approvedTotal,
    );

    return NextResponse.json({ search }, noStore);
  } catch (error) {
    return failure(error);
  }
}
