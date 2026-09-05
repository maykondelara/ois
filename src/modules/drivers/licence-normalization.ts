import { ValidationError } from "@/lib/errors";

/** Canonical lookup representation, deliberately without jurisdiction-specific validation. */
export function normalizeLicenceNumber(input: string): string {
  const normalized = input
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
  if (!/^[A-Z0-9]{4,64}$/.test(normalized))
    throw new ValidationError(
      "INVALID_LICENCE_NUMBER",
      "Licence number contains unsupported characters",
    );
  return normalized;
}

export function licenceLastFour(normalizedLicenceNumber: string): string {
  return normalizedLicenceNumber.slice(-4);
}
