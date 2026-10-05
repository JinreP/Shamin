import { z } from "zod";
import { normalizeMerchantBusinessType } from "@/merchant/business-types";
import { discoverMerchants } from "@/merchant/server/admin-store";
import { getMerchantDb } from "@/merchant/server/database";
import { apiError, json } from "@/merchant/server/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const kind = z.enum(["parts", "repair"]).optional().parse(query.get("kind") ?? undefined);
    const businessType = normalizeMerchantBusinessType(query.get("businessType") ?? undefined);
    const capability = z.string().trim().min(1).max(200).optional().parse(query.get("capability") ?? undefined);
    return json({ contractVersion: "1", merchants: await discoverMerchants(await getMerchantDb(), kind, capability, businessType), discovery: "public_capabilities_only" });
  } catch (error) { return apiError(error); }
}
