import {
  Prisma,
  type InspectionQuestion,
  type InspectionResponse,
  type InspectionSubmission,
  type IssueActionType,
  type IssueSeverity,
  type IssueStatus,
  type PrismaClient,
} from "@prisma/client";
import { withTenantTransaction, type TenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission, requireRecordScope } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
import { initialIssueSeverity, validateIssueStatusTransition } from "@/modules/issues/issue-rules";

type TenantClient = Pick<PrismaClient, "$transaction">;
type IssuePage = Readonly<{ number: number; pageSize: number }>;
export type IssueListFilters = Readonly<{
  status?: IssueStatus | undefined;
  severity?: IssueSeverity | undefined;
  operationalImpact?: "NON_BLOCKING" | "VEHICLE_BLOCKING" | undefined;
  vehicleId?: string | undefined;
}>;

async function lockVehicle(tx: TenantTransaction, context: TenantContext, vehicleId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id::text FROM vehicles WHERE company_id = ${context.companyId}::uuid AND id = ${vehicleId}::uuid FOR UPDATE`,
  );
  if (rows.length !== 1) throw new TenantRecordNotFoundError("Vehicle");
}

async function lockIssue(tx: TenantTransaction, context: TenantContext, issueId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id::text FROM issues WHERE company_id = ${context.companyId}::uuid AND id = ${issueId}::uuid FOR UPDATE`,
  );
  if (rows.length !== 1) throw new TenantRecordNotFoundError("Issue");
}

async function requireIssue(tx: TenantTransaction, context: TenantContext, issueId: string) {
  const issue = await tx.issue.findUnique({
    where: { companyId_id: { companyId: context.companyId, id: issueId } },
  });
  if (!issue) throw new TenantRecordNotFoundError("Issue");
  return issue;
}

async function requireDriverIssueScope(
  tx: TenantTransaction,
  context: TenantContext,
  inspectionSubmissionId: string,
) {
  if (context.role !== "DRIVER") return;
  const submission = await tx.inspectionSubmission.findUnique({
    where: {
      companyId_id: { companyId: context.companyId, id: inspectionSubmissionId },
    },
    select: { driverId: true },
  });
  const driver = submission?.driverId
    ? await tx.driver.findUnique({
        where: { companyId_id: { companyId: context.companyId, id: submission.driverId } },
        select: { companyId: true, userId: true },
      })
    : null;
  requireRecordScope(context, {
    companyId: context.companyId,
    driverUserId: driver?.userId ?? null,
  });
}

/** Runs inside final inspection submission so issue/OOS writes commit atomically. */
export async function createIssuesForFailedInspectionResponses(
  tx: TenantTransaction,
  context: TenantContext,
  submission: InspectionSubmission,
  responses: readonly InspectionResponse[],
  questions: readonly InspectionQuestion[],
) {
  const failed = responses.filter((response) => response.outcome === "FAIL");
  if (failed.length === 0) return [];
  await lockVehicle(tx, context, submission.vehicleId);
  const vehicle = await tx.vehicle.findUnique({
    where: { companyId_id: { companyId: context.companyId, id: submission.vehicleId } },
  });
  if (!vehicle) throw new TenantRecordNotFoundError("Vehicle");
  let currentStatus = vehicle.operationalStatus;
  const created = [];
  for (const response of failed) {
    const question = questions.find((candidate) => candidate.id === response.questionId);
    if (!question || question.templateVersionId !== submission.templateVersionId)
      throw new TenantRecordNotFoundError("Inspection question");
    const existing = await tx.issue.findUnique({
      where: {
        companyId_inspectionResponseId: {
          companyId: context.companyId,
          inspectionResponseId: response.id,
        },
      },
    });
    if (existing) continue;
    const issue = await tx.issue.create({
      data: {
        companyId: context.companyId,
        vehicleId: submission.vehicleId,
        inspectionSubmissionId: submission.id,
        inspectionResponseId: response.id,
        inspectionTemplateVersionId: submission.templateVersionId,
        inspectionQuestionId: question.id,
        operationalImpact: question.operationalImpact,
        severity: initialIssueSeverity(question.operationalImpact),
        vehicleRegistrationSnapshot: submission.vehicleRegistrationSnapshot,
        templateNameSnapshot: submission.templateNameSnapshot,
        questionLabelSnapshot: question.label,
        createdByUserId: context.actorUserId,
      },
    });
    await tx.issueStatusHistory.create({
      data: {
        companyId: context.companyId,
        issueId: issue.id,
        fromStatus: null,
        toStatus: "OPEN",
        reason: "Failed inspection response",
        actorUserId: context.actorUserId,
      },
    });
    let appliedStatusHistoryId: string | null = null;
    if (question.operationalImpact === "VEHICLE_BLOCKING") {
      if (currentStatus === "ACTIVE") {
        await tx.vehicle.update({
          where: { companyId_id: { companyId: context.companyId, id: submission.vehicleId } },
          data: { operationalStatus: "OUT_OF_SERVICE" },
        });
        const history = await tx.vehicleStatusHistory.create({
          data: {
            companyId: context.companyId,
            vehicleId: submission.vehicleId,
            fromStatus: "ACTIVE",
            toStatus: "OUT_OF_SERVICE",
            reason: `Blocking inspection issue ${issue.id} from submission ${submission.id}`,
            source: "DEFECT",
            actorUserId: context.actorUserId,
          },
        });
        appliedStatusHistoryId = history.id;
        currentStatus = "OUT_OF_SERVICE";
        await recordTenantActivity(tx, context, {
          action: "vehicle.out_of_service_by_issue",
          entityType: "vehicle",
          entityId: submission.vehicleId,
          metadata: { issueId: issue.id, inspectionSubmissionId: submission.id },
        });
      }
      await tx.vehicleDefectHold.create({
        data: {
          companyId: context.companyId,
          vehicleId: submission.vehicleId,
          issueId: issue.id,
          appliedStatusHistoryId,
        },
      });
    }
    await recordTenantActivity(tx, context, {
      action: "issue.created",
      entityType: "issue",
      entityId: issue.id,
      metadata: {
        inspectionSubmissionId: submission.id,
        inspectionResponseId: response.id,
        operationalImpact: issue.operationalImpact,
        severity: issue.severity,
      },
    });
    created.push(issue);
  }
  return created;
}

