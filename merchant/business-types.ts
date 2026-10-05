export const BUSINESS_TYPES = {
  PARTS_MERCHANT: "PARTS_MERCHANT",
  REPAIR_SHOP: "REPAIR_SHOP",
} as const;

export type BusinessType = (typeof BUSINESS_TYPES)[keyof typeof BUSINESS_TYPES];
export type MerchantKind = "parts" | "repair";

export function getBusinessType(kind: MerchantKind | BusinessType | string): BusinessType {
  const normalized = String(kind ?? "").trim();
  if (normalized === BUSINESS_TYPES.PARTS_MERCHANT || normalized === "parts") return BUSINESS_TYPES.PARTS_MERCHANT;
  if (normalized === BUSINESS_TYPES.REPAIR_SHOP || normalized === "repair") return BUSINESS_TYPES.REPAIR_SHOP;
  throw new Error(`Unsupported merchant business type: ${kind}`);
}

export function getMerchantKind(businessType: MerchantKind | BusinessType | string): MerchantKind {
  const normalized = String(businessType ?? "").trim();
  if (normalized === BUSINESS_TYPES.PARTS_MERCHANT || normalized === "parts") return "parts";
  if (normalized === BUSINESS_TYPES.REPAIR_SHOP || normalized === "repair") return "repair";
  throw new Error(`Unsupported merchant kind: ${businessType}`);
}

export function normalizeMerchantBusinessType(value: string | undefined): MerchantKind | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (normalized === BUSINESS_TYPES.PARTS_MERCHANT || normalized === "parts") return "parts";
  if (normalized === BUSINESS_TYPES.REPAIR_SHOP || normalized === "repair") return "repair";
  return undefined;
}
