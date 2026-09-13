import { describe, expect, it } from "vitest";
import { selectDriverLicence } from "@/modules/drivers/driver-licence-selector";

function licence(overrides: Record<string, unknown>) {
  return {
    id: "licence-a",
    companyId: "company-a",
    driverId: "driver-a",
    licenceType: "DRIVER_LICENCE",
    issuingJurisdiction: null,
    licenceNumberCiphertext: "ciphertext",
    licenceNumberLookupHash: new Uint8Array(32),
    licenceNumberLast4: "1234",
    licenceNumberKeyVersion: "v1",
    issuedOn: null,
    expiresOn: new Date("2030-12-31"),
    licenceClass: "HR",
    validFrom: new Date("2025-01-01"),
    replacesLicenceId: null,
    revokedAt: null,
    revokedByUserId: null,
    revocationReason: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  } as never;
}

describe("driver licence authority selection", () => {
  it("keeps a predecessor authoritative until a future successor becomes effective", () => {
    const predecessor = licence({ id: "old", validFrom: new Date("2024-01-01") });
    const successor = licence({
      id: "new",
      validFrom: new Date("2027-01-01"),
      replacesLicenceId: "old",
    });
    expect(selectDriverLicence([predecessor, successor], new Date("2026-01-01"))).toMatchObject({
      kind: "RESOLVED",
      licence: { id: "old" },
    });
  });

  it("does not resurrect a predecessor after its effective successor is revoked", () => {
    const predecessor = licence({ id: "old", validFrom: new Date("2024-01-01") });
    const successor = licence({
      id: "new",
      validFrom: new Date("2025-01-01"),
      replacesLicenceId: "old",
      revokedAt: new Date("2026-01-01"),
    });
    expect(selectDriverLicence([predecessor, successor], new Date("2026-06-01"))).toEqual({
      kind: "NONE",
    });
  });

  it("fails closed for multiple indistinguishable legacy licences", () => {
    expect(
      selectDriverLicence(
        [licence({ id: "one", validFrom: null }), licence({ id: "two", validFrom: null })],
        new Date("2026-01-01"),
      ),
    ).toEqual({ kind: "AMBIGUOUS" });
  });
});
