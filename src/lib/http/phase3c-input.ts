import { z } from "zod";

const uuid = z.string().uuid();
const text = z.string().trim().min(1).max(2_000);
const nullableText = z.string().trim().max(2_000).nullable().optional();
const responseType = z.enum([
  "YES_NO",
  "PASS_FAIL",
  "TEXT",
  "NUMBER",
  "ODOMETER",
  "PHOTO",
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "CHECKBOX",
  "SIGNATURE",
]);

export const templateCreateInput = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9_]{0,62}$/),
    name: z.string().trim().min(1).max(200),
    description: nullableText,
  })
  .strict();
export const templateUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: nullableText,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const sectionInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: nullableText,
    sortOrder: z.number().int().min(0),
  })
  .strict();
export const sectionUpdateInput = sectionInput
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const questionInput = z
  .object({
    sectionId: uuid,
    label: z.string().trim().min(1).max(500),
    helpText: nullableText,
    isRequired: z.boolean().optional(),
    responseType,
    sortOrder: z.number().int().min(0),
    failureBooleanValue: z.boolean().nullable().optional(),
    minimumValue: z.number().finite().nullable().optional(),
    maximumValue: z.number().finite().nullable().optional(),
    commentRule: z.enum(["NEVER", "OPTIONAL", "REQUIRED_ON_TRIGGER"]).optional(),
    photoRequirement: z.enum(["NEVER", "ALWAYS", "ON_FAILURE"]).optional(),
  })
  .strict();
export const questionUpdateInput = questionInput
  .omit({ sectionId: true, responseType: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const optionInput = z
  .object({
    label: z.string().trim().min(1).max(200),
    sortOrder: z.number().int().min(0),
    isFailure: z.boolean().optional(),
  })
  .strict();
export const optionUpdateInput = optionInput
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const applicabilityInput = z
  .object({
    mode: z.enum(["ALL_ELIGIBLE", "VEHICLE_CATEGORIES", "SPECIFIC_VEHICLES"]),
    vehicleCategoryIds: z.array(uuid).max(500).optional(),
    vehicleIds: z.array(uuid).max(500).optional(),
  })
  .strict();
export const startInspectionInput = z
  .object({ vehicleId: uuid, templateVersionId: uuid, driverId: uuid.nullable().optional() })
  .strict();
export const responseInput = z
  .object({
    questionId: uuid,
    booleanValue: z.boolean().nullable().optional(),
    textValue: nullableText,
    numberValue: z.number().finite().nullable().optional(),
    odometerValueKm: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
    optionIds: z.array(uuid).max(100).optional(),
    comment: nullableText,
  })
  .strict();
export const responseFileInput = z.object({ storedFileId: uuid }).strict();
export const removalInput = z.object({ reason: text }).strict();
export const submitInput = z
  .object({ confirmationToken: z.string().min(1).max(4096).optional() })
  .strict();
