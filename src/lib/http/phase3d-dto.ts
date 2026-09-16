import type { Issue, IssueAction, IssueStatusHistory, VehicleDefectHold } from "@prisma/client";
import type { TenantContext } from "@/modules/identity/tenant-context";

const iso = (value: Date | null) => value?.toISOString() ?? null;

export const issueDto = (issue: Issue) => ({
  id: issue.id,
  vehicleId: issue.vehicleId,
  inspectionSubmissionId: issue.inspectionSubmissionId,
  inspectionResponseId: issue.inspectionResponseId,
  inspectionTemplateVersionId: issue.inspectionTemplateVersionId,
  inspectionQuestionId: issue.inspectionQuestionId,
  operationalImpact: issue.operationalImpact,
  isVehicleBlocking: issue.operationalImpact === "VEHICLE_BLOCKING",
  severity: issue.severity,
  status: issue.status,
  vehicleRegistration: issue.vehicleRegistrationSnapshot,
  templateName: issue.templateNameSnapshot,
  questionLabel: issue.questionLabelSnapshot,
  createdAt: issue.createdAt.toISOString(),
  resolvedAt: iso(issue.resolvedAt),
  resolutionNotes: issue.resolutionNotes,
  closedAt: iso(issue.closedAt),
});

export const issueHistoryDto = (item: IssueStatusHistory) => ({
  id: item.id,
  fromStatus: item.fromStatus,
  toStatus: item.toStatus,
  reason: item.reason,
  actorUserId: item.actorUserId,
  occurredAt: item.occurredAt.toISOString(),
});

export const issueActionDto = (item: IssueAction) => ({
  id: item.id,
  actionType: item.actionType,
  description: item.description,
  notes: item.notes,
  actorUserId: item.actorUserId,
  occurredAt: item.occurredAt.toISOString(),
});

export const defectHoldDto = (item: VehicleDefectHold) => ({
  id: item.id,
  isActive: item.releasedAt === null,
  appliedStatusHistoryId: item.appliedStatusHistoryId,
  createdAt: item.createdAt.toISOString(),
  releasedAt: iso(item.releasedAt),
  releaseStatusHistoryId: item.releaseStatusHistoryId,
});

export const issueCapabilitiesDto = (context: TenantContext) => ({
  canManage: context.permissions.has("issues.manage"),
  canResolve: context.permissions.has("issues.resolve"),
  canReleaseVehicle: context.permissions.has("vehicles.release"),
});
