import type { InspectionOperationalImpact, IssueSeverity, IssueStatus } from "@prisma/client";
import { ValidationError } from "@/lib/errors";

export function initialIssueSeverity(impact: InspectionOperationalImpact): IssueSeverity {
  return impact === "VEHICLE_BLOCKING" ? "HIGH" : "MEDIUM";
}

const allowedTransitions: Readonly<Record<IssueStatus, readonly IssueStatus[]>> = {
  OPEN: ["IN_PROGRESS", "RESOLVED"],
  IN_PROGRESS: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export function validateIssueStatusTransition(from: IssueStatus, to: IssueStatus) {
  if (!allowedTransitions[from].includes(to))
    throw new ValidationError(
      "INVALID_ISSUE_STATUS_TRANSITION",
      `Issue cannot transition from ${from} to ${to}`,
    );
}
