import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_MERCHANTS } from "../merchant/demo-merchants";
import {
  BUSINESS_TYPES,
  getBusinessType,
  getMerchantKind,
  normalizeMerchantBusinessType,
} from "../merchant/business-types";
import { getA2AMerchantDirectory } from "../merchant/a2a/cards";

test("merchant business types are explicit and compatible with existing kinds", () => {
  assert.equal(getBusinessType("parts"), BUSINESS_TYPES.PARTS_MERCHANT);
  assert.equal(getBusinessType("repair"), BUSINESS_TYPES.REPAIR_SHOP);
  assert.equal(getMerchantKind(BUSINESS_TYPES.PARTS_MERCHANT), "parts");
  assert.equal(getMerchantKind(BUSINESS_TYPES.REPAIR_SHOP), "repair");

  assert.equal(normalizeMerchantBusinessType("PARTS_MERCHANT"), "parts");
  assert.equal(normalizeMerchantBusinessType("REPAIR_SHOP"), "repair");
  assert.equal(normalizeMerchantBusinessType("parts"), "parts");
  assert.equal(normalizeMerchantBusinessType("repair"), "repair");

  const parts = DEMO_MERCHANTS.filter((merchant) => merchant.kind === "parts");
  const repair = DEMO_MERCHANTS.filter((merchant) => merchant.kind === "repair");

  assert.ok(parts.every((merchant) => merchant.businessType === BUSINESS_TYPES.PARTS_MERCHANT));
  assert.ok(repair.every((merchant) => merchant.businessType === BUSINESS_TYPES.REPAIR_SHOP));
  assert.equal(parts.length, 3);
  assert.equal(repair.length, 2);
});

test("merchant directory exposes the explicit business type alongside the existing kind", () => {
  const directory = getA2AMerchantDirectory("https://demo.example");

  assert.ok(directory.merchants.every((merchant) => merchant.kind === "parts" || merchant.kind === "repair"));
  assert.ok(directory.merchants.every((merchant) => merchant.businessType === getBusinessType(merchant.kind)));
  assert.ok(directory.merchants.some((merchant) => merchant.businessType === BUSINESS_TYPES.PARTS_MERCHANT));
  assert.ok(directory.merchants.some((merchant) => merchant.businessType === BUSINESS_TYPES.REPAIR_SHOP));
});
