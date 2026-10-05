import { NextResponse } from "next/server";
import { z } from "zod";
import { getMerchantDb } from "@/merchant/server/database";
import { getBuyerSession } from "@/lib/buyer-session";
import { readTelegramConfig } from "@/merchant/telegram/config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;

    const searchId = z.string().uuid().parse(query.get("search"));
    const id = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(query.get("id"));

    const db = await getMerchantDb();
    const ownerId = await getBuyerSession();

    const search = await db.collection("buyerSearches").findOne({
      id: searchId,
      ownerId,
    });

    if (!search) {
      return new NextResponse(null, { status: 404 });
    }

    // Зөвхөн эзний баталж нийтэлсэн саналын зургийг харуулна.
    const offer = await db.collection("buyerSearchOffers").findOne({
      searchId,
      status: "published",
      photos: id,
    });

    if (!offer) {
      return new NextResponse(null, { status: 404 });
    }

    const photo = await db.collection("buyerSearchPhotos").findOne({
      searchId,
      id,
    });

    if (!photo) {
      return new NextResponse(null, { status: 404 });
    }

    const { token } = readTelegramConfig();

    const response = await fetch(
      `https://api.telegram.org/bot${token}/getFile`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: photo.fileId }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      },
    );

    const body = z
      .object({
        ok: z.literal(true),
        result: z.object({
          file_path: z.string().regex(/^[A-Za-z0-9_./-]+$/),
          file_size: z
            .number()
            .max(8 * 1024 * 1024)
            .optional(),
        }),
      })
      .parse(await response.json());

    if (!response.ok || body.result.file_path.split("/").includes("..")) {
      throw new Error("Зургийн мэдээллийг авч чадсангүй.");
    }

    const image = await fetch(
      `https://api.telegram.org/file/bot${token}/${body.result.file_path}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      },
    );

    if (!image.ok || !image.body) {
      throw new Error("Зургийг татаж чадсангүй.");
    }

    const reader = image.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;

        size += part.value.byteLength;

        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Зураг хэт том байна.");
        }

        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }

    const bytes = Buffer.concat(chunks);

    const mime =
      bytes[0] === 255 && bytes[1] === 216
        ? "image/jpeg"
        : bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? "image/png"
          : undefined;

    if (!mime) {
      throw new Error("Зургийн формат тохирохгүй.");
    }

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
