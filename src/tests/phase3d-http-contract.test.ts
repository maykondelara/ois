import { describe, expect, it } from "vitest";
import { issueDto } from "@/lib/http/phase3d-dto";
import {
  issueActionInput,
  issueResolutionInput,
  issueSeverityInput,
  vehicleReleaseInput,
} from "@/lib/http/phase3d-input";

describe("Phase 3D.2 HTTP contracts", () => {
  it("rejects client-forged lifecycle, blocking and resolution state", () => {
    expect(() =>
      issueActionInput.parse({ actionType: "REPAIR", description: "Done", status: "RESOLVED" }),
    ).toThrow();
    expect(() =>
      issueResolutionInput.parse({ resolutionNotes: "Fixed", releaseVehicle: true }),
    ).toThrow();
    expect(() =>
      issueSeverityInput.parse({
        severity: "LOW",
        reason: "Reviewed",
        operationalImpact: "NON_BLOCKING",
      }),
    ).toThrow();
    expect(() =>
      vehicleReleaseInput.parse({ reason: "Safe", operationalStatus: "ACTIVE" }),
    ).toThrow();
  });

  it("exposes an explicit operational DTO without tenant or creator internals", () => {
    const dto = issueDto({
      id: "issue-a",
      companyId: "company-a",
      vehicleId: "vehicle-a",
      inspectionSubmissionId: "submission-a",
      inspectionResponseId: "response-a",
      inspectionTemplateVersionId: "version-a",
      inspectionQuestionId: "question-a",
      operationalImpact: "VEHICLE_BLOCKING",
      severity: "HIGH",
      status: "RESOLVED",
      vehicleRegistrationSnapshot: "TRUCK1",
      templateNameSnapshot: "Pre-start",
      questionLabelSnapshot: "Brakes",
      createdByUserId: "user-a",
      createdAt: new Date("2030-01-01T00:00:00Z"),
      resolvedByUserId: "user-b",
      resolvedAt: new Date("2030-01-02T00:00:00Z"),
      resolutionNotes: "Repaired",
      closedByUserId: null,
      closedAt: null,
      updatedAt: new Date("2030-01-02T00:00:00Z"),
    });
    expect(dto).toMatchObject({
      isVehicleBlocking: true,
      questionLabel: "Brakes",
      resolutionNotes: "Repaired",
    });
    expect(dto).not.toHaveProperty("companyId");
    expect(dto).not.toHaveProperty("createdByUserId");
  });
});
