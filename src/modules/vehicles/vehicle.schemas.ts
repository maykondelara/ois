import { z } from "zod";

const uuid = z.string().uuid();
const nonNegativeInteger = z.number().int().min(0).max(2_147_483_647);

export const vehicleCreateSchema = z.object({
  registration: z.string().min(1).max(64),
  vehicleCategoryId: uuid,
  depotLocationId: uuid.nullish(),
  registrationExpiresOn: z.coerce.date().nullish(),
  nextServiceOdometerKm: nonNegativeInteger.nullish(),
  operationalStatus: z.enum(["ACTIVE", "INACTIVE", "OUT_OF_SERVICE"]).default("ACTIVE"),
  statusReason: z.string().trim().min(1).max(1000).optional(),
  initialOdometerKm: nonNegativeInteger.optional(),
});

export const vehicleUpdateSchema = z.object({
  registration: z.string().min(1).max(64).optional(),
  vehicleCategoryId: uuid.optional(),
  depotLocationId: uuid.nullish(),
  registrationExpiresOn: z.coerce.date().nullish(),
});

export const vehicleStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "OUT_OF_SERVICE"]),
  reason: z.string().trim().max(1000).optional(),
});

export const nextServiceSchema = z.object({ nextServiceOdometerKm: nonNegativeInteger.nullish() });
export const odometerSubmissionSchema = z.object({
  readingKm: nonNegativeInteger,
  confirmationToken: z.string().min(1).max(4096).optional(),
});
export const odometerReviewSchema = z.object({
  decision: z.enum(["ACCEPT", "REJECT"]),
  reviewNote: z.string().trim().min(1).max(1000),
});
