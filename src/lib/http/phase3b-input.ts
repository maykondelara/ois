import { z } from "zod";

const nullableText = z.string().trim().max(2000).nullable().optional();

export const documentTypeCreateInput = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9_]{0,62}$/),
    name: z.string().trim().min(1).max(100),
    description: nullableText,
    subjectType: z.enum(["DRIVER", "VEHICLE", "COMPANY"]),
    evidenceSourceType: z.enum(["DOCUMENT", "DRIVER_LICENCE"]),
    requiresIssueDate: z.boolean().optional(),
    requiresExpiryDate: z.boolean().optional(),
  })
  .strict();

export const documentTypeUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: nullableText,
    requiresIssueDate: z.boolean().optional(),
    requiresExpiryDate: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Document type update requires a field")
  .refine(
    (value) => value.isActive === undefined || Object.keys(value).length === 1,
    "isActive must be changed separately",
  );

export const requirementCreateInput = z
  .object({
    documentTypeId: z.string().uuid(),
    subjectType: z.enum(["DRIVER", "VEHICLE", "COMPANY"]),
    applicability: z.enum(["GLOBAL", "SPECIFIC"]),
    name: z.string().trim().min(1).max(200),
    description: nullableText,
    expiryWarningDays: z.number().int().min(0).max(3650).optional(),
  })
  .strict();

export const requirementUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: nullableText,
    expiryWarningDays: z.number().int().min(0).max(3650).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Requirement update requires a field")
  .refine(
    (value) => value.isActive === undefined || Object.keys(value).length === 1,
    "isActive must be changed separately",
  );

export const documentCreateInput = z
  .object({
    documentTypeId: z.string().uuid(),
    subjectType: z.enum(["DRIVER", "VEHICLE", "COMPANY"]),
    driverId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
    issueDate: z.string().date().nullable().optional(),
    validFrom: z.string().date().nullable().optional(),
    expiryDate: z.string().date().nullable().optional(),
  })
  .strict();

export const documentUpdateInput = z
  .object({
    issueDate: z.string().date().nullable().optional(),
    validFrom: z.string().date().nullable().optional(),
    expiryDate: z.string().date().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Document update requires a field");

export const assignmentCreateInput = z
  .object({
    subjectType: z.enum(["DRIVER", "VEHICLE"]),
    driverId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
  })
  .strict();

export const exemptionCreateInput = z
  .object({
    subjectType: z.enum(["DRIVER", "VEHICLE", "COMPANY"]),
    driverId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
    reason: z.string().trim().min(1).max(2000),
    effectiveFrom: z.string().date().nullable().optional(),
    expiresOn: z.string().date().nullable().optional(),
  })
  .strict();
