import { z } from "zod";
import { BUSINESS_TYPES, getBusinessType } from "../merchant/business-types";

export const CONTRACT_VERSION = "1" as const;
export const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const timestampSchema = z.iso.datetime({ offset: true });
export const moneySchema = z.strictObject({
  amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export const damageAssessmentSchema = z.strictObject({
  sourceDocumentRef: z.string().max(1000).nullable().optional(),
  sourceDocument: z.string().max(12000).nullable().optional(),
  damageItems: z.array(z.strictObject({
    id: idSchema, component: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).nullable(),
    assessmentAmount: moneySchema.nullable(), imageRefs: z.array(z.string().max(150000)
      .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)).max(5),
  })).max(100),
  totalAssessmentAmount: moneySchema.nullable(), notes: z.string().trim().max(4000).nullable().optional(),
}).superRefine((assessment, context) => {
  const imageBytes = assessment.damageItems.reduce((sum, item) => sum + item.imageRefs.reduce((total, ref) => total + ref.length, 0), 0);
  if (imageBytes > 500000) context.addIssue({ code: "custom", message: "Damage evidence exceeds the supported size" });
});
export const repairEstimateSchema = z.strictObject({
  laborPrice: moneySchema, partsPrice: moneySchema.nullable(), totalPrice: moneySchema,
  customerSuppliedPartsAccepted: z.boolean(), estimatedDuration: z.string().trim().max(200).nullable(),
  earliestAvailableAt: timestampSchema.nullable().optional(), notes: z.string().trim().max(4000).nullable().optional(),
}).superRefine((estimate, context) => {
  const expected = BigInt(estimate.laborPrice.amountMinor) + BigInt(estimate.partsPrice?.amountMinor ?? 0);
  if (estimate.laborPrice.currency !== estimate.totalPrice.currency ||
      (estimate.partsPrice && estimate.partsPrice.currency !== estimate.totalPrice.currency) ||
      expected !== BigInt(estimate.totalPrice.amountMinor)) {
    context.addIssue({ code: "custom", message: "Repair estimate total must equal labor plus supplied parts" });
  }
  if (estimate.partsPrice === null && !estimate.customerSuppliedPartsAccepted) {
    context.addIssue({ code: "custom", message: "A labor-only estimate must state that customer-supplied parts are accepted" });
  }
});
const base = { contractVersion: z.literal(CONTRACT_VERSION), id: idSchema,
  merchantId: idSchema, createdAt: timestampSchema };
const mode = z.enum(["simulated", "live"]);
export const merchantProfileSchema = z.strictObject({ ...base,
  name: z.string().min(1).max(200), kind: z.enum(["parts", "repair"]),
  businessType: z.enum([BUSINESS_TYPES.PARTS_MERCHANT, BUSINESS_TYPES.REPAIR_SHOP]).optional(),
  mode, capabilities: z.array(z.string().min(1).max(200)).min(1),
  location: z.string().min(1).max(500), active: z.boolean(),
}).refine(v => v.id === v.merchantId, "Profile id must equal merchantId")
  .refine(v => !v.businessType || v.businessType === getBusinessType(v.kind), "Business type must match the merchant kind");
