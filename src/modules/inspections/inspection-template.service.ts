import { Prisma, type PrismaClient } from "@prisma/client";
import { withTenantTransaction, type TenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
import {
  type InspectionQuestionRule,
  validateTemplatePublication,
} from "@/modules/inspections/inspection-rules";

type TenantClient = Pick<PrismaClient, "$transaction">;
type VersionInput = Readonly<{ templateVersionId: string }>;

async function requireDraft(tx: TenantTransaction, context: TenantContext, versionId: string) {
  const version = await tx.inspectionTemplateVersion.findUnique({
    where: { companyId_id: { companyId: context.companyId, id: versionId } },
  });
  if (!version) throw new TenantRecordNotFoundError("Inspection template version");
  if (version.status !== "DRAFT")
    throw new ConflictError(
      "INSPECTION_VERSION_IMMUTABLE",
      "Published inspection version is immutable",
    );
  return version;
}

async function activeDraftSection(
  tx: TenantTransaction,
  context: TenantContext,
  sectionId: string,
) {
  const section = await tx.inspectionSection.findUnique({
    where: { companyId_id: { companyId: context.companyId, id: sectionId } },
  });
  if (!section || !section.isActive) throw new TenantRecordNotFoundError("Inspection section");
  await requireDraft(tx, context, section.templateVersionId);
  return section;
}

async function activeDraftQuestion(
  tx: TenantTransaction,
  context: TenantContext,
  questionId: string,
) {
  const question = await tx.inspectionQuestion.findUnique({
    where: { companyId_id: { companyId: context.companyId, id: questionId } },
  });
  if (!question || !question.isActive) throw new TenantRecordNotFoundError("Inspection question");
  await requireDraft(tx, context, question.templateVersionId);
  return question;
}

async function lockTemplate(tx: TenantTransaction, context: TenantContext, templateId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id::text FROM inspection_templates WHERE company_id = ${context.companyId}::uuid AND id = ${templateId}::uuid FOR UPDATE`,
  );
  if (rows.length !== 1) throw new TenantRecordNotFoundError("Inspection template");
}

function questionRule(question: {
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

export async function createInspectionTemplate(
  client: TenantClient,
  context: TenantContext,
  input: Readonly<{ code: string; name: string; description?: string | null | undefined }>,
) {
  requirePermission(context, "inspections.configure");
  return withTenantTransaction(client, context, async (tx) => {
    try {
      const template = await tx.inspectionTemplate.create({
        data: {
          companyId: context.companyId,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          description: input.description?.trim() || null,
        },
      });
      const version = await tx.inspectionTemplateVersion.create({
        data: {
          companyId: context.companyId,
          templateId: template.id,
          version: 1,
          createdByUserId: context.actorUserId,
        },
      });
      await recordTenantActivity(tx, context, {
        action: "inspection.template_created",
        entityType: "inspection_template",
        entityId: template.id,
        metadata: { version: 1 },
      });
      return { template, version };
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new ConflictError(
          "INSPECTION_TEMPLATE_CODE_EXISTS",
          "Inspection template code already exists",
        );
      throw error;
    }
  });
}

export async function updateInspectionTemplate(
  client: TenantClient,
  context: TenantContext,
  templateId: string,
  input: Readonly<{
    name?: string | undefined;
    description?: string | null | undefined;
    isActive?: boolean | undefined;
  }>,
) {
  requirePermission(context, "inspections.configure");
  return withTenantTransaction(client, context, async (tx) => {
    await lockTemplate(tx, context, templateId);
    const updated = await tx.inspectionTemplate.update({
      where: { companyId_id: { companyId: context.companyId, id: templateId } },
      data: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.description === undefined
          ? {}
          : { description: input.description?.trim() || null }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
    });
    await recordTenantActivity(tx, context, {
      action: "inspection.template_updated",
      entityType: "inspection_template",
      entityId: templateId,
    });
    return updated;
  });
}

export async function addInspectionSection(
  client: TenantClient,
  context: TenantContext,
  input: VersionInput &
    Readonly<{ title: string; description?: string | null | undefined; sortOrder: number }>,
) {
  requirePermission(context, "inspections.configure");
  return withTenantTransaction(client, context, async (tx) => {
    await requireDraft(tx, context, input.templateVersionId);
    return tx.inspectionSection.create({
      data: {
        companyId: context.companyId,
        templateVersionId: input.templateVersionId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        sortOrder: input.sortOrder,
      },
    });
  });
}

export async function addInspectionQuestion(
  client: TenantClient,
  context: TenantContext,
  input: VersionInput &
    Readonly<{
      sectionId: string;
      label: string;
      helpText?: string | null | undefined;
      isRequired?: boolean | undefined;
      responseType: InspectionQuestionRule["responseType"];
      sortOrder: number;
      failureBooleanValue?: boolean | null | undefined;
      minimumValue?: number | null | undefined;
      maximumValue?: number | null | undefined;
      commentRule?: InspectionQuestionRule["commentRule"] | undefined;
      photoRequirement?: InspectionQuestionRule["photoRequirement"] | undefined;
      operationalImpact?: "NON_BLOCKING" | "VEHICLE_BLOCKING" | undefined;
    }>,
) {
  requirePermission(context, "inspections.configure");
  return withTenantTransaction(client, context, async (tx) => {
    await requireDraft(tx, context, input.templateVersionId);
    const section = await activeDraftSection(tx, context, input.sectionId);
    if (section.templateVersionId !== input.templateVersionId)
      throw new TenantRecordNotFoundError("Inspection section");
    return tx.inspectionQuestion.create({
      data: {
        companyId: context.companyId,
        templateVersionId: input.templateVersionId,
        sectionId: input.sectionId,
        label: input.label.trim(),
        helpText: input.helpText?.trim() || null,
        isRequired: input.isRequired ?? false,
        responseType: input.responseType,
        sortOrder: input.sortOrder,
        failureBooleanValue: input.failureBooleanValue ?? null,
        minimumValue: input.minimumValue ?? null,
        maximumValue: input.maximumValue ?? null,
        commentRule: input.commentRule ?? "OPTIONAL",
        photoRequirement: input.photoRequirement ?? "NEVER",
        operationalImpact: input.operationalImpact ?? "NON_BLOCKING",
      },
    });
  });
}

export async function addInspectionQuestionOption(
  client: TenantClient,
  context: TenantContext,
  input: Readonly<{
    templateVersionId?: string | undefined;
    questionId: string;
    label: string;
    sortOrder: number;
    isFailure?: boolean | undefined;
  }>,
) {
  requirePermission(context, "inspections.configure");
  return withTenantTransaction(client, context, async (tx) => {
    const question = await activeDraftQuestion(tx, context, input.questionId);
    if (input.templateVersionId && question.templateVersionId !== input.templateVersionId)
      throw new TenantRecordNotFoundError("Inspection question");
    if (!["SINGLE_CHOICE", "MULTI_CHOICE"].includes(question.responseType))
      throw new ValidationError(
        "INSPECTION_OPTIONS_UNSUPPORTED",
        "Question does not support options",
      );
    return tx.inspectionQuestionOption.create({
      data: {
        companyId: context.companyId,
        templateVersionId: question.templateVersionId,
        questionId: input.questionId,
        label: input.label.trim(),
        sortOrder: input.sortOrder,
        isFailure: input.isFailure ?? false,
      },
    });
  });
}

export async function updateInspectionSection(
  client: TenantClient,
  context: TenantContext,
  sectionId: string,
  input: Readonly<{
    title?: string | undefined;
    description?: string | null | undefined;
    sortOrder?: number | undefined;
  }>,
) {
  requirePermission(context, "inspections.configure");
  return withTenantTransaction(client, context, async (tx) => {
    await activeDraftSection(tx, context, sectionId);
    return tx.inspectionSection.update({
      where: { companyId_id: { companyId: context.companyId, id: sectionId } },
      data: {
        ...(input.title === undefined ? {} : { title: input.title.trim() }),
        ...(input.description === undefined
          ? {}
          : { description: input.description?.trim() || null }),
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      },
    });
  });
}

export async function updateInspectionQuestion(
  client: TenantClient,
  context: TenantContext,
  questionId: string,
  input: Readonly<{
    label?: string | undefined;
    helpText?: string | null | undefined;
    isRequired?: boolean | undefined;
    sortOrder?: number | undefined;
    failureBooleanValue?: boolean | null | undefined;
    minimumValue?: number | null | undefined;
    maximumValue?: number | null | undefined;
    commentRule?: InspectionQuestionRule["commentRule"] | undefined;
    photoRequirement?: InspectionQuestionRule["photoRequirement"] | undefined;
    operationalImpact?: "NON_BLOCKING" | "VEHICLE_BLOCKING" | undefined;
  }>,
) {
  requirePermission(context, "inspections.configure");
  return withTenantTransaction(client, context, async (tx) => {
    await activeDraftQuestion(tx, context, questionId);
    return tx.inspectionQuestion.update({
      where: { companyId_id: { companyId: context.companyId, id: questionId } },
      data: {
        ...(input.label === undefined ? {} : { label: input.label.trim() }),
        ...(input.helpText === undefined ? {} : { helpText: input.helpText?.trim() || null }),
        ...(input.isRequired === undefined ? {} : { isRequired: input.isRequired }),
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
        ...(input.failureBooleanValue === undefined
          ? {}
          : { failureBooleanValue: input.failureBooleanValue }),
        ...(input.minimumValue === undefined ? {} : { minimumValue: input.minimumValue }),
        ...(input.maximumValue === undefined ? {} : { maximumValue: input.maximumValue }),
        ...(input.commentRule === undefined ? {} : { commentRule: input.commentRule }),
        ...(input.photoRequirement === undefined
          ? {}
          : { photoRequirement: input.photoRequirement }),
        ...(input.operationalImpact === undefined
          ? {}
          : { operationalImpact: input.operationalImpact }),
      },
    });
  });
}

export async function updateInspectionQuestionOption(
  client: TenantClient,
  context: TenantContext,
  optionId: string,
  input: Readonly<{
    label?: string | undefined;
    sortOrder?: number | undefined;
    isFailure?: boolean | undefined;
  }>,
) {
  requirePermission(context, "inspections.configure");
  return withTenantTransaction(client, context, async (tx) => {
    const option = await tx.inspectionQuestionOption.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: optionId } },
    });
    if (!option || !option.isActive)
      throw new TenantRecordNotFoundError("Inspection question option");
    await activeDraftQuestion(tx, context, option.questionId);
    return tx.inspectionQuestionOption.update({
      where: { companyId_id: { companyId: context.companyId, id: optionId } },
      data: {
        ...(input.label === undefined ? {} : { label: input.label.trim() }),
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
        ...(input.isFailure === undefined ? {} : { isFailure: input.isFailure }),
      },
    });
  });
}

export async function removeInspectionSection(
  client: TenantClient,
  context: TenantContext,
  sectionId: string,
) {
  requirePermission(context, "inspections.configure");
  return withTenantTransaction(client, context, async (tx) => {
    const section = await activeDraftSection(tx, context, sectionId);
    const questions = await tx.inspectionQuestion.findMany({
      where: { companyId: context.companyId, sectionId, isActive: true },
      select: { id: true },
    });
    await tx.inspectionSection.update({
      where: { companyId_id: { companyId: context.companyId, id: section.id } },
      data: { isActive: false },
    });
    await tx.inspectionQuestion.updateMany({
      where: { companyId: context.companyId, sectionId, isActive: true },
      data: { isActive: false },
    });
    await tx.inspectionQuestionOption.updateMany({
      where: { companyId: context.companyId, questionId: { in: questions.map((item) => item.id) } },
      data: { isActive: false },
    });
  });
}

export async function removeInspectionQuestion(
  client: TenantClient,
  context: TenantContext,
  questionId: string,
) {
  requirePermission(context, "inspections.configure");
  return withTenantTransaction(client, context, async (tx) => {
    const question = await activeDraftQuestion(tx, context, questionId);
    await tx.inspectionQuestion.update({
      where: { companyId_id: { companyId: context.companyId, id: question.id } },
      data: { isActive: false },
    });
    await tx.inspectionQuestionOption.updateMany({
      where: { companyId: context.companyId, questionId: question.id, isActive: true },
      data: { isActive: false },
    });
  });
}

export async function removeInspectionQuestionOption(
  client: TenantClient,
  context: TenantContext,
  optionId: string,
) {
  requirePermission(context, "inspections.configure");
  return withTenantTransaction(client, context, async (tx) => {
    const option = await tx.inspectionQuestionOption.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: optionId } },
    });
    if (!option || !option.isActive)
      throw new TenantRecordNotFoundError("Inspection question option");
    await activeDraftQuestion(tx, context, option.questionId);
    await tx.inspectionQuestionOption.update({
      where: { companyId_id: { companyId: context.companyId, id: option.id } },
      data: { isActive: false },
    });
  });
}

export async function configureInspectionApplicability(
  client: TenantClient,
  context: TenantContext,
  input: VersionInput &
    Readonly<{
      mode: "ALL_ELIGIBLE" | "VEHICLE_CATEGORIES" | "SPECIFIC_VEHICLES";
      vehicleCategoryIds?: readonly string[] | undefined;
      vehicleIds?: readonly string[] | undefined;
    }>,
) {
  requirePermission(context, "inspections.configure");
  return withTenantTransaction(client, context, async (tx) => {
    await requireDraft(tx, context, input.templateVersionId);
    const categories = [...new Set(input.vehicleCategoryIds ?? [])];
    const vehicles = [...new Set(input.vehicleIds ?? [])];
    if (input.mode === "VEHICLE_CATEGORIES" && categories.length === 0)
      throw new ValidationError(
        "INSPECTION_APPLICABILITY_EMPTY",
        "Select at least one vehicle category",
      );
    if (input.mode === "SPECIFIC_VEHICLES" && vehicles.length === 0)
      throw new ValidationError("INSPECTION_APPLICABILITY_EMPTY", "Select at least one vehicle");
    if (categories.length) {
      const found = await tx.vehicleCategory.count({
        where: { companyId: context.companyId, id: { in: categories } },
      });
      if (found !== categories.length) throw new TenantRecordNotFoundError("Vehicle category");
    }
    if (vehicles.length) {
      const found = await tx.vehicle.count({
        where: { companyId: context.companyId, id: { in: vehicles } },
      });
      if (found !== vehicles.length) throw new TenantRecordNotFoundError("Vehicle");
    }
    await tx.inspectionTemplateVersion.update({
      where: { companyId_id: { companyId: context.companyId, id: input.templateVersionId } },
      data: { applicabilityMode: input.mode },
    });
    await tx.inspectionTemplateCategoryApplicability.updateMany({
      where: { companyId: context.companyId, templateVersionId: input.templateVersionId },
      data: { isActive: false },
    });
    await tx.inspectionTemplateVehicleApplicability.updateMany({
      where: { companyId: context.companyId, templateVersionId: input.templateVersionId },
      data: { isActive: false },
    });
    for (const vehicleCategoryId of categories)
      await tx.inspectionTemplateCategoryApplicability.upsert({
        where: {
          companyId_templateVersionId_vehicleCategoryId: {
            companyId: context.companyId,
            templateVersionId: input.templateVersionId,
            vehicleCategoryId,
          },
        },
        create: {
          companyId: context.companyId,
          templateVersionId: input.templateVersionId,
          vehicleCategoryId,
        },
        update: { isActive: true },
      });
    for (const vehicleId of vehicles)
      await tx.inspectionTemplateVehicleApplicability.upsert({
        where: {
          companyId_templateVersionId_vehicleId: {
            companyId: context.companyId,
            templateVersionId: input.templateVersionId,
            vehicleId,
          },
        },
        create: {
          companyId: context.companyId,
          templateVersionId: input.templateVersionId,
          vehicleId,
        },
        update: { isActive: true },
      });
    await recordTenantActivity(tx, context, {
      action: "inspection.template_applicability_configured",
      entityType: "inspection_template_version",
      entityId: input.templateVersionId,
      metadata: { mode: input.mode },
    });
  });
}

export async function publishInspectionTemplateVersion(
  client: TenantClient,
  context: TenantContext,
  templateVersionId: string,
) {
  requirePermission(context, "inspections.configure");
  return withTenantTransaction(client, context, async (tx) => {
    const version = await requireDraft(tx, context, templateVersionId);
    await lockTemplate(tx, context, version.templateId);
    const sections = await tx.inspectionSection.findMany({
      where: { companyId: context.companyId, templateVersionId, isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    const questions = await tx.inspectionQuestion.findMany({
      where: { companyId: context.companyId, templateVersionId, isActive: true },
    });
    const options = await tx.inspectionQuestionOption.findMany({
      where: { companyId: context.companyId, templateVersionId, isActive: true },
    });
    const rules = sections.map((section) => ({
      id: section.id,
      questions: questions
        .filter((question) => question.sectionId === section.id)
        .map((question) =>
          questionRule({
            ...question,
            options: options.filter((option) => option.questionId === question.id),
          }),
        ),
    }));
    const errors = validateTemplatePublication(rules);
    if (
      (version.applicabilityMode === "VEHICLE_CATEGORIES" &&
        (await tx.inspectionTemplateCategoryApplicability.count({
          where: { companyId: context.companyId, templateVersionId, isActive: true },
        })) === 0) ||
      (version.applicabilityMode === "SPECIFIC_VEHICLES" &&
        (await tx.inspectionTemplateVehicleApplicability.count({
          where: { companyId: context.companyId, templateVersionId, isActive: true },
        })) === 0)
    )
      errors.push("INSPECTION_APPLICABILITY_EMPTY");
    if (errors.length)
      throw new ValidationError(
        "INSPECTION_TEMPLATE_INVALID",
        `Inspection template draft is invalid: ${errors.join(", ")}`,
      );
    const now = new Date();
    const published = await tx.inspectionTemplateVersion.update({
      where: { companyId_id: { companyId: context.companyId, id: templateVersionId } },
      data: { status: "PUBLISHED", publishedAt: now, publishedByUserId: context.actorUserId },
    });
    await tx.inspectionTemplate.update({
      where: { companyId_id: { companyId: context.companyId, id: version.templateId } },
      data: { currentPublishedVersionId: templateVersionId },
    });
    await recordTenantActivity(tx, context, {
      action: "inspection.template_version_published",
      entityType: "inspection_template_version",
      entityId: templateVersionId,
      metadata: { version: version.version },
    });
    return published;
  });
}

export async function clonePublishedInspectionTemplateVersion(
  client: TenantClient,
  context: TenantContext,
  sourceVersionId: string,
) {
  requirePermission(context, "inspections.configure");
  return withTenantTransaction(client, context, async (tx) => {
    const source = await tx.inspectionTemplateVersion.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: sourceVersionId } },
    });
    if (!source || source.status !== "PUBLISHED")
      throw new ValidationError(
        "INSPECTION_CLONE_SOURCE_INVALID",
        "Only a published version can be cloned",
      );
    await lockTemplate(tx, context, source.templateId);
    const latest = await tx.inspectionTemplateVersion.findFirst({
      where: { companyId: context.companyId, templateId: source.templateId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const copy = await tx.inspectionTemplateVersion.create({
      data: {
        companyId: context.companyId,
        templateId: source.templateId,
        version: (latest?.version ?? 0) + 1,
        applicabilityMode: source.applicabilityMode,
        createdByUserId: context.actorUserId,
      },
    });
    const sections = await tx.inspectionSection.findMany({
      where: { companyId: context.companyId, templateVersionId: source.id, isActive: true },
    });
    const sectionMap = new Map<string, string>();
    for (const section of sections) {
      const created = await tx.inspectionSection.create({
        data: {
          companyId: context.companyId,
          templateVersionId: copy.id,
          title: section.title,
          description: section.description,
          sortOrder: section.sortOrder,
        },
      });
      sectionMap.set(section.id, created.id);
    }
    const questions = await tx.inspectionQuestion.findMany({
      where: { companyId: context.companyId, templateVersionId: source.id, isActive: true },
    });
    const questionMap = new Map<string, string>();
    for (const question of questions) {
      const created = await tx.inspectionQuestion.create({
        data: {
          companyId: context.companyId,
          templateVersionId: copy.id,
          sectionId: sectionMap.get(question.sectionId)!,
          label: question.label,
          helpText: question.helpText,
          isRequired: question.isRequired,
          responseType: question.responseType,
          sortOrder: question.sortOrder,
          failureBooleanValue: question.failureBooleanValue,
          minimumValue: question.minimumValue,
          maximumValue: question.maximumValue,
          commentRule: question.commentRule,
          photoRequirement: question.photoRequirement,
          operationalImpact: question.operationalImpact,
        },
      });
      questionMap.set(question.id, created.id);
    }
    const options = await tx.inspectionQuestionOption.findMany({
      where: { companyId: context.companyId, templateVersionId: source.id, isActive: true },
    });
    for (const option of options)
      await tx.inspectionQuestionOption.create({
        data: {
          companyId: context.companyId,
          templateVersionId: copy.id,
          questionId: questionMap.get(option.questionId)!,
          label: option.label,
          sortOrder: option.sortOrder,
          isFailure: option.isFailure,
        },
      });
    const categories = await tx.inspectionTemplateCategoryApplicability.findMany({
      where: { companyId: context.companyId, templateVersionId: source.id },
    });
    for (const row of categories)
      await tx.inspectionTemplateCategoryApplicability.create({
        data: {
          companyId: context.companyId,
          templateVersionId: copy.id,
          vehicleCategoryId: row.vehicleCategoryId,
          isActive: row.isActive,
        },
      });
    const vehicles = await tx.inspectionTemplateVehicleApplicability.findMany({
      where: { companyId: context.companyId, templateVersionId: source.id },
    });
    for (const row of vehicles)
      await tx.inspectionTemplateVehicleApplicability.create({
        data: {
          companyId: context.companyId,
          templateVersionId: copy.id,
          vehicleId: row.vehicleId,
          isActive: row.isActive,
        },
      });
    await recordTenantActivity(tx, context, {
      action: "inspection.template_version_cloned",
      entityType: "inspection_template_version",
      entityId: copy.id,
      metadata: { sourceVersionId },
    });
    return copy;
  });
}
