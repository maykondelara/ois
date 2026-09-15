/* eslint-disable no-unused-vars */
import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/modules/identity/tenant-context";
import {
  createIssuesForFailedInspectionResponses,
  releaseVehicleFromResolvedIssues,
} from "@/modules/issues/issue.service";

const manager: TenantContext = {
  actorUserId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "MANAGER",
  permissions: new Set(["issues.read", "issues.manage", "issues.resolve", "vehicles.release"]),
};

const submission = {
  id: "44444444-4444-4444-8444-444444444444",
  companyId: manager.companyId,
  templateId: "55555555-5555-4555-8555-555555555555",
  templateVersionId: "66666666-6666-4666-8666-666666666666",
  vehicleId: "77777777-7777-4777-8777-777777777777",
  driverId: null,
  status: "SUBMITTED" as const,
  outcome: "FAIL" as const,
  vehicleRegistrationSnapshot: "TRUCK1",
  templateNameSnapshot: "Pre-start",
  driverDisplayNameSnapshot: null,
  startedByUserId: manager.actorUserId,
  startedAt: new Date(),
  submittedAt: new Date(),
  cancelledAt: null,
  cancelledByUserId: null,
  cancellationReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function engineFake(initialStatus: "ACTIVE" | "OUT_OF_SERVICE" = "ACTIVE") {
  let vehicleStatus = initialStatus;
  const issues: Array<Record<string, unknown>> = [];
  const statusHistory: Array<Record<string, unknown>> = [];
  const holds: Array<Record<string, unknown>> = [];
  const vehicleHistory: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: async () => [{ id: submission.vehicleId }],
    vehicle: {
      findUnique: async () => ({ id: submission.vehicleId, operationalStatus: vehicleStatus }),
      update: async ({ data }: { data: { operationalStatus: "OUT_OF_SERVICE" } }) => {
        vehicleStatus = data.operationalStatus;
        return { id: submission.vehicleId, operationalStatus: vehicleStatus };
      },
    },
    issue: {
      findUnique: async ({
        where,
      }: {
        where: { companyId_inspectionResponseId: { inspectionResponseId: string } };
      }) =>
        issues.find(
          (issue) =>
            issue.inspectionResponseId ===
            where.companyId_inspectionResponseId.inspectionResponseId,
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const issue = { id: `issue-${issues.length + 1}`, status: "OPEN", ...data };
        issues.push(issue);
        return issue;
      },
    },
    issueStatusHistory: {
      create: async ({ data }: { data: Record<string, unknown> }) => (
        statusHistory.push(data),
        data
      ),
    },
    vehicleStatusHistory: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `history-${vehicleHistory.length + 1}`, ...data };
        vehicleHistory.push(row);
        return row;
      },
    },
    vehicleDefectHold: {
      create: async ({ data }: { data: Record<string, unknown> }) => (holds.push(data), data),
    },
    activity: {
      create: async ({ data }: { data: Record<string, unknown> }) => (audits.push(data), data),
    },
  };
  return { tx, issues, statusHistory, holds, vehicleHistory, audits, status: () => vehicleStatus };
}

