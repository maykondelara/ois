import type { ComplianceSubjectType } from "@prisma/client";
import {
  isDateWithinInclusiveRange,
  statusForExpiry,
  summarizeCompliance,
  type ComplianceStatus,
} from "@/modules/compliance/compliance-domain";
export type EvidenceCandidate = Readonly<{
  id: string;
  createdAt: Date;
  validFrom: Date | null;
  expiryDate: Date | null;
  usable: boolean;
  pending: boolean;
}>;

/** A complete PDF is the stable display/export preference when both forms exist. */
export function selectDriverLicenceAttachmentRepresentation(
  roles: Iterable<"FRONT" | "BACK" | "COMBINED">,
): "COMBINED" | "FRONT_BACK" | null {
  const present = new Set(roles);
  if (present.has("COMBINED")) return "COMBINED";
  return present.has("FRONT") && present.has("BACK") ? "FRONT_BACK" : null;
}

export function selectDocumentEvidence(
  candidates: readonly EvidenceCandidate[],
  evaluationDate: Date,
) {
  const eligible = candidates.filter(
    (item) => item.usable && (!item.validFrom || item.validFrom <= evaluationDate),
  );
  const valid = eligible.filter((item) => !item.expiryDate || item.expiryDate >= evaluationDate);
  const ranked = (items: readonly EvidenceCandidate[]) =>
    [...items].sort(
      (a, b) =>
        (a.expiryDate === null
          ? -1
          : b.expiryDate === null
            ? 1
            : b.expiryDate.getTime() - a.expiryDate.getTime()) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id.localeCompare(a.id),
    );
  return {
    selected: ranked(valid)[0] ?? ranked(eligible)[0] ?? null,
    hasPendingReview: candidates.some((item) => item.pending),
  };
}
export function evaluateEvidence(
  candidates: readonly EvidenceCandidate[],
  evaluationDate: Date,
  warningDays: number,
  reasonWhenMissing = "NO_EVIDENCE",
) {
  const result = selectDocumentEvidence(candidates, evaluationDate);
  const status: ComplianceStatus = result.selected
    ? statusForExpiry(result.selected.expiryDate, evaluationDate, warningDays)
    : "MISSING";
  return {
    status,
    reason: result.selected ? null : reasonWhenMissing,
    hasPendingReview: result.hasPendingReview,
  };
}
export function isExemptionEffective(
  effectiveFrom: Date | null,
  expiresOn: Date | null,
  evaluationDate: Date,
) {
  return isDateWithinInclusiveRange(evaluationDate, effectiveFrom, expiresOn);
}
export function subjectComplianceSummary(statuses: readonly ComplianceStatus[]) {
  return summarizeCompliance(statuses);
}
export type ComplianceEvaluationSubject = ComplianceSubjectType;
