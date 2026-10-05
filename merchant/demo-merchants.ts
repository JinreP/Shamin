// Public names and IDs only. No inventory, pricing or access credentials.
import { BUSINESS_TYPES, type BusinessType, type MerchantKind } from "./business-types";
import { merchantName } from "./i18n";

export type DemoMerchant = {
  id: string;
  name: string;
  kind: MerchantKind;
  businessType: BusinessType;
};

export const DEMO_MERCHANTS: readonly DemoMerchant[] = [
  { id: "demo-prius-parts", name: merchantName("demo-prius-parts"), kind: "parts", businessType: BUSINESS_TYPES.PARTS_MERCHANT },
  { id: "demo-japan-used", name: merchantName("demo-japan-used"), kind: "parts", businessType: BUSINESS_TYPES.PARTS_MERCHANT },
  { id: "demo-oem-center", name: merchantName("demo-oem-center"), kind: "parts", businessType: BUSINESS_TYPES.PARTS_MERCHANT },
  { id: "demo-auto-care", name: merchantName("demo-auto-care"), kind: "repair", businessType: BUSINESS_TYPES.REPAIR_SHOP },
  { id: "demo-quick-garage", name: merchantName("demo-quick-garage"), kind: "repair", businessType: BUSINESS_TYPES.REPAIR_SHOP },
];