export const rfqSchema = z.strictObject({ ...base, buyerId: idSchema,
  kind: z.enum(["parts", "repair"]), vehicle: z.strictObject({
    make: z.string().min(1), model: z.string().min(1), year: z.number().int().min(1886).max(2100).optional(),
    vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/).optional(),
  }), items: z.array(z.strictObject({ description: z.string().min(1).max(2000),
    quantity: z.number().int().positive().max(10000), partNumber: z.string().min(1).optional(),
    preference: z.enum(["any", "oem", "aftermarket", "used"]).optional(),
  })).min(1), damageAssessment: damageAssessmentSchema.optional(), humanOfferRequired: z.boolean().optional(),
  budget: moneySchema.optional(), requiredBy: timestampSchema.optional(),
  status: z.enum(["received", "processing", "quoted", "declined", "expired"]),
}).superRefine((rfq, context) => {
  if (rfq.kind !== "repair" && (rfq.damageAssessment || rfq.humanOfferRequired)) {
    context.addIssue({ code: "custom", message: "Damage assessments and human repair offers require a repair RFQ" });
  }
});
export const quoteSchema = z.strictObject({ ...base, rfqId: idSchema, buyerId: idSchema,
  revision: z.number().int().positive(), kind: z.enum(["parts", "repair"]), mode,
  lines: z.array(z.strictObject({ resourceId: idSchema, description: z.string().min(1),
    quantity: z.number().int().positive(), unitPrice: moneySchema,
  })).min(1), total: moneySchema, expiresAt: timestampSchema,
  availabilityCheckedAt: timestampSchema, reservation: z.literal(false),
  repairEstimate: repairEstimateSchema.optional(),
  terms: z.string().min(1).max(4000), status: z.enum(["offered", "superseded", "expired", "withdrawn"]),
}).superRefine((v, ctx) => {
  const sum = v.lines.reduce((n, line) => n + line.quantity * line.unitPrice.amountMinor, 0);
  const expectedTotal = v.repairEstimate?.totalPrice.amountMinor ?? sum;
  if (!Number.isSafeInteger(sum) || expectedTotal !== v.total.amountMinor ||
      v.lines.some(l => l.unitPrice.currency !== v.total.currency) ||
      (v.repairEstimate && (v.kind !== "repair" || v.repairEstimate.laborPrice.amountMinor !== sum ||
        v.repairEstimate.totalPrice.currency !== v.total.currency)))
    ctx.addIssue({ code: "custom", message: "Quote total must equal lines in one currency" });
  if (Date.parse(v.expiresAt) <= Date.parse(v.createdAt) || Date.parse(v.availabilityCheckedAt) > Date.parse(v.createdAt))
    ctx.addIssue({ code: "custom", message: "Invalid quote validity or availability timestamps" });
});
export const negotiationSchema = z.strictObject({ ...base, quoteId: idSchema,
  quoteRevision: z.number().int().positive(), buyerId: idSchema, requestedTotal: moneySchema,
  responseTotal: moneySchema.optional(), status: z.enum(["requested", "accepted", "countered", "rejected"]),
}).superRefine((v, ctx) => {
  if ((v.status === "accepted" || v.status === "countered") && !v.responseTotal)
    ctx.addIssue({ code: "custom", message: "A resolved offer requires responseTotal" });
  if (v.responseTotal && v.responseTotal.currency !== v.requestedTotal.currency)
    ctx.addIssue({ code: "custom", message: "Negotiation currencies must match" });
});
// Approval requests are untrusted; only an authenticated server may create approval records.
export const approvalRequestSchema = z.strictObject({ contractVersion: z.literal(CONTRACT_VERSION),
  merchantId: idSchema, quoteId: idSchema, quoteRevision: z.number().int().positive(),
  approvedTotal: moneySchema, approved: z.literal(true), idempotencyKey: idSchema,
});
export const approvalSchema = z.strictObject({ ...base, buyerId: idSchema, quoteId: idSchema,
  quoteRevision: z.number().int().positive(), approvedTotal: moneySchema,
  status: z.enum(["verified", "revoked"]), verifiedAt: timestampSchema,
  expiresAt: timestampSchema, verificationReference: idSchema,
}).refine(v => Date.parse(v.expiresAt) > Date.parse(v.verifiedAt), "Approval must expire after verification");
export const transactionSchema = z.strictObject({ ...base, buyerId: idSchema,
  quoteId: idSchema, quoteRevision: z.number().int().positive(), approvalId: idSchema,
  idempotencyKey: idSchema, kind: z.enum(["parts_order", "repair_booking"]),
  total: moneySchema, mode, paymentMode: z.literal("mock"),
  status: z.enum(["pending", "confirmed", "failed", "cancelled"]),
  availabilityCheckedAt: timestampSchema,
});
export const auditEventSchema = z.strictObject({ ...base, actorId: idSchema,
  actorKind: z.enum(["buyer", "merchant", "system"]),
  action: z.enum(["profile_saved", "rfq_received", "rfq_processed", "rfq_failed", "quote_created", "negotiation_recorded", "approval_verified", "approval_revoked", "transaction_created", "transaction_updated", "inventory_saved", "service_saved", "slot_saved", "settings_saved", "demo_seeded", "telegram_binding_issued", "telegram_bound", "telegram_revoked", "telegram_draft_created", "telegram_draft_rejected", "telegram_draft_confirmed", "quote_published", "telegram_notified", "negotiation_requested", "negotiation_decided", "negotiation_timed_out", "negotiation_notified"]),
  entityId: idSchema, correlationId: idSchema, outcome: z.enum(["success", "failure"]),
});
export type MerchantProfile = z.infer<typeof merchantProfileSchema>;
export type RFQ = z.infer<typeof rfqSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type Negotiation = z.infer<typeof negotiationSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type Money = z.infer<typeof moneySchema>;
export type DamageAssessment = z.infer<typeof damageAssessmentSchema>;
export type RepairEstimate = z.infer<typeof repairEstimateSchema>;
