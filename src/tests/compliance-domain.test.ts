import { describe, expect, it } from "vitest";
import {
  detectSupportedFileType,
  effectiveVehicleAuthorization,
  legalLicenceEntitlement,
  rangesOverlap,
  statusForExpiry,
  summarizeCompliance,
} from "@/modules/compliance/compliance-domain";
import {
  evaluateEvidence,
  selectDriverLicenceAttachmentRepresentation,
} from "@/modules/compliance/compliance-evaluation";

describe("Phase 3B.2 compliance domain", () => {
  it("uses inclusive, open-ended exemption intervals", () => {
    expect(
      rangesOverlap(
        { from: null, until: new Date("2026-03-31") },
        { from: new Date("2026-03-31"), until: null },
      ),
    ).toBe(true);
    expect(
      rangesOverlap(
        { from: new Date("2026-01-01"), until: new Date("2026-03-31") },
        { from: new Date("2026-04-01"), until: null },
      ),
    ).toBe(false);
  });
  it("keeps Australian legal entitlement distinct from company authorization", () => {
    expect(legalLicenceEntitlement("HC", "HR")).toBe("ELIGIBLE");
    expect(legalLicenceEntitlement("HC", "MC")).toBe("NOT_ELIGIBLE");
    expect(legalLicenceEntitlement(null, "C")).toBe("UNKNOWN");
    expect(effectiveVehicleAuthorization("ELIGIBLE", true)).toBe("AUTHORIZED");
    expect(effectiveVehicleAuthorization("UNKNOWN", true)).toBe("UNKNOWN");
  });
  it("uses inclusive expiry and warning boundaries", () => {
    expect(statusForExpiry(new Date("2026-01-10"), new Date("2026-01-10"), 30)).toBe(
      "EXPIRING_SOON",
    );
    expect(statusForExpiry(new Date("2026-01-09"), new Date("2026-01-10"), 30)).toBe("EXPIRED");
    expect(summarizeCompliance([])).toEqual({ status: "NOT_EVALUATED", percentage: null });
  });
  it("validates actual PDF, JPEG, and PNG signatures", () => {
    expect(detectSupportedFileType(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(detectSupportedFileType(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(
      detectSupportedFileType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("image/png");
  });
  it("never lets pending evidence satisfy compliance", () => {
    expect(
      evaluateEvidence(
        [
          {
            id: "pending",
            createdAt: new Date(),
            validFrom: null,
            expiryDate: null,
            usable: false,
            pending: true,
          },
        ],
        new Date("2026-01-01"),
        30,
      ),
    ).toMatchObject({ status: "MISSING", hasPendingReview: true });
  });
  it("keeps expired truth visible while a replacement is pending", () => {
    expect(
      evaluateEvidence(
        [
          {
            id: "expired",
            createdAt: new Date("2025-01-01"),
            validFrom: null,
            expiryDate: new Date("2025-12-31"),
            usable: true,
            pending: false,
          },
          {
            id: "replacement",
            createdAt: new Date("2026-01-01"),
            validFrom: null,
            expiryDate: new Date("2027-12-31"),
            usable: false,
            pending: true,
          },
        ],
        new Date("2026-01-02"),
        30,
      ),
    ).toEqual({ status: "EXPIRED", reason: null, hasPendingReview: true });
  });
  it("prefers a combined licence representation without changing completeness semantics", () => {
    expect(selectDriverLicenceAttachmentRepresentation(["FRONT", "BACK"])).toBe("FRONT_BACK");
    expect(selectDriverLicenceAttachmentRepresentation(["FRONT", "BACK", "COMBINED"])).toBe(
      "COMBINED",
    );
    expect(selectDriverLicenceAttachmentRepresentation(["FRONT"])).toBeNull();
  });
});
