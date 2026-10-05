import { z } from "zod";

export const demoPaymentSchema = z.object({
  searchId: z.string().uuid(),
  receiptId: z.string(),
  vehicle: z.string(),
  total: z.number().int().positive(),
  deposit: z.number().int().positive(),
  remaining: z.number().int().nonnegative(),
  status: z.enum(["pending", "demo_paid"]),
  mode: z.literal("demo"),
  createdAt: z.string(),
  paidAt: z.string().optional(),
});

export const demoPaymentResponseSchema = z.object({
  payment: demoPaymentSchema.nullable(),
  qr: z.string().optional(),
});

export type DemoPayment = z.infer<typeof demoPaymentSchema>;
