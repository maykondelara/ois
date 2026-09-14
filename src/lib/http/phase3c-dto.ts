import type {
  InspectionQuestion,
  InspectionQuestionOption,
  InspectionResponse,
  InspectionResponseFile,
  InspectionSection,
  InspectionSubmission,
  InspectionTemplate,
  InspectionTemplateVersion,
} from "@prisma/client";

const iso = (value: Date | null) => value?.toISOString() ?? null;
export const inspectionTemplateDto = (item: InspectionTemplate) => ({
  id: item.id,
  code: item.code,
  name: item.name,
  description: item.description,
  isActive: item.isActive,
  currentPublishedVersionId: item.currentPublishedVersionId,
});
export const inspectionVersionDto = (item: InspectionTemplateVersion) => ({
  id: item.id,
  templateId: item.templateId,
  version: item.version,
  status: item.status,
  applicabilityMode: item.applicabilityMode,
  publishedAt: iso(item.publishedAt),
});
export const inspectionSectionDto = (item: InspectionSection) => ({
  id: item.id,
  templateVersionId: item.templateVersionId,
  title: item.title,
  description: item.description,
  sortOrder: item.sortOrder,
  isActive: item.isActive,
});
export const inspectionQuestionDto = (item: InspectionQuestion) => ({
  id: item.id,
  templateVersionId: item.templateVersionId,
  sectionId: item.sectionId,
  label: item.label,
  helpText: item.helpText,
  isRequired: item.isRequired,
  responseType: item.responseType,
  sortOrder: item.sortOrder,
  failureBooleanValue: item.failureBooleanValue,
  minimumValue: item.minimumValue?.toNumber() ?? null,
  maximumValue: item.maximumValue?.toNumber() ?? null,
  commentRule: item.commentRule,
  photoRequirement: item.photoRequirement,
  isActive: item.isActive,
});
export const inspectionOptionDto = (item: InspectionQuestionOption) => ({
  id: item.id,
  questionId: item.questionId,
  label: item.label,
  sortOrder: item.sortOrder,
  isFailure: item.isFailure,
  isActive: item.isActive,
});
export const inspectionSubmissionDto = (item: InspectionSubmission) => ({
  id: item.id,
  templateId: item.templateId,
  templateVersionId: item.templateVersionId,
  vehicleId: item.vehicleId,
  driverId: item.driverId,
  status: item.status,
  outcome: item.outcome,
  vehicleRegistration: item.vehicleRegistrationSnapshot,
  templateName: item.templateNameSnapshot,
  driverDisplayName: item.driverDisplayNameSnapshot,
  startedAt: item.startedAt.toISOString(),
  submittedAt: iso(item.submittedAt),
  cancelledAt: iso(item.cancelledAt),
  cancellationReason: item.cancellationReason,
});
export const inspectionResponseDto = (item: InspectionResponse) => ({
  id: item.id,
  questionId: item.questionId,
  booleanValue: item.booleanValue,
  textValue: item.textValue,
  numberValue: item.numberValue?.toNumber() ?? null,
  odometerValueKm: item.odometerValueKm,
  comment: item.comment,
  outcome: item.outcome,
});
export const inspectionResponseFileDto = (item: InspectionResponseFile) => ({
  id: item.id,
  responseId: item.responseId,
  storedFileId: item.storedFileId,
  attachedAt: item.attachedAt.toISOString(),
  removedAt: iso(item.removedAt),
});
