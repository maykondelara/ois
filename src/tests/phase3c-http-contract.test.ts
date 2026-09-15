import { describe, expect, it } from "vitest";
import {
  applicabilityInput,
  optionUpdateInput,
  questionInput,
  responseInput,
  sectionUpdateInput,
  submitInput,
} from "@/lib/http/phase3c-input";
import { inspectionQuestionDto, inspectionSubmissionDto } from "@/lib/http/phase3c-dto";

describe("Phase 3C.2 inspection HTTP contracts", () => {
  it("accepts supported configuration and rejects client-owned lifecycle fields", () => {
    expect(
      questionInput.parse({
        sectionId: crypto.randomUUID(),
        label: "Tyres safe",
        responseType: "PASS_FAIL",
        sortOrder: 1,
      }),
    ).toMatchObject({ responseType: "PASS_FAIL" });
    expect(() => sectionUpdateInput.parse({ isActive: false })).toThrow();
    expect(() => optionUpdateInput.parse({ id: crypto.randomUUID() })).toThrow();
    expect(() => applicabilityInput.parse({ mode: "ALL_ELIGIBLE", outcome: "PASS" })).toThrow();
  });

  it("never accepts client-provided response outcomes or applicability decisions", () => {
    expect(() =>
      responseInput.parse({ questionId: crypto.randomUUID(), booleanValue: true, outcome: "PASS" }),
    ).toThrow();
    expect(() => submitInput.parse({ outcome: "PASS" })).toThrow();
  });

  it("redacts tenant and actor fields from inspection DTOs", () => {
    const question = inspectionQuestionDto({
      id: "question-id",
      companyId: "company-id",
      templateVersionId: "version-id",
      sectionId: "section-id",
      label: "Lights",
      helpText: null,
      isRequired: true,
      responseType: "PASS_FAIL",
      sortOrder: 1,
      failureBooleanValue: null,
      minimumValue: null,
      maximumValue: null,
      commentRule: "OPTIONAL",
      photoRequirement: "NEVER",
      operationalImpact: "NON_BLOCKING",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const submission = inspectionSubmissionDto({
      id: "submission-id",
      companyId: "company-id",
      templateId: "template-id",
      templateVersionId: "version-id",
      vehicleId: "vehicle-id",
      driverId: null,
      status: "DRAFT",
      outcome: null,
      vehicleRegistrationSnapshot: "ABC123",
      templateNameSnapshot: "Pre-start",
      driverDisplayNameSnapshot: null,
      startedByUserId: "actor-id",
      startedAt: new Date(),
      submittedAt: null,
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(question).not.toHaveProperty("companyId");
    expect(submission).not.toHaveProperty("companyId");
    expect(submission).not.toHaveProperty("startedByUserId");
  });
});
