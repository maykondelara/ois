import { describe, expect, it } from "vitest";
import {
  deriveInspectionOutcome,
  deriveResponse,
  validateSubmissionResponse,
  validateTemplatePublication,
  type InspectionQuestionRule,
} from "@/modules/inspections/inspection-rules";

function question(overrides: Partial<InspectionQuestionRule> = {}): InspectionQuestionRule {
  return {
    id: "question",
    responseType: "PASS_FAIL",
    isRequired: true,
    failureBooleanValue: null,
    minimumValue: null,
    maximumValue: null,
    commentRule: "OPTIONAL",
    photoRequirement: "NEVER",
    options: [],
    ...overrides,
  };
}

describe("inspection rule engine", () => {
  it("derives deterministic boolean failure, comment and photo triggers", () => {
    const rule = question({
      responseType: "YES_NO",
      failureBooleanValue: false,
      commentRule: "REQUIRED_ON_TRIGGER",
      photoRequirement: "ON_FAILURE",
    });
    expect(deriveResponse(rule, { booleanValue: true })).toMatchObject({ outcome: "PASS" });
    expect(validateSubmissionResponse(rule, { booleanValue: false })).toMatchObject({
      errors: ["TRIGGERED_COMMENT_REQUIRED", "TRIGGERED_PHOTO_REQUIRED"],
    });
    expect(
      validateSubmissionResponse(rule, { booleanValue: false, comment: "Tyre worn", fileCount: 1 })
        .errors,
    ).toEqual([]);
  });

  it("enforces typed required and numeric boundary semantics", () => {
    const text = question({ responseType: "TEXT" });
    expect(validateSubmissionResponse(text, { textValue: "   " }).errors).toContain(
      "REQUIRED_RESPONSE_MISSING",
    );
    const numeric = question({ responseType: "NUMBER", minimumValue: 10, maximumValue: 20 });
    expect(deriveResponse(numeric, { numberValue: 10 }).outcome).toBe("PASS");
    expect(deriveResponse(numeric, { numberValue: 21 }).outcome).toBe("FAIL");
  });

  it("validates choice ownership and failure selection", () => {
    const choices = question({
      responseType: "MULTI_CHOICE",
      options: [
        { id: "pass", isFailure: false },
        { id: "fail", isFailure: true },
      ],
    });
    expect(deriveResponse(choices, { optionIds: ["pass", "fail"] }).outcome).toBe("FAIL");
    expect(validateSubmissionResponse(choices, { optionIds: ["wrong"] }).errors).toContain(
      "INVALID_OPTION_SELECTION",
    );
  });

  it("implements PASS_FAIL, CHECKBOX, PHOTO and SIGNATURE required semantics", () => {
    expect(deriveResponse(question(), { booleanValue: true }).outcome).toBe("PASS");
    expect(deriveResponse(question(), { booleanValue: false }).outcome).toBe("FAIL");

    const checkbox = question({
      responseType: "CHECKBOX",
      failureBooleanValue: false,
      commentRule: "REQUIRED_ON_TRIGGER",
    });
    expect(validateSubmissionResponse(checkbox, { booleanValue: false }).errors).toContain(
      "TRIGGERED_COMMENT_REQUIRED",
    );

    const photo = question({ responseType: "PHOTO" });
    expect(validateSubmissionResponse(photo, { fileCount: 0 }).errors).toContain(
      "REQUIRED_RESPONSE_MISSING",
    );
    expect(validateSubmissionResponse(photo, { fileCount: 1 }).errors).toEqual([]);

    const signature = question({ responseType: "SIGNATURE" });
    expect(validateSubmissionResponse(signature, { fileCount: 0 }).errors).toContain(
      "REQUIRED_RESPONSE_MISSING",
    );
  });

  it("derives number and odometer range boundaries without accepting malformed values", () => {
    const number = question({ responseType: "NUMBER", minimumValue: 100, maximumValue: 200 });
    expect(deriveResponse(number, { numberValue: 100 }).outcome).toBe("PASS");
    expect(deriveResponse(number, { numberValue: 200 }).outcome).toBe("PASS");
    expect(deriveResponse(number, { numberValue: 99 }).outcome).toBe("FAIL");

    const odometer = question({
      responseType: "ODOMETER",
      minimumValue: 1,
      maximumValue: 1_000_000,
    });
    expect(validateSubmissionResponse(odometer, { odometerValueKm: -1 }).errors).toContain(
      "INVALID_ODOMETER_VALUE",
    );
    expect(deriveResponse(odometer, { odometerValueKm: 1_000_001 }).outcome).toBe("FAIL");
  });

  it("rejects values structurally incompatible with the published question type", () => {
    const text = question({ responseType: "TEXT" });
    expect(
      validateSubmissionResponse(text, { textValue: "ok", booleanValue: true }).errors,
    ).toContain("INVALID_RESPONSE_VALUE_TYPE");
    const passFail = question();
    expect(
      validateSubmissionResponse(passFail, { booleanValue: true, optionIds: ["unexpected"] })
        .errors,
    ).toContain("INVALID_RESPONSE_VALUE_TYPE");
  });

  it("rejects invalid publication and derives overall fail precedence", () => {
    expect(validateTemplatePublication([])).toContain("TEMPLATE_HAS_NO_SECTIONS");
    expect(validateTemplatePublication([{ id: "s", questions: [] }])).toContain("SECTION_s_EMPTY");
    expect(deriveInspectionOutcome(["PASS", "NEUTRAL", "FAIL"])).toBe("FAIL");
    expect(deriveInspectionOutcome(["PASS", "NEUTRAL"])).toBe("PASS");
  });

  it("rejects a template with more than one authoritative odometer question", () => {
    const odometer = question({ responseType: "ODOMETER" });
    expect(
      validateTemplatePublication([
        { id: "section", questions: [odometer, { ...odometer, id: "two" }] },
      ]),
    ).toContain("TEMPLATE_HAS_MULTIPLE_ODOMETER_QUESTIONS");
  });
});
