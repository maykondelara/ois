import { z } from "zod";

const uuid = z.string().uuid();
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{1,14}$/)
  .max(16);

export const driverCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  phoneE164: phone.optional(),
  depotLocationId: uuid.nullish(),
  emergencyContactName: z.string().trim().min(1).max(200).nullish(),
  emergencyContactPhoneE164: phone.nullish(),
  userId: uuid.nullish(),
});

export const driverUpdateSchema = driverCreateSchema.partial().omit({ userId: true });
export const driverStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "ON_LEAVE"]),
});
export const driverUserLinkSchema = z.object({ userId: uuid.nullable() });

const availabilityEntry = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isAvailable: z.boolean(),
});
export const driverAvailabilitySchema = z
  .array(availabilityEntry)
  .length(7)
  .superRefine((entries, context) => {
    const days = new Set(entries.map((entry) => entry.dayOfWeek));
    if (days.size !== 7)
      context.addIssue({ code: "custom", message: "Every weekday must appear exactly once" });
  });

export const capabilityGrantSchema = z.object({
  vehicleCategoryId: uuid,
  expiresOn: z.coerce.date().nullish(),
});

export const licenceCreateSchema = z.object({
  licenceNumber: z.string().min(1).max(128),
  licenceType: z.string().trim().min(1).max(100).default("DRIVER_LICENCE"),
  issuingJurisdiction: z.string().trim().min(1).max(100).nullish(),
  issuedOn: z.coerce.date().nullish(),
  expiresOn: z.coerce.date(),
});

export const licenceUpdateSchema = licenceCreateSchema.partial();

export type DriverCreateInput = z.infer<typeof driverCreateSchema>;
export type DriverUpdateInput = z.infer<typeof driverUpdateSchema>;
