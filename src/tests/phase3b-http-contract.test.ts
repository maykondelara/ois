import { describe, expect, it } from "vitest";
import {
  complianceAggregateDto,
  complianceObligationDto,
  complianceSummaryDto,
  documentDto,
} from "@/lib/http/phase3b-dto";
import {
  documentCreateInput,
  documentTypeUpdateInput,
  documentUpdateInput,
  exemptionCreateInput,
  requirementUpdateInput,
} from "@/lib/http/phase3b-input";

describe("Phase 3B.3 HTTP contracts", () => {
  it("rejects structural document and configuration fields from PATCH input", () => {
    expect(() => documentTypeUpdateInput.parse({ code: "IMMUTABLE" })).toThrow();
    expect(() => requirementUpdateInput.parse({ documentTypeId: crypto.randomUUID() })).toThrow();
    expect(() => documentUpdateInput.parse({ subjectType: "DRIVER" })).toThrow();
    expect(() =>
      documentCreateInput.parse({
        documentTypeId: crypto.randomUUID(),
        subjectType: "DRIVER",
        driverId: crypto.randomUUID(),
        unexpected: true,
      }),
    ).toThrow();
  });

  it("preserves NULL as an open exemption boundary at the HTTP boundary", () => {
    expect(
      exemptionCreateInput.parse({
        subjectType: "DRIVER",
        driverId: crypto.randomUUID(),
        reason: "Temporary exception",
        effectiveFrom: null,
        expiresOn: null,
      }),
    ).toMatchObject({ effectiveFrom: null, expiresOn: null });
  });

  it("serializes only redacted document and compliance DTO fields", () => {
    const document = documentDto({
      id: "document-id",
      companyId: "company-id",
      documentTypeId: "type-id",
      subjectType: "DRIVER",
      driverId: "driver-id",
      vehicleId: null,
      companySubjectId: null,
      issueDate: null,
      validFrom: null,
      expiryDate: null,
      reviewStatus: "PENDING_REVIEW",
      reviewedAt: null,
      reviewedByUserId: null,
      rejectionReason: null,
      archivedAt: null,
      archivedByUserId: null,
      revokedAt: null,
      revokedByUserId: null,
      revocationReason: null,
      createdByUserId: "user-id",
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      updatedAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    const obligation = complianceObligationDto({
      subjectType: "DRIVER",
      subjectId: "driver-id",
      requirementId: "requirement-id",
      requirementName: "Driver licence",
      documentTypeId: "type-id",
      documentTypeName: "Licence",
      status: "EXPIRING_SOON",
      daysRemaining: 3,
      reason: null,
      hasPendingReview: false,
    });
    expect(document).not.toHaveProperty("companyId");
    expect(JSON.stringify({ document, obligation })).not.toMatch(
      /ciphertext|lookup.?hash|bucket|object.?key|storage.?provider/i,
    );
    expect(obligation).toMatchObject({ daysRemaining: 3, status: "EXPIRING_SOON" });
  });

  it("keeps subject and aggregate percentages derived and zero-safe", () => {
    const obligations = [
      {
        subjectType: "DRIVER" as const,
        subjectId: "driver-id",
        requirementId: "requirement-id",
        requirementName: "Requirement",
        documentTypeId: "type-id",
        documentTypeName: "Type",
        status: "COMPLIANT" as const,
        daysRemaining: null,
        reason: null,
        hasPendingReview: true,
      },
    ];
    expect(complianceSummaryDto("COMPLIANT", obligations, 2)).toMatchObject({
      applicableRequirements: 1,
      percentage: 100,
      pendingReviewCount: 1,
      activeExemptionCount: 2,
    });
    expect(complianceSummaryDto("NOT_EVALUATED", [], 0).percentage).toBeNull();
    expect(
      complianceAggregateDto({
        applicableObligationCount: 0,
        compliantOrAtRiskCount: 0,
        percentage: null,
        activeExemptionCount: 0,
        pendingReviewCount: 0,
      }),
    ).toMatchObject({ applicableRequirements: 0, percentage: null });
  });
});
