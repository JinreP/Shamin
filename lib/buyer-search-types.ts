import { z } from "zod";

const item = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().min(1).max(100),
  kind: z.enum(["parts", "repair"]),
});

export const searchInputSchema = z.object({
  vehicle: z.string().trim().min(2).max(200),
  items: z.array(item).min(1).max(30),
  budget: z.number().int().positive().max(1_000_000_000),
  days: z.number().int().min(1).max(30),
  preference: z.enum(["Any", "OEM", "Aftermarket", "Used"]),
});

export const searchLineSchema = z.object({
  itemIndex: z.number().int().nonnegative(),
  description: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().int().positive().max(1_000_000_000),
  condition: z.enum(["oem", "aftermarket", "used", "unknown"]),
  warranty: z.string(),
  notes: z.string(),
});

export const searchOfferSchema = z.object({
  id: z.string(),
  merchantId: z.string(),
  merchantName: z.string(),
  kind: z.enum(["parts", "repair"]),
  revision: z.number().int().positive(),
  lines: z.array(searchLineSchema),
  photos: z.array(z.string()),
  updatedAt: z.string(),
});

export const searchBundleSchema = z.object({
  key: z.string(),
  total: z.number().int().nonnegative(),
  complete: z.boolean(),
  missing: z.array(z.number()),
  lines: z.array(
    searchLineSchema.extend({
      offerId: z.string(),
      revision: z.number(),
      merchantName: z.string(),
    }),
  ),
});

export const searchViewSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["searching", "selected", "closed"]),
  goal: searchInputSchema,
  expiresAt: z.string(),
  offers: z.array(searchOfferSchema),
  bundles: z.array(searchBundleSchema),
  recipients: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["parts", "repair"]),
      status: z.string(),
    }),
  ),
  negotiationPending: z.boolean(),
  selected: searchBundleSchema.optional(),
});

export type SearchGoal = z.infer<typeof searchInputSchema>;
export type SearchOffer = z.infer<typeof searchOfferSchema>;
export type SearchBundle = z.infer<typeof searchBundleSchema>;
export type SearchView = z.infer<typeof searchViewSchema>;
