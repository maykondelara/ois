import type { DriverLicence } from "@prisma/client";
import { isDateWithinInclusiveRange } from "@/modules/compliance/compliance-domain";

export type DriverLicenceSelection =
  { kind: "NONE" } | { kind: "AMBIGUOUS" } | { kind: "RESOLVED"; licence: DriverLicence };

/** Resolves only known, non-revoked rows; legacy ambiguity is never positive evidence. */
export function selectDriverLicence(
  licences: readonly DriverLicence[],
  evaluationDate: Date,
): DriverLicenceSelection {
  const usable = licences.filter(
    (licence) =>
      !licence.revokedAt &&
      isDateWithinInclusiveRange(evaluationDate, licence.validFrom, licence.expiresOn),
  );
  const effective = usable.filter(
    (licence) =>
      !licences.some(
        (successor) =>
          successor.replacesLicenceId === licence.id &&
          successor.validFrom &&
          successor.validFrom <= evaluationDate,
      ),
  );
  if (effective.length === 0) return { kind: "NONE" };
  const known = effective
    .filter((licence) => licence.validFrom !== null)
    .sort((a, b) => b.validFrom!.getTime() - a.validFrom!.getTime() || b.id.localeCompare(a.id));
  if (known.length > 0) return { kind: "RESOLVED", licence: known[0]! };
  return effective.length === 1
    ? { kind: "RESOLVED", licence: effective[0]! }
    : { kind: "AMBIGUOUS" };
}
