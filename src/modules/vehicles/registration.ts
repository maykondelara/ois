import { z } from "zod";

const registrationSchema = z.string().trim().min(1).max(32);

/** Canonical tenant-local registration lookup key; jurisdiction-specific rules remain deferred. */
export function normalizeRegistration(input: string) {
  const display = registrationSchema.parse(input).normalize("NFKC").toUpperCase();
  const normalized = display.replace(/[\s-]+/g, "");
  if (!/^[A-Z0-9]+$/.test(normalized)) {
    throw new Error("Vehicle registration contains unsupported characters");
  }
  return { display, normalized };
}

export const defaultVehicleCategories = ["VAN", "LR", "MR", "HR", "HC", "MC"] as const;

/** Approved legal-class defaults for the built-in category codes; custom codes stay unknown. */
export const defaultVehicleCategoryRequiredLicenceClass = {
  VAN: "C",
  LR: "LR",
  MR: "MR",
  HR: "HR",
  HC: "HC",
  MC: "MC",
} as const;