function failedResponse(id: string, questionId: string) {
  return {
    id,
    companyId: manager.companyId,
    submissionId: submission.id,
    templateVersionId: submission.templateVersionId,
    questionId,
    booleanValue: false,
    textValue: null,
    numberValue: null,
    odometerValueKm: null,
    comment: null,
    outcome: "FAIL" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function question(id: string, operationalImpact: "NON_BLOCKING" | "VEHICLE_BLOCKING") {
  return {
    id,
    companyId: manager.companyId,
    templateVersionId: submission.templateVersionId,
    sectionId: "88888888-8888-4888-8888-888888888888",
    label: `Question ${id}`,
    helpText: null,
    isRequired: true,
    responseType: "PASS_FAIL" as const,
    sortOrder: 1,
    failureBooleanValue: null,
    minimumValue: null,
    maximumValue: null,
    commentRule: "OPTIONAL" as const,
    photoRequirement: "NEVER" as const,
    operationalImpact,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("inspection issue engine", () => {
  it("creates a non-blocking issue without changing vehicle status", async () => {
    const fake = engineFake();
    await createIssuesForFailedInspectionResponses(
      fake.tx as never,
      manager,
      submission,
      [failedResponse("response-1", "question-1")],
      [question("question-1", "NON_BLOCKING")],
    );
    expect(fake.issues).toHaveLength(1);
    expect(fake.issues[0]).toMatchObject({ operationalImpact: "NON_BLOCKING", severity: "MEDIUM" });
    expect(fake.status()).toBe("ACTIVE");
    expect(fake.holds).toHaveLength(0);
    expect(fake.vehicleHistory).toHaveLength(0);
  });

  it("creates a blocking issue/OOS hold once under retried processing", async () => {
    const fake = engineFake();
    const responses = [failedResponse("response-1", "question-1")];
    const questions = [question("question-1", "VEHICLE_BLOCKING")];
    await createIssuesForFailedInspectionResponses(
      fake.tx as never,
      manager,
      submission,
      responses,
      questions,
    );
    await createIssuesForFailedInspectionResponses(
      fake.tx as never,
      manager,
      submission,
      responses,
      questions,
    );
    expect(fake.issues).toHaveLength(1);
    expect(fake.issues[0]).toMatchObject({
      operationalImpact: "VEHICLE_BLOCKING",
      severity: "HIGH",
    });
    expect(fake.status()).toBe("OUT_OF_SERVICE");
    expect(fake.holds).toHaveLength(1);
    expect(fake.vehicleHistory).toHaveLength(1);
  });
});

function releaseFake(unresolved: number) {
  const updates: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  const hold = { id: "hold-1", appliedStatusHistoryId: "status-oos", releasedAt: null };
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: submission.vehicleId }],
    vehicle: {
      findUnique: async () => ({ id: submission.vehicleId, operationalStatus: "OUT_OF_SERVICE" }),
      update: async ({ data }: { data: Record<string, unknown> }) => ({
        id: submission.vehicleId,
        ...data,
      }),
    },
    issue: { count: async () => unresolved },
    vehicleDefectHold: {
      findMany: async () => [hold],
      updateMany: async ({ data }: { data: Record<string, unknown> }) => (
        updates.push(data),
        { count: 1 }
      ),
    },
    vehicleStatusHistory: {
      findFirst: async () => ({ id: "status-oos", toStatus: "OUT_OF_SERVICE", source: "DEFECT" }),
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "status-release",
        ...data,
      }),
    },
    activity: {
      create: async ({ data }: { data: Record<string, unknown> }) => (activities.push(data), data),
    },
  };
  return {
    updates,
    activities,
    client: {
      $transaction: async <T>(operation: (value: typeof tx) => Promise<T>) => operation(tx),
    },
  };
}

describe("vehicle defect release", () => {
  it("denies release while another blocking issue remains unresolved", async () => {
    await expect(
      releaseVehicleFromResolvedIssues(
        releaseFake(1).client as never,
        manager,
        submission.vehicleId,
        "Safe",
      ),
    ).rejects.toMatchObject({ code: "VEHICLE_BLOCKING_ISSUES_REMAIN" });
  });

  it("releases only through an auditable defect-origin transition", async () => {
    const fake = releaseFake(0);
    const vehicle = await releaseVehicleFromResolvedIssues(
      fake.client as never,
      manager,
      submission.vehicleId,
      "Repairs inspected",
    );
    expect(vehicle).toMatchObject({ operationalStatus: "ACTIVE" });
    expect(fake.updates).toHaveLength(1);
    expect(fake.activities[0]).toMatchObject({ action: "vehicle.released_from_defect_hold" });
  });

  it("never grants DRIVER vehicle release authority", async () => {
    await expect(
      releaseVehicleFromResolvedIssues(
        releaseFake(0).client as never,
        { ...manager, role: "DRIVER", permissions: new Set(["issues.read"]) },
        submission.vehicleId,
        "Unsafe request",
      ),
    ).rejects.toMatchObject({ name: "AuthorizationError" });
  });
});
