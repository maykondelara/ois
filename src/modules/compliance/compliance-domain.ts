import type { DriverLicenceClass } from "@prisma/client";

export type ComplianceStatus = "COMPLIANT" | "EXPIRING_SOON" | "EXPIRED" | "MISSING";
export type SubjectSummaryStatus = "COMPLIANT" | "AT_RISK" | "NON_COMPLIANT" | "NOT_EVALUATED";
export type LegalEntitlement = "ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";
export type EffectiveVehicleAuthorization = "AUTHORIZED" | "NOT_AUTHORIZED" | "UNKNOWN";

const licenceRank: Record<DriverLicenceClass, number> = {
  C: 0,
  LR: 1,
  MR: 2,
  HR: 3,
  HC: 4,
  MC: 5,
};

export function legalLicenceEntitlement(
  held: DriverLicenceClass | null,
  required: DriverLicenceClass | null,
): LegalEntitlement {
  if (!held || !required) return "UNKNOWN";
  return licenceRank[held] >= licenceRank[required] ? "ELIGIBLE" : "NOT_ELIGIBLE";
}

export function effectiveVehicleAuthorization(
  legal: LegalEntitlement,
  hasActiveCompanyAuthorization: boolean,
): EffectiveVehicleAuthorization {
  if (legal === "UNKNOWN") return "UNKNOWN";
  if (legal === "NOT_ELIGIBLE" || !hasActiveCompanyAuthorization) return "NOT_AUTHORIZED";
  return "AUTHORIZED";
}

export function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function isDateWithinInclusiveRange(value: Date, from: Date | null, until: Date | null) {
  const key = dateKey(value);
  return (!from || key >= dateKey(from)) && (!until || key <= dateKey(until));
}

export function rangesOverlap(
  first: { from: Date | null; until: Date | null },
  second: { from: Date | null; until: Date | null },
) {
  const firstFrom = first.from ? dateKey(first.from) : "0001-01-01";
  const secondFrom = second.from ? dateKey(second.from) : "0001-01-01";
  const firstUntil = first.until ? dateKey(first.until) : "9999-12-31";
  const secondUntil = second.until ? dateKey(second.until) : "9999-12-31";
  return firstFrom <= secondUntil && secondFrom <= firstUntil;
}

export function statusForExpiry(
  expiryDate: Date | null,
  evaluationDate: Date,
  warningDays: number,
): ComplianceStatus {
  if (!expiryDate) return "COMPLIANT";
  const dayMs = 86_400_000;
  const daysRemaining = Math.round(
    (Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate()) -
      Date.UTC(
        evaluationDate.getUTCFullYear(),
        evaluationDate.getUTCMonth(),
        evaluationDate.getUTCDate(),
      )) /
      dayMs,
  );
  if (daysRemaining < 0) return "EXPIRED";
  return daysRemaining <= warningDays ? "EXPIRING_SOON" : "COMPLIANT";
}

export function daysUntilExpiry(expiryDate: Date | null, evaluationDate: Date) {
  if (!expiryDate) return null;
  const dayMs = 86_400_000;
  return Math.round(
    (Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate()) -
      Date.UTC(
        evaluationDate.getUTCFullYear(),
        evaluationDate.getUTCMonth(),
        evaluationDate.getUTCDate(),
      )) /
      dayMs,
  );
}

export function summarizeCompliance(statuses: readonly ComplianceStatus[]): {
  status: SubjectSummaryStatus;
  percentage: number | null;
} {
  if (statuses.length === 0) return { status: "NOT_EVALUATED", percentage: null };
  const valid = statuses.filter((status) => status === "COMPLIANT" || status === "EXPIRING_SOON");
  const percentage = (valid.length / statuses.length) * 100;
  if (statuses.some((status) => status === "MISSING" || status === "EXPIRED"))
    return { status: "NON_COMPLIANT", percentage };
  if (statuses.some((status) => status === "EXPIRING_SOON"))
    return { status: "AT_RISK", percentage };
  return { status: "COMPLIANT", percentage };
}

/** Validates bytes read from storage, never client-supplied filename or MIME. */
export function detectSupportedFileType(
  content: Uint8Array,
): "application/pdf" | "image/jpeg" | "image/png" | null {
  if (content.length >= 5 && new TextDecoder().decode(content.slice(0, 5)) === "%PDF-")
    return "application/pdf";
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff)
    return "image/jpeg";
  if (
    content.length >= 8 &&
    content[0] === 0x89 &&
    content[1] === 0x50 &&
    content[2] === 0x4e &&
    content[3] === 0x47 &&
    content[4] === 0x0d &&
    content[5] === 0x0a &&
    content[6] === 0x1a &&
    content[7] === 0x0a
  )
    return "image/png";
  return null;
}