export async function getIssue(client: TenantClient, context: TenantContext, issueId: string) {
  requirePermission(context, "issues.read");
  return withTenantTransaction(client, context, async (tx) => {
    const issue = await requireIssue(tx, context, issueId);
    await requireDriverIssueScope(tx, context, issue.inspectionSubmissionId);
    const [history, actions, vehicle, holds] = await Promise.all([
      tx.issueStatusHistory.findMany({
        where: { companyId: context.companyId, issueId },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      }),
      tx.issueAction.findMany({
        where: { companyId: context.companyId, issueId },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      }),
      tx.vehicle.findUnique({
        where: { companyId_id: { companyId: context.companyId, id: issue.vehicleId } },
        select: { id: true, registrationDisplay: true, operationalStatus: true },
      }),
      tx.vehicleDefectHold.findMany({
        where: { companyId: context.companyId, issueId },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    if (!vehicle) throw new TenantRecordNotFoundError("Vehicle");
    return { issue, history, actions, vehicle, holds };
  });
}

export async function listIssuesPage(
  client: TenantClient,
  context: TenantContext,
  page: IssuePage,
  filters: IssueListFilters = {},
) {
  requirePermission(context, "issues.read");
  return withTenantTransaction(client, context, async (tx) => {
    const where = {
      companyId: context.companyId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
      ...(filters.operationalImpact ? { operationalImpact: filters.operationalImpact } : {}),
      ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
    };
    let ids: string[] | null = null;
    if (context.role === "DRIVER") {
      const driver = await tx.driver.findUnique({
        where: {
          companyId_userId: {
            companyId: context.companyId,
            userId: context.actorUserId,
          },
        },
        select: { id: true },
      });
      if (!driver) throw new TenantRecordNotFoundError("Driver");
      const clauses: Prisma.Sql[] = [
        Prisma.sql`i.company_id = ${context.companyId}::uuid`,
        Prisma.sql`s.driver_id = ${driver.id}::uuid`,
      ];
      if (filters.status) clauses.push(Prisma.sql`i.status = ${filters.status}::"IssueStatus"`);
      if (filters.severity)
        clauses.push(Prisma.sql`i.severity = ${filters.severity}::"IssueSeverity"`);
      if (filters.operationalImpact)
        clauses.push(
          Prisma.sql`i.operational_impact = ${filters.operationalImpact}::"InspectionOperationalImpact"`,
        );
      if (filters.vehicleId) clauses.push(Prisma.sql`i.vehicle_id = ${filters.vehicleId}::uuid`);
      const rows = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT i.id::text
          FROM issues i
          JOIN inspection_submissions s
            ON s.company_id = i.company_id AND s.id = i.inspection_submission_id
          WHERE ${Prisma.join(clauses, " AND ")}
          ORDER BY i.created_at DESC, i.id DESC
          OFFSET ${(page.number - 1) * page.pageSize}
          LIMIT ${page.pageSize + 1}`,
      );
      ids = rows.map((row) => row.id);
    }
    const data = await tx.issue.findMany({
      where: { ...where, ...(ids === null ? {} : { id: { in: ids } }) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(ids === null ? { skip: (page.number - 1) * page.pageSize, take: page.pageSize + 1 } : {}),
    });
    const ordered =
      ids === null
        ? data
        : ids.flatMap((id) => {
            const issue = data.find((candidate) => candidate.id === id);
            return issue ? [issue] : [];
          });
    return { data: ordered.slice(0, page.pageSize), hasNextPage: ordered.length > page.pageSize };
  });
}

export async function startIssueProgress(
  client: TenantClient,
  context: TenantContext,
  issueId: string,
  reason?: string,
) {
  requirePermission(context, "issues.manage");
  return withTenantTransaction(client, context, async (tx) => {
    await lockIssue(tx, context, issueId);
    const issue = await requireIssue(tx, context, issueId);
    validateIssueStatusTransition(issue.status, "IN_PROGRESS");
    const updated = await tx.issue.update({
      where: { companyId_id: { companyId: context.companyId, id: issueId } },
      data: { status: "IN_PROGRESS" },
    });
    await tx.issueStatusHistory.create({
      data: {
        companyId: context.companyId,
        issueId,
        fromStatus: issue.status,
        toStatus: "IN_PROGRESS",
        reason: reason?.trim() || null,
        actorUserId: context.actorUserId,
      },
    });
    await recordTenantActivity(tx, context, {
      action: "issue.status_changed",
      entityType: "issue",
      entityId: issueId,
      metadata: { fromStatus: issue.status, toStatus: "IN_PROGRESS" },
    });
    return updated;
  });
}

export async function addIssueAction(
  client: TenantClient,
  context: TenantContext,
  issueId: string,
  input: Readonly<{ actionType: IssueActionType; description: string; notes?: string | null }>,
) {
  requirePermission(context, "issues.manage");
  if (!input.description.trim())
    throw new ValidationError(
      "ISSUE_ACTION_DESCRIPTION_REQUIRED",
      "Action description is required",
    );
  return withTenantTransaction(client, context, async (tx) => {
    const issue = await requireIssue(tx, context, issueId);
    if (!["OPEN", "IN_PROGRESS"].includes(issue.status))
      throw new ConflictError(
        "ISSUE_ACTION_NOT_ALLOWED",
        "Resolved or closed issues are immutable",
      );
    const action = await tx.issueAction.create({
      data: {
        companyId: context.companyId,
        issueId,
        actionType: input.actionType,
        description: input.description.trim(),
        notes: input.notes?.trim() || null,
        actorUserId: context.actorUserId,
      },
    });
    await recordTenantActivity(tx, context, {
      action: "issue.action_recorded",
      entityType: "issue_action",
      entityId: action.id,
      metadata: { issueId, actionType: action.actionType },
    });
    return action;
  });
}

export async function reclassifyIssueSeverity(
  client: TenantClient,
  context: TenantContext,
  issueId: string,
  severity: IssueSeverity,
  reason: string,
) {
  requirePermission(context, "issues.manage");
  if (!reason.trim())
    throw new ValidationError(
      "ISSUE_CLASSIFICATION_REASON_REQUIRED",
      "Classification reason is required",
    );
  return withTenantTransaction(client, context, async (tx) => {
    await lockIssue(tx, context, issueId);
    const issue = await requireIssue(tx, context, issueId);
    if (!["OPEN", "IN_PROGRESS"].includes(issue.status))
      throw new ConflictError(
        "ISSUE_CLASSIFICATION_NOT_ALLOWED",
        "Resolved or closed issues are immutable",
      );
    const updated = await tx.issue.update({
      where: { companyId_id: { companyId: context.companyId, id: issueId } },
      data: { severity },
    });
    await recordTenantActivity(tx, context, {
      action: "issue.severity_changed",
      entityType: "issue",
      entityId: issueId,
      metadata: { fromSeverity: issue.severity, toSeverity: severity, reason: reason.trim() },
    });
    return updated;
  });
}

export async function resolveIssue(
  client: TenantClient,
  context: TenantContext,
  issueId: string,
  resolutionNotes: string,
) {
  requirePermission(context, "issues.resolve");
  if (!resolutionNotes.trim())
    throw new ValidationError("ISSUE_RESOLUTION_NOTES_REQUIRED", "Resolution notes are required");
  return withTenantTransaction(client, context, async (tx) => {
    await lockIssue(tx, context, issueId);
    const issue = await requireIssue(tx, context, issueId);
    validateIssueStatusTransition(issue.status, "RESOLVED");
    const now = new Date();
    const updated = await tx.issue.update({
      where: { companyId_id: { companyId: context.companyId, id: issueId } },
      data: {
        status: "RESOLVED",
        resolvedByUserId: context.actorUserId,
        resolvedAt: now,
        resolutionNotes: resolutionNotes.trim(),
      },
    });
    await tx.issueStatusHistory.create({
      data: {
        companyId: context.companyId,
        issueId,
        fromStatus: issue.status,
        toStatus: "RESOLVED",
        reason: resolutionNotes.trim(),
        actorUserId: context.actorUserId,
        occurredAt: now,
      },
    });
    await recordTenantActivity(tx, context, {
      action: "issue.resolved",
      entityType: "issue",
      entityId: issueId,
    });
    return updated;
  });
}

export async function closeIssue(
  client: TenantClient,
  context: TenantContext,
  issueId: string,
  reason?: string,
) {
  requirePermission(context, "issues.manage");
  return withTenantTransaction(client, context, async (tx) => {
    await lockIssue(tx, context, issueId);
    const issue = await requireIssue(tx, context, issueId);
    validateIssueStatusTransition(issue.status, "CLOSED");
    const now = new Date();
    const updated = await tx.issue.update({
      where: { companyId_id: { companyId: context.companyId, id: issueId } },
      data: { status: "CLOSED", closedByUserId: context.actorUserId, closedAt: now },
    });
    await tx.issueStatusHistory.create({
      data: {
        companyId: context.companyId,
        issueId,
        fromStatus: issue.status,
        toStatus: "CLOSED",
        reason: reason?.trim() || null,
        actorUserId: context.actorUserId,
        occurredAt: now,
      },
    });
    await recordTenantActivity(tx, context, {
      action: "issue.closed",
      entityType: "issue",
      entityId: issueId,
    });
    return updated;
  });
}

export async function releaseVehicleFromResolvedIssues(
  client: TenantClient,
  context: TenantContext,
  vehicleId: string,
  reason: string,
) {
  requirePermission(context, "vehicles.release");
  if (!reason.trim())
    throw new ValidationError(
      "VEHICLE_RELEASE_REASON_REQUIRED",
      "Vehicle release reason is required",
    );
  return withTenantTransaction(client, context, async (tx) => {
    await lockVehicle(tx, context, vehicleId);
    const vehicle = await tx.vehicle.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: vehicleId } },
    });
    if (!vehicle) throw new TenantRecordNotFoundError("Vehicle");
    if (vehicle.operationalStatus !== "OUT_OF_SERVICE")
      throw new ConflictError(
        "VEHICLE_RELEASE_STATUS_INVALID",
        "Only an out-of-service vehicle can be released",
      );
    const unresolved = await tx.issue.count({
      where: {
        companyId: context.companyId,
        vehicleId,
        operationalImpact: "VEHICLE_BLOCKING",
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
    });
    if (unresolved > 0)
      throw new ConflictError(
        "VEHICLE_BLOCKING_ISSUES_REMAIN",
        "Vehicle still has unresolved blocking issues",
      );
    const holds = await tx.vehicleDefectHold.findMany({
      where: { companyId: context.companyId, vehicleId, releasedAt: null },
    });
    if (holds.length === 0)
      throw new ConflictError(
        "VEHICLE_NOT_HELD_BY_DEFECT",
        "Vehicle out-of-service state is not an active defect hold",
      );
    const latestStatus = await tx.vehicleStatusHistory.findFirst({
      where: { companyId: context.companyId, vehicleId },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    });
    if (
      !latestStatus ||
      latestStatus.toStatus !== "OUT_OF_SERVICE" ||
      latestStatus.source !== "DEFECT" ||
      !holds.some((hold) => hold.appliedStatusHistoryId === latestStatus.id)
    )
      throw new ConflictError(
        "VEHICLE_RELEASE_ORIGIN_UNPROVEN",
        "Vehicle has another or newer out-of-service reason",
      );
    const updated = await tx.vehicle.update({
      where: { companyId_id: { companyId: context.companyId, id: vehicleId } },
      data: { operationalStatus: "ACTIVE" },
    });
    const now = new Date();
    const history = await tx.vehicleStatusHistory.create({
      data: {
        companyId: context.companyId,
        vehicleId,
        fromStatus: "OUT_OF_SERVICE",
        toStatus: "ACTIVE",
        reason: reason.trim(),
        source: "DEFECT",
        actorUserId: context.actorUserId,
        occurredAt: now,
      },
    });
    await tx.vehicleDefectHold.updateMany({
      where: { companyId: context.companyId, vehicleId, releasedAt: null },
      data: {
        releasedAt: now,
        releasedByUserId: context.actorUserId,
        releaseStatusHistoryId: history.id,
      },
    });
    await recordTenantActivity(tx, context, {
      action: "vehicle.released_from_defect_hold",
      entityType: "vehicle",
      entityId: vehicleId,
      metadata: { historyId: history.id, releasedHoldCount: holds.length },
    });
    return updated;
  });
}
