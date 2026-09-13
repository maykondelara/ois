import { Prisma, type PrismaClient } from "@prisma/client";
import { withTenantTransaction, type TenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission, requireRecordScope } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
import {
  deriveInspectionOutcome,
  type InspectionQuestionRule,
  type ResponseInput,
  validateSubmissionResponse,
} from "@/modules/inspections/inspection-rules";
import {
  type OdometerSubmissionResult,
  submitInspectionOdometerReadingInTenantTransaction,
} from "@/modules/vehicles/odometer.service";
import type { OdometerConfirmationTokenService } from "@/modules/vehicles/odometer-confirmation";

type TenantClient = Pick<PrismaClient, "$transaction">;

async function driverScopeFor(
  tx: TenantTransaction,
  context: TenantContext,
  driverId: string | null | undefined,
) {
  if (context.role !== "DRIVER") return;
  if (!driverId) throw new TenantRecordNotFoundError("Driver inspection context");
  const driver = await tx.driver.findUnique({
    where: { companyId_id: { companyId: context.companyId, id: driverId } },
    select: { companyId: true, userId: true },
  });
  if (!driver) throw new TenantRecordNotFoundError("Driver");
  requireRecordScope(context, { companyId: driver.companyId, driverUserId: driver.userId });
}

async function lockSubmission(tx: TenantTransaction, context: TenantContext, submissionId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id::text FROM inspection_submissions WHERE company_id = ${context.companyId}::uuid AND id = ${submissionId}::uuid FOR UPDATE`,
  );
  if (rows.length !== 1) throw new TenantRecordNotFoundError("Inspection submission");
}

function rule(question: {
  id: string;
  responseType: InspectionQuestionRule["responseType"];
  isRequired: boolean;
  failureBooleanValue: boolean | null;
  minimumValue: { toNumber(): number } | null;
  maximumValue: { toNumber(): number } | null;
  commentRule: InspectionQuestionRule["commentRule"];
  photoRequirement: InspectionQuestionRule["photoRequirement"];
  options: Array<{ id: string; isFailure: boolean }>;
}): InspectionQuestionRule {
  return {
    id: question.id,
    responseType: question.responseType,
    isRequired: question.isRequired,
    failureBooleanValue: question.failureBooleanValue,
    minimumValue: question.minimumValue?.toNumber() ?? null,
    maximumValue: question.maximumValue?.toNumber() ?? null,
    commentRule: question.commentRule,
    photoRequirement: question.photoRequirement,
    options: question.options,
  };
}

function responseInput(
  response: {
    booleanValue: boolean | null;
    textValue: string | null;
    numberValue: { toNumber(): number } | null;
    odometerValueKm: number | null;
    comment: string | null;
  } | null,
  optionIds: readonly string[],
  fileCount: number,
): ResponseInput {
  return {
    ...(response?.booleanValue === undefined ? {} : { booleanValue: response?.booleanValue }),
    ...(response?.textValue === undefined ? {} : { textValue: response?.textValue }),
    ...(response?.numberValue === undefined
      ? {}
      : { numberValue: response?.numberValue?.toNumber() ?? null }),
    ...(response?.odometerValueKm === undefined
      ? {}
      : { odometerValueKm: response?.odometerValueKm }),
    optionIds,
    fileCount,
    ...(response?.comment === undefined ? {} : { comment: response?.comment }),
  };
}

function typedResponseValues(
  responseType: InspectionQuestionRule["responseType"],
  input: ResponseInput,
) {
  return {
    booleanValue: ["YES_NO", "PASS_FAIL", "CHECKBOX"].includes(responseType)
      ? (input.booleanValue ?? null)
      : null,
    textValue: responseType === "TEXT" ? input.textValue?.trim() || null : null,
    numberValue: responseType === "NUMBER" ? (input.numberValue ?? null) : null,
    odometerValueKm: responseType === "ODOMETER" ? (input.odometerValueKm ?? null) : null,
  };
}

async function applicableVersion(
  tx: TenantTransaction,
  context: TenantContext,
  vehicleId: string,
  templateVersionId: string,
) {
  const vehicle = await tx.vehicle.findUnique({
    where: { companyId_id: { companyId: context.companyId, id: vehicleId } },
  });
  if (!vehicle || vehicle.operationalStatus === "INACTIVE")
    throw new TenantRecordNotFoundError("Vehicle");
  const version = await tx.inspectionTemplateVersion.findUnique({
    where: { companyId_id: { companyId: context.companyId, id: templateVersionId } },
  });
  if (!version || version.status !== "PUBLISHED")
    throw new ValidationError(
      "INSPECTION_VERSION_NOT_PUBLISHED",
      "Inspection version is not published",
    );
  const template = await tx.inspectionTemplate.findUnique({
    where: { companyId_id: { companyId: context.companyId, id: version.templateId } },
  });
  if (!template || !template.isActive || template.currentPublishedVersionId !== version.id)
    throw new ValidationError(
      "INSPECTION_TEMPLATE_NOT_CURRENT",
      "Inspection template is not available",
    );
  const applicable =
    version.applicabilityMode === "ALL_ELIGIBLE" ||
    (version.applicabilityMode === "VEHICLE_CATEGORIES" &&
      (await tx.inspectionTemplateCategoryApplicability.count({
        where: {
          companyId: context.companyId,
          templateVersionId: version.id,
          vehicleCategoryId: vehicle.vehicleCategoryId,
          isActive: true,
        },
      })) > 0) ||
    (version.applicabilityMode === "SPECIFIC_VEHICLES" &&
      (await tx.inspectionTemplateVehicleApplicability.count({
        where: {
          companyId: context.companyId,
          templateVersionId: version.id,
          vehicleId: vehicle.id,
          isActive: true,
        },
      })) > 0);
  if (!applicable)
    throw new ValidationError(
      "INSPECTION_TEMPLATE_NOT_APPLICABLE",
      "Inspection template is not applicable to vehicle",
    );
  return { vehicle, version, template };
}

export async function listApplicableInspectionTemplates(
  client: TenantClient,
  context: TenantContext,
  vehicleId: string,
) {
  requirePermission(context, "inspections.read");
  return withTenantTransaction(client, context, async (tx) => {
    const vehicle = await tx.vehicle.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: vehicleId } },
    });
    if (!vehicle || vehicle.operationalStatus === "INACTIVE")
      throw new TenantRecordNotFoundError("Vehicle");
    const templates = await tx.inspectionTemplate.findMany({
      where: {
        companyId: context.companyId,
        isActive: true,
        currentPublishedVersionId: { not: null },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const result = [];
    for (const template of templates) {
      const version = await tx.inspectionTemplateVersion.findUnique({
        where: {
          companyId_id: { companyId: context.companyId, id: template.currentPublishedVersionId! },
        },
      });
      if (!version) continue;
      if (version.applicabilityMode === "ALL_ELIGIBLE") result.push({ template, version });
      if (
        version.applicabilityMode === "VEHICLE_CATEGORIES" &&
        (await tx.inspectionTemplateCategoryApplicability.count({
          where: {
            companyId: context.companyId,
            templateVersionId: version.id,
            vehicleCategoryId: vehicle.vehicleCategoryId,
            isActive: true,
          },
        }))
      )
        result.push({ template, version });
      if (
        version.applicabilityMode === "SPECIFIC_VEHICLES" &&
        (await tx.inspectionTemplateVehicleApplicability.count({
          where: {
            companyId: context.companyId,
            templateVersionId: version.id,
            vehicleId,
            isActive: true,
          },
        }))
      )
        result.push({ template, version });
    }
    return result;
  });
}

export async function getInspectionSubmission(
  client: TenantClient,
  context: TenantContext,
  submissionId: string,
) {
  requirePermission(context, "inspections.read");
  return withTenantTransaction(client, context, async (tx) => {
    const submission = await tx.inspectionSubmission.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: submissionId } },
    });
    if (!submission) throw new TenantRecordNotFoundError("Inspection submission");
    await driverScopeFor(tx, context, submission.driverId);
    const responses = await tx.inspectionResponse.findMany({
      where: { companyId: context.companyId, submissionId },
      orderBy: { createdAt: "asc" },
    });
    return { submission, responses };
  });
}

export async function startInspection(
  client: TenantClient,
  context: TenantContext,
  input: Readonly<{ vehicleId: string; templateVersionId: string; driverId?: string | null }>,
) {
  requirePermission(context, "inspections.submit");
  return withTenantTransaction(client, context, async (tx) => {
    let driverId = input.driverId ?? null;
    if (context.role === "DRIVER") {
      const own = await tx.driver.findUnique({
        where: { companyId_userId: { companyId: context.companyId, userId: context.actorUserId } },
        select: { id: true },
      });
      if (!own) throw new TenantRecordNotFoundError("Driver");
      if (driverId && driverId !== own.id) throw new TenantRecordNotFoundError("Driver");
      driverId = own.id;
    }
    await driverScopeFor(tx, context, driverId);
    const { vehicle, version, template } = await applicableVersion(
      tx,
      context,
      input.vehicleId,
      input.templateVersionId,
    );
    const driver = driverId
      ? await tx.driver.findUnique({
          where: { companyId_id: { companyId: context.companyId, id: driverId } },
          select: { displayName: true },
        })
      : null;
    if (driverId && !driver) throw new TenantRecordNotFoundError("Driver");
    const submission = await tx.inspectionSubmission.create({
      data: {
        companyId: context.companyId,
        templateId: template.id,
        templateVersionId: version.id,
        vehicleId: vehicle.id,
        driverId,
        vehicleRegistrationSnapshot: vehicle.registrationDisplay,
        templateNameSnapshot: template.name,
        driverDisplayNameSnapshot: driver?.displayName ?? null,
        startedByUserId: context.actorUserId,
      },
    });
    await recordTenantActivity(tx, context, {
      action: "inspection.started",
      entityType: "inspection_submission",
      entityId: submission.id,
      metadata: { vehicleId: vehicle.id, templateVersionId: version.id },
    });
    return submission;
  });
}

export async function saveInspectionResponse(
  client: TenantClient,
  context: TenantContext,
  input: Readonly<{ submissionId: string; questionId: string } & ResponseInput>,
) {
  requirePermission(context, "inspections.submit");
  return withTenantTransaction(client, context, async (tx) => {
    await lockSubmission(tx, context, input.submissionId);
    const submission = await tx.inspectionSubmission.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: input.submissionId } },
    });
    if (!submission || submission.status !== "DRAFT")
      throw new ConflictError(
        "INSPECTION_SUBMISSION_IMMUTABLE",
        "Inspection submission is not a draft",
      );
    await driverScopeFor(tx, context, submission.driverId);
    const question = await tx.inspectionQuestion.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: input.questionId } },
    });
    if (!question || question.templateVersionId !== submission.templateVersionId)
      throw new TenantRecordNotFoundError("Inspection question");
    const options = await tx.inspectionQuestionOption.findMany({
      where: {
        companyId: context.companyId,
        templateVersionId: submission.templateVersionId,
        questionId: question.id,
      },
    });
    const questionRule = rule({ ...question, options });
    const validation = validateSubmissionResponse(questionRule, input);
    if (
      validation.errors.some(
        (code) =>
          code !== "REQUIRED_RESPONSE_MISSING" &&
          code !== "TRIGGERED_COMMENT_REQUIRED" &&
          code !== "TRIGGERED_PHOTO_REQUIRED",
      )
    )
      throw new ValidationError("INSPECTION_RESPONSE_INVALID", validation.errors.join(", "));
    const values = typedResponseValues(question.responseType, input);
    const response = await tx.inspectionResponse.upsert({
      where: {
        companyId_submissionId_questionId: {
          companyId: context.companyId,
          submissionId: submission.id,
          questionId: question.id,
        },
      },
      create: {
        companyId: context.companyId,
        submissionId: submission.id,
        templateVersionId: submission.templateVersionId,
        questionId: question.id,
        ...values,
        comment: input.comment?.trim() || null,
        outcome: validation.derived.outcome,
      },
      update: {
        ...values,
        comment: input.comment?.trim() || null,
        outcome: validation.derived.outcome,
      },
    });
    await tx.inspectionResponseOption.updateMany({
      where: { companyId: context.companyId, responseId: response.id },
      data: { isActive: false },
    });
    for (const questionOptionId of [...new Set(input.optionIds ?? [])])
      await tx.inspectionResponseOption.upsert({
        where: {
          companyId_responseId_questionOptionId: {
            companyId: context.companyId,
            responseId: response.id,
            questionOptionId,
          },
        },
        create: {
          companyId: context.companyId,
          responseId: response.id,
          templateVersionId: submission.templateVersionId,
          questionId: question.id,
          questionOptionId,
        },
        update: { isActive: true },
      });
    return response;
  });
}

export async function attachInspectionResponseFile(
  client: TenantClient,
  context: TenantContext,
  input: Readonly<{ submissionId: string; responseId: string; storedFileId: string }>,
) {
  requirePermission(context, "inspections.submit");
  return withTenantTransaction(client, context, async (tx) => {
    await lockSubmission(tx, context, input.submissionId);
    const response = await tx.inspectionResponse.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: input.responseId } },
    });
    const submission = await tx.inspectionSubmission.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: input.submissionId } },
    });
    if (
      !response ||
      !submission ||
      response.submissionId !== submission.id ||
      submission.status !== "DRAFT"
    )
      throw new ConflictError(
        "INSPECTION_SUBMISSION_IMMUTABLE",
        "Inspection response cannot be changed",
      );
    await driverScopeFor(tx, context, submission.driverId);
    const file = await tx.storedFile.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: input.storedFileId } },
    });
    if (!file || file.fileState !== "AVAILABLE")
      throw new ValidationError(
        "INSPECTION_FILE_UNAVAILABLE",
        "Inspection evidence file must be available",
      );
    const attached = await tx.inspectionResponseFile.create({
      data: {
        companyId: context.companyId,
        responseId: response.id,
        storedFileId: file.id,
        attachedByUserId: context.actorUserId,
      },
    });
    await recordTenantActivity(tx, context, {
      action: "inspection.response_file_attached",
      entityType: "inspection_response_file",
      entityId: attached.id,
      metadata: { submissionId: submission.id, responseId: response.id },
    });
    return attached;
  });
}

export async function removeInspectionResponseFile(
  client: TenantClient,
  context: TenantContext,
  input: Readonly<{ submissionId: string; responseFileId: string; reason: string }>,
) {
  requirePermission(context, "inspections.submit");
  if (!input.reason.trim())
    throw new ValidationError(
      "INSPECTION_FILE_REMOVAL_REASON_REQUIRED",
      "Inspection response file removal reason is required",
    );
  return withTenantTransaction(client, context, async (tx) => {
    await lockSubmission(tx, context, input.submissionId);
    const submission = await tx.inspectionSubmission.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: input.submissionId } },
    });
    if (!submission || submission.status !== "DRAFT")
      throw new ConflictError(
        "INSPECTION_SUBMISSION_IMMUTABLE",
        "Inspection response cannot be changed",
      );
    await driverScopeFor(tx, context, submission.driverId);
    const row = await tx.inspectionResponseFile.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: input.responseFileId } },
    });
    if (!row || row.removedAt) throw new TenantRecordNotFoundError("Inspection response file");
    const response = await tx.inspectionResponse.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: row.responseId } },
      select: { submissionId: true },
    });
    if (!response || response.submissionId !== submission.id)
      throw new TenantRecordNotFoundError("Inspection response file");
    const removed = await tx.inspectionResponseFile.update({
      where: { companyId_id: { companyId: context.companyId, id: row.id } },
      data: {
        removedAt: new Date(),
        removedByUserId: context.actorUserId,
        removalReason: input.reason.trim(),
      },
    });
    await recordTenantActivity(tx, context, {
      action: "inspection.response_file_removed",
      entityType: "inspection_response_file",
      entityId: removed.id,
      metadata: { submissionId: submission.id, responseId: removed.responseId },
    });
    return removed;
  });
}

export type SubmitInspectionResult =
  | Readonly<{ kind: "SUBMITTED"; submissionId: string; outcome: "PASS" | "FAIL" }>
  | Readonly<{ kind: "ODOMETER_ACTION_REQUIRED"; result: OdometerSubmissionResult }>;

export async function submitInspection(
  client: TenantClient,
  context: TenantContext,
  confirmations: OdometerConfirmationTokenService,
  submissionId: string,
  odometerConfirmationToken?: string,
): Promise<SubmitInspectionResult> {
  requirePermission(context, "inspections.submit");
  return withTenantTransaction(client, context, async (tx) => {
    await lockSubmission(tx, context, submissionId);
    const submission = await tx.inspectionSubmission.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: submissionId } },
    });
    if (!submission || submission.status !== "DRAFT")
      throw new ConflictError(
        "INSPECTION_ALREADY_FINAL",
        "Inspection draft is no longer submit-ready",
      );
    await driverScopeFor(tx, context, submission.driverId);
    const questions = await tx.inspectionQuestion.findMany({
      where: { companyId: context.companyId, templateVersionId: submission.templateVersionId },
    });
    const options = await tx.inspectionQuestionOption.findMany({
      where: { companyId: context.companyId, templateVersionId: submission.templateVersionId },
    });
    const responses = await tx.inspectionResponse.findMany({
      where: { companyId: context.companyId, submissionId },
    });
    const responseOptions = await tx.inspectionResponseOption.findMany({
      where: {
        companyId: context.companyId,
        responseId: { in: responses.map((response) => response.id) },
        isActive: true,
      },
    });
    const files = await tx.inspectionResponseFile.findMany({
      where: {
        companyId: context.companyId,
        responseId: { in: responses.map((response) => response.id) },
        removedAt: null,
      },
    });
    const availableFileIds = new Set(
      (
        await tx.storedFile.findMany({
          where: {
            companyId: context.companyId,
            id: { in: files.map((file) => file.storedFileId) },
            fileState: "AVAILABLE",
          },
          select: { id: true },
        })
      ).map((file) => file.id),
    );
    const validationErrors: string[] = [];
    const outcomes: Array<"PASS" | "FAIL" | "NEUTRAL"> = [];
    let odometerResponse: { value: number; responseId: string } | null = null;
    for (const question of questions) {
      const response = responses.find((candidate) => candidate.questionId === question.id) ?? null;
      const selected = response
        ? responseOptions
            .filter((option) => option.responseId === response.id)
            .map((option) => option.questionOptionId)
        : [];
      const fileCount = response
        ? files.filter(
            (file) => file.responseId === response.id && availableFileIds.has(file.storedFileId),
          ).length
        : 0;
      const result = validateSubmissionResponse(
        rule({
          ...question,
          options: options.filter((option) => option.questionId === question.id),
        }),
        responseInput(response, selected, fileCount),
      );
      validationErrors.push(...result.errors.map((code) => `${question.id}:${code}`));
      outcomes.push(result.derived.outcome);
      if (
        question.responseType === "ODOMETER" &&
        response?.odometerValueKm !== null &&
        response?.odometerValueKm !== undefined
      )
        odometerResponse = { value: response.odometerValueKm, responseId: response.id };
    }
    if (validationErrors.length)
      throw new ValidationError("INSPECTION_SUBMISSION_INVALID", validationErrors.join(", "));
    if (odometerResponse) {
      const odometerResult = await submitInspectionOdometerReadingInTenantTransaction(
        tx,
        context,
        confirmations,
        submission.vehicleId,
        submissionId,
        { readingKm: odometerResponse.value, confirmationToken: odometerConfirmationToken },
      );
      if (odometerResult.kind === "ANOMALY_CONFIRMATION_REQUIRED")
        return { kind: "ODOMETER_ACTION_REQUIRED", result: odometerResult };
    }
    const outcome = deriveInspectionOutcome(outcomes);
    const submitted = await tx.inspectionSubmission.update({
      where: { companyId_id: { companyId: context.companyId, id: submissionId } },
      data: { status: "SUBMITTED", outcome, submittedAt: new Date() },
    });
    await recordTenantActivity(tx, context, {
      action: "inspection.submitted",
      entityType: "inspection_submission",
      entityId: submissionId,
      metadata: { outcome },
    });
    return { kind: "SUBMITTED", submissionId: submitted.id, outcome };
  });
}

export async function cancelInspectionDraft(
  client: TenantClient,
  context: TenantContext,
  submissionId: string,
  reason: string,
) {
  requirePermission(
    context,
    context.role === "DRIVER" ? "inspections.submit" : "inspections.manage",
  );
  if (!reason.trim())
    throw new ValidationError(
      "INSPECTION_CANCELLATION_REASON_REQUIRED",
      "Cancellation reason is required",
    );
  return withTenantTransaction(client, context, async (tx) => {
    await lockSubmission(tx, context, submissionId);
    const submission = await tx.inspectionSubmission.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: submissionId } },
    });
    if (!submission || submission.status !== "DRAFT")
      throw new ConflictError(
        "INSPECTION_CANNOT_CANCEL",
        "Only draft inspections can be cancelled",
      );
    await driverScopeFor(tx, context, submission.driverId);
    const cancelled = await tx.inspectionSubmission.update({
      where: { companyId_id: { companyId: context.companyId, id: submissionId } },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: context.actorUserId,
        cancellationReason: reason.trim(),
      },
    });
    await recordTenantActivity(tx, context, {
      action: "inspection.cancelled",
      entityType: "inspection_submission",
      entityId: submissionId,
    });
    return cancelled;
  });
}
