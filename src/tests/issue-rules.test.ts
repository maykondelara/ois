import { describe, expect, it } from "vitest";
import { initialIssueSeverity, validateIssueStatusTransition } from "@/modules/issues/issue-rules";

describe("issue lifecycle rules", () => {
  it("uses a conservative deterministic initial severity independent of blocking state", () => {
    expect(initialIssueSeverity("NON_BLOCKING")).toBe("MEDIUM");
    expect(initialIssueSeverity("VEHICLE_BLOCKING")).toBe("HIGH");
  });

  it("allows only the explicit forward lifecycle", () => {
    expect(() => validateIssueStatusTransition("OPEN", "IN_PROGRESS")).not.toThrow();
    expect(() => validateIssueStatusTransition("OPEN", "RESOLVED")).not.toThrow();
    expect(() => validateIssueStatusTransition("IN_PROGRESS", "RESOLVED")).not.toThrow();
    expect(() => validateIssueStatusTransition("RESOLVED", "CLOSED")).not.toThrow();
    expect(() => validateIssueStatusTransition("RESOLVED", "OPEN")).toThrowError(
      expect.objectContaining({ code: "INVALID_ISSUE_STATUS_TRANSITION" }),
    );
    expect(() => validateIssueStatusTransition("CLOSED", "IN_PROGRESS")).toThrow();
  });
});
