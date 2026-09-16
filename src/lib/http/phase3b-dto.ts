import type {
  ComplianceRequirement,
  ComplianceRequirementAssignment,
  ComplianceRequirementExemption,
  Document,
  DocumentType,
  DriverLicenceFile,
  DocumentFile,
  DocumentReviewHistory,
  StoredFile,
} from "@prisma/client";
import type { ComplianceObligation } from "@/modules/compliance/compliance-evaluation.service";

const date = (value: Date | null) => value?.toISOString() ?? null;

export const documentTypeDto = (item: DocumentType) => ({
  id: item.id,
  code: item.code,
  name: item.name,
  description: item.description,
  subjectType: item.subjectType,
  evidenceSourceType: item.evidenceSourceType,
  requiresIssueDate: item.requiresIssueDate,
  requiresExpiryDate: item.requiresExpiryDate,
  isActive: item.isActive,
});

export const requirementDto = (item: ComplianceRequirement) => ({
  id: item.id,
  documentTypeId: item.documentTypeId,
  subjectType: item.subjectType,
  applicability: item.applicability,
  name: item.name,
  description: item.description,
  expiryWarningDays: item.expiryWarningDays,
  isActive: item.isActive,
});

export const assignmentDto = (item: ComplianceRequirementAssignment) => ({
  id: item.id,
  requirementId: item.requirementId,
  subjectType: item.subjectType,
  driverId: item.driverId,
  vehicleId: item.vehicleId,
  assignedAt: item.assignedAt.toISOString(),
  removedAt: date(item.removedAt),
});

export const exemptionDto = (item: ComplianceRequirementExemption) => ({
  id: item.id,
  requirementId: item.requirementId,
  subjectType: item.subjectType,
  driverId: item.driverId,
  vehicleId: item.vehicleId,
  reason: item.reason,
  effectiveFrom: date(item.effectiveFrom),
  expiresOn: date(item.expiresOn),
  revokedAt: date(item.revokedAt),
});

export const documentDto = (item: Document) => ({
  id: item.id,
  documentTypeId: item.documentTypeId,
  subjectType: item.subjectType,
  driverId: item.driverId,
  vehicleId: item.vehicleId,
  issueDate: date(item.issueDate),
  validFrom: date(item.validFrom),
  expiryDate: date(item.expiryDate),
  reviewStatus: item.reviewStatus,
  reviewedAt: date(item.reviewedAt),
  rejectionReason: item.rejectionReason,
  archivedAt: date(item.archivedAt),
  revokedAt: date(item.revokedAt),
  createdAt: item.createdAt.toISOString(),
});

export const documentFileDto = (item: DocumentFile) => ({
  id: item.id,
  documentId: item.documentId,
  storedFileId: item.storedFileId,
  attachedAt: item.attachedAt.toISOString(),
  removedAt: date(item.removedAt),
});

export const operationalDocumentFileDto = (item: DocumentFile & { storedFile: StoredFile }) => ({
  id: item.id,
  storedFileId: item.storedFileId,
  filename: item.storedFile.originalFilename,
  mimeType: item.storedFile.mimeType,
  sizeBytes: item.storedFile.sizeBytes,
  fileState: item.storedFile.fileState,
  attachedAt: item.attachedAt.toISOString(),
});

export const documentReviewHistoryDto = (item: DocumentReviewHistory) => ({
  id: item.id,
  fromStatus: item.fromStatus,
  toStatus: item.toStatus,
  reason: item.reason,
  createdAt: item.createdAt.toISOString(),
});

export const driverLicenceFileDto = (item: DriverLicenceFile) => ({
  id: item.id,
  driverLicenceId: item.driverLicenceId,
  storedFileId: item.storedFileId,
  role: item.role,
  attachedAt: item.attachedAt.toISOString(),
  removedAt: date(item.removedAt),
});

export const complianceObligationDto = (item: ComplianceObligation) => ({
  requirementId: item.requirementId,
  requirementName: item.requirementName,
  documentTypeId: item.documentTypeId,
  documentTypeName: item.documentTypeName,
  status: item.status,
  daysRemaining: item.daysRemaining,
  hasPendingReview: item.hasPendingReview,
  reasonCode: item.reason,
});

export function complianceSummaryDto(
  status: "COMPLIANT" | "AT_RISK" | "NON_COMPLIANT" | "NOT_EVALUATED",
  obligations: readonly ComplianceObligation[],
  activeExemptionCount = 0,
) {
  const compliant = obligations.filter((item) => item.status === "COMPLIANT").length;
  const expiringSoon = obligations.filter((item) => item.status === "EXPIRING_SOON").length;
  const expired = obligations.filter((item) => item.status === "EXPIRED").length;
  const missing = obligations.filter((item) => item.status === "MISSING").length;
  return {
    status,
    applicableRequirements: obligations.length,
    compliant,
    expiringSoon,
    expired,
    missing,
    percentage:
      obligations.length === 0 ? null : ((compliant + expiringSoon) / obligations.length) * 100,
    pendingReviewCount: obligations.filter((item) => item.hasPendingReview).length,
    activeExemptionCount,
  };
}

export function complianceAggregateDto(item: {
  applicableObligationCount: number;
  compliantOrAtRiskCount: number;
  percentage: number | null;
  activeExemptionCount: number;
  pendingReviewCount: number;
}) {
  return {
    applicableRequirements: item.applicableObligationCount,
    compliantOrAtRisk: item.compliantOrAtRiskCount,
    percentage: item.percentage,
    activeExemptionCount: item.activeExemptionCount,
    pendingReviewCount: item.pendingReviewCount,
  };
}
