import { z } from "zod";

export const repairReportSchema = z.object({
  vehicle: z.string().trim().max(200),
  parts: z.string().trim().max(2000),
  tasks: z.string().trim().max(2000),
  warnings: z.array(z.string().trim().max(500)).max(10),
  damageItems: z.array(z.strictObject({ id: z.string().min(1).max(128), component: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).nullable(), assessmentAmount: z.number().int().nonnegative().nullable(),
    imageRefs: z.array(z.string().min(1).max(150000)).max(5) })).max(100).optional(),
  totalAssessmentAmount: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export type RepairReport = z.infer<typeof repairReportSchema>;
