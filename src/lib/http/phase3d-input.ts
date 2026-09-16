import { z } from "zod";

const text = z.string().trim().min(1).max(2_000);
const optionalText = z.string().trim().max(2_000).nullable().optional();

export const issueProgressInput = z.object({ reason: optionalText }).strict();
export const issueActionInput = z
  .object({
    actionType: z.enum(["INSPECTION", "REPAIR", "OTHER"]),
    description: text,
    notes: optionalText,
  })
  .strict();
export const issueResolutionInput = z.object({ resolutionNotes: text }).strict();
export const issueCloseInput = z.object({ reason: optionalText }).strict();
export const issueSeverityInput = z
  .object({ severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), reason: text })
  .strict();
export const vehicleReleaseInput = z.object({ reason: text }).strict();
