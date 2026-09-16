import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { withTenantTransaction, type TenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission } from "@/modules/identity/authorization";
import type { PermissionCode } from "@/modules/identity/permissions";
import type { TenantContext } from "@/modules/identity/tenant-context";

type TenantClient = Pick<PrismaClient, "$transaction">;
type PreviewStatus = "CREATE" | "ALREADY_PRESENT" | "CONFLICT" | "SKIP";
type StarterGroup = "VEHICLE_CATEGORY" | "COMPLIANCE" | "INSPECTION";

type VehicleCategoryStarter = Readonly<{
  id: string;
  group: "VEHICLE_CATEGORY";
  code: string;
  name: string;
  requiredLicenceClass: "C" | "LR" | "MR" | "HR" | "HC" | "MC" | null;
}>;
type ComplianceStarter = Readonly<{
  id: string;
  group: "COMPLIANCE";
  documentType: Readonly<{
    code: string;
    name: string;
    description: string;
    subjectType: "DRIVER" | "VEHICLE" | "COMPANY";
    evidenceSourceType: "DOCUMENT" | "DRIVER_LICENCE";
    requiresIssueDate: boolean;
    requiresExpiryDate: boolean;
  }>;
  requirement: Readonly<{
    name: string;
    description: string;
    expiryWarningDays: number;
    applicability: "GLOBAL";
  }>;
}>;
type InspectionStarter = Readonly<{
  id: string;
  group: "INSPECTION";
  code: string;
  name: string;
  description: string;
  sections: readonly Readonly<{
    title: string;
    questions: readonly Readonly<{ label: string; operationalImpact: "NON_BLOCKING" }>[];
  }>[];
}>;
type Starter = VehicleCategoryStarter | ComplianceStarter | InspectionStarter;

const vehicleCategories: readonly VehicleCategoryStarter[] = [
  {
    id: "category.van",
    group: "VEHICLE_CATEGORY",
    code: "VAN",
    name: "Van",
    requiredLicenceClass: null,
  },
  {
    id: "category.ute",
    group: "VEHICLE_CATEGORY",
    code: "UTE",
    name: "Ute",
    requiredLicenceClass: null,
  },
  {
    id: "category.6_pallet_truck",
    group: "VEHICLE_CATEGORY",
    code: "6_PALLET_TRUCK",
    name: "6 Pallet Truck",
    requiredLicenceClass: null,
  },
  {
    id: "category.12_pallet_truck",
    group: "VEHICLE_CATEGORY",
    code: "12_PALLET_TRUCK",
    name: "12 Pallet Truck",
    requiredLicenceClass: null,
  },
  {
    id: "category.semi_trailer",
    group: "VEHICLE_CATEGORY",
    code: "SEMI_TRAILER",
    name: "Semi Trailer",
    requiredLicenceClass: null,
  },
];

const complianceStarters: readonly ComplianceStarter[] = [
  {
    id: "compliance.driver_licence",
    group: "COMPLIANCE",
    documentType: {
      code: "DRIVER_LICENCE",
      name: "Driver Licence",
      description: "Structured driver licence evidence maintained by the company.",
      subjectType: "DRIVER",
      evidenceSourceType: "DRIVER_LICENCE",
      requiresIssueDate: true,
      requiresExpiryDate: true,
    },
    requirement: {
      name: "Current driver licence",
      description: "Company-selected requirement for current driver licence evidence.",
      expiryWarningDays: 30,
      applicability: "GLOBAL",
    },
  },
  {
    id: "compliance.vehicle_registration",
    group: "COMPLIANCE",
    documentType: {
      code: "VEHICLE_REGISTRATION",
      name: "Vehicle Registration",
      description: "Vehicle registration evidence maintained by the company.",
      subjectType: "VEHICLE",
      evidenceSourceType: "DOCUMENT",
      requiresIssueDate: true,
      requiresExpiryDate: true,
    },
    requirement: {
      name: "Current vehicle registration",
      description: "Company-selected requirement for current vehicle registration evidence.",
      expiryWarningDays: 30,
      applicability: "GLOBAL",
    },
  },
  {
    id: "compliance.vehicle_insurance",
    group: "COMPLIANCE",
    documentType: {
      code: "VEHICLE_INSURANCE",
      name: "Vehicle Insurance",
      description: "Vehicle insurance evidence maintained by the company.",
      subjectType: "VEHICLE",
      evidenceSourceType: "DOCUMENT",
      requiresIssueDate: true,
      requiresExpiryDate: true,
    },
    requirement: {
      name: "Current vehicle insurance",
      description: "Company-selected requirement for current vehicle insurance evidence.",
      expiryWarningDays: 30,
      applicability: "GLOBAL",
    },
  },
];

const inspectionStarter: InspectionStarter = {
  id: "inspection.basic_prestart",
  group: "INSPECTION",
  code: "BASIC_PRESTART",
  name: "Basic vehicle pre-start inspection",
  description: "A generic pilot checklist that must be reviewed and adapted by the company.",
  sections: [
    {
      title: "Vehicle condition",
      questions: [
        {
          label: "Is the vehicle free from visible damage that could affect operation?",
          operationalImpact: "NON_BLOCKING",
        },
      ],
    },
    {
      title: "Tyres and wheels",
      questions: [
        {
          label: "Do the tyres and wheels appear serviceable on visual inspection?",
          operationalImpact: "NON_BLOCKING",
        },
      ],
    },
    {
      title: "Lights",
      questions: [
        {
          label: "Do the visible lights and indicators operate as expected?",
          operationalImpact: "NON_BLOCKING",
        },
      ],
    },
    {
      title: "Safety equipment",
      questions: [
        {
          label: "Is the company-required safety equipment present and accessible?",
          operationalImpact: "NON_BLOCKING",
        },
      ],
    },
  ],
};

const starters: readonly Starter[] = [
  ...vehicleCategories,
  ...complianceStarters,
  inspectionStarter,
];
const starterIds = starters.map((item) => item.id) as [string, ...string[]];
const selectionSchema = z.object({
  componentIds: z.array(z.enum(starterIds)).max(starters.length),
});
const applySchema = selectionSchema.extend({
  confirmed: z.boolean(),
  preview: z.array(
    z.object({
      id: z.enum(starterIds),
      status: z.enum(["CREATE", "ALREADY_PRESENT", "CONFLICT"]),
    }),
  ),
});

function permissionFor(group: StarterGroup): PermissionCode {
  if (group === "VEHICLE_CATEGORY") return "vehicles.manage";
  if (group === "COMPLIANCE") return "compliance.manage";
  return "inspections.configure";
}

function publicStarter(item: Starter) {
  if (item.group === "VEHICLE_CATEGORY") return item;
  if (item.group === "COMPLIANCE") return item;
  return item;
}

export function pilotProvisioningCatalog() {
  return {
    notice:
      "Starter configuration is not legal or regulatory advice. Review and adapt every selected item for your operations.",
    components: starters.map(publicStarter),
  };
}

async function categoryStatus(
  tx: TenantTransaction,
  context: TenantContext,
  item: VehicleCategoryStarter,
) {
  const matches = await tx.vehicleCategory.findMany({
    where: {
      companyId: context.companyId,
      OR: [{ code: item.code }, { name: { equals: item.name, mode: "insensitive" } }],
    },
  });
  if (matches.length === 0)
    return { status: "CREATE" as const, detail: "Category will be created." };
  const exact = matches.length === 1 && matches[0]?.code === item.code;
  const record = matches[0];
  if (
    exact &&
    record?.name === item.name &&
    record.isActive &&
    record.requiredLicenceClass === item.requiredLicenceClass
  )
    return {
      status: "ALREADY_PRESENT" as const,
      detail: "Matching active category already exists.",
    };
  return {
    status: "CONFLICT" as const,
    detail: "An existing category has the same code or name but different configuration.",
  };
}

async function complianceStatus(
  tx: TenantTransaction,
  context: TenantContext,
  item: ComplianceStarter,
) {
  const typeMatches = await tx.documentType.findMany({
    where: {
      companyId: context.companyId,
      OR: [
        { code: item.documentType.code },
        { name: { equals: item.documentType.name, mode: "insensitive" } },
      ],
    },
  });
  if (typeMatches.length > 1)
    return {
      status: "CONFLICT" as const,
      detail: "Multiple document types ambiguously match this starter.",
    };
  const type = typeMatches[0];
  if (
    type &&
    (type.code !== item.documentType.code ||
      type.name !== item.documentType.name ||
      !type.isActive ||
      type.subjectType !== item.documentType.subjectType ||
      type.evidenceSourceType !== item.documentType.evidenceSourceType ||
      type.requiresIssueDate !== item.documentType.requiresIssueDate ||
      type.requiresExpiryDate !== item.documentType.requiresExpiryDate)
  )
    return {
      status: "CONFLICT" as const,
      detail: "An existing document type has the same code or name but different configuration.",
    };
  if (!type)
    return {
      status: "CREATE" as const,
      detail: "Document type and global requirement will be created.",
    };
  const requirements = await tx.complianceRequirement.findMany({
    where: { companyId: context.companyId, documentTypeId: type.id, isActive: true },
  });
  if (requirements.length === 0)
    return {
      status: "CREATE" as const,
      detail: "The matching document type exists; its global requirement will be created.",
    };
  const requirement = requirements[0];
  if (
    requirements.length === 1 &&
    requirement?.name === item.requirement.name &&
    requirement.subjectType === item.documentType.subjectType &&
    requirement.applicability === item.requirement.applicability &&
    requirement.expiryWarningDays === item.requirement.expiryWarningDays
  )
    return {
      status: "ALREADY_PRESENT" as const,
      detail: "Matching document type and active requirement already exist.",
    };
  return {
    status: "CONFLICT" as const,
    detail: "The matching document type has a different active requirement.",
  };
}

async function inspectionStatus(
  tx: TenantTransaction,
  context: TenantContext,
  item: InspectionStarter,
) {
  const matches = await tx.inspectionTemplate.findMany({
    where: {
      companyId: context.companyId,
      OR: [{ code: item.code }, { name: { equals: item.name, mode: "insensitive" } }],
    },
  });
  if (matches.length === 0)
    return { status: "CREATE" as const, detail: "Published starter inspection will be created." };
  const template = matches[0];
  if (
    matches.length !== 1 ||
    template?.code !== item.code ||
    template.name !== item.name ||
    !template.isActive ||
    !template.currentPublishedVersionId
  )
    return {
      status: "CONFLICT" as const,
      detail: "An existing inspection has the same code or name but is not the published starter.",
    };
  const sections = await tx.inspectionSection.findMany({
    where: {
      companyId: context.companyId,
      templateVersionId: template.currentPublishedVersionId,
      isActive: true,
    },
    orderBy: { sortOrder: "asc" },
  });
  const questions = await tx.inspectionQuestion.findMany({
    where: {
      companyId: context.companyId,
      templateVersionId: template.currentPublishedVersionId,
      isActive: true,
    },
    orderBy: { sortOrder: "asc" },
  });
  const expected = item.sections.flatMap((section, sectionIndex) =>
    section.questions.map((question, questionIndex) => ({
      sectionTitle: section.title,
      sectionOrder: sectionIndex + 1,
      questionOrder: questionIndex + 1,
      ...question,
    })),
  );
  const actual = questions.map((question) => ({
    sectionTitle: sections.find((section) => section.id === question.sectionId)?.title,
    sectionOrder: sections.findIndex((section) => section.id === question.sectionId) + 1,
    questionOrder: question.sortOrder,
    label: question.label,
    operationalImpact: question.operationalImpact,
  }));
  if (
    sections.length === item.sections.length &&
    JSON.stringify(actual) === JSON.stringify(expected)
  )
    return {
      status: "ALREADY_PRESENT" as const,
      detail: "Matching published starter inspection already exists.",
    };
  return {
    status: "CONFLICT" as const,
    detail: "The matching inspection contains customer-defined or different content.",
  };
}

async function statusFor(tx: TenantTransaction, context: TenantContext, item: Starter) {
  if (item.group === "VEHICLE_CATEGORY") return categoryStatus(tx, context, item);
  if (item.group === "COMPLIANCE") return complianceStatus(tx, context, item);
  return inspectionStatus(tx, context, item);
}

async function previewInTransaction(
  tx: TenantTransaction,
  context: TenantContext,
  selectedIds: ReadonlySet<string>,
) {
  const results = [];
  for (const item of starters) {
    if (!selectedIds.has(item.id)) {
      results.push({
        id: item.id,
        group: item.group,
        label: item.group === "COMPLIANCE" ? item.requirement.name : item.name,
        status: "SKIP" as PreviewStatus,
        detail: "Not selected.",
      });
      continue;
    }
    requirePermission(context, permissionFor(item.group));
    const outcome = await statusFor(tx, context, item);
    results.push({
      id: item.id,
      group: item.group,
      label: item.group === "COMPLIANCE" ? item.requirement.name : item.name,
      ...outcome,
    });
  }
  return results;
}

export async function previewPilotProvisioning(
  client: TenantClient,
  context: TenantContext,
  raw: unknown,
) {
  requirePermission(context, "company.read");
  const input = selectionSchema.parse(raw);
  const selectedIds = new Set(input.componentIds);
  return withTenantTransaction(client, context, (tx) =>
    previewInTransaction(tx, context, selectedIds),
  );
}

async function createCategory(
  tx: TenantTransaction,
  context: TenantContext,
  item: VehicleCategoryStarter,
) {
  await tx.vehicleCategory.create({
    data: {
      companyId: context.companyId,
      code: item.code,
      name: item.name,
      requiredLicenceClass: item.requiredLicenceClass,
    },
  });
}

async function createCompliance(
  tx: TenantTransaction,
  context: TenantContext,
  item: ComplianceStarter,
) {
  let type = await tx.documentType.findUnique({
    where: { companyId_code: { companyId: context.companyId, code: item.documentType.code } },
  });
  if (!type)
    type = await tx.documentType.create({
      data: { companyId: context.companyId, ...item.documentType },
    });
  await tx.complianceRequirement.create({
    data: {
      companyId: context.companyId,
      documentTypeId: type.id,
      subjectType: item.documentType.subjectType,
      ...item.requirement,
    },
  });
}

async function createInspection(
  tx: TenantTransaction,
  context: TenantContext,
  item: InspectionStarter,
) {
  const template = await tx.inspectionTemplate.create({
    data: {
      companyId: context.companyId,
      code: item.code,
      name: item.name,
      description: item.description,
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
  for (const [sectionIndex, sectionDefinition] of item.sections.entries()) {
    const section = await tx.inspectionSection.create({
      data: {
        companyId: context.companyId,
        templateVersionId: version.id,
        title: sectionDefinition.title,
        sortOrder: sectionIndex + 1,
      },
    });
    for (const [questionIndex, question] of sectionDefinition.questions.entries()) {
      await tx.inspectionQuestion.create({
        data: {
          companyId: context.companyId,
          templateVersionId: version.id,
          sectionId: section.id,
          label: question.label,
          isRequired: true,
          responseType: "PASS_FAIL",
          sortOrder: questionIndex + 1,
          commentRule: "OPTIONAL",
          photoRequirement: "ON_FAILURE",
          operationalImpact: question.operationalImpact,
        },
      });
    }
  }
  const publishedAt = new Date();
  await tx.inspectionTemplateVersion.update({
    where: { companyId_id: { companyId: context.companyId, id: version.id } },
    data: { status: "PUBLISHED", publishedAt, publishedByUserId: context.actorUserId },
  });
  await tx.inspectionTemplate.update({
    where: { companyId_id: { companyId: context.companyId, id: template.id } },
    data: { currentPublishedVersionId: version.id },
  });
}

export async function applyPilotProvisioning(
  client: TenantClient,
  context: TenantContext,
  raw: unknown,
) {
  requirePermission(context, "company.manage");
  const input = applySchema.parse(raw);
  if (!input.confirmed)
    throw new ValidationError(
      "PROVISIONING_CONFIRMATION_REQUIRED",
      "Explicit confirmation is required before applying starter configuration",
    );
  const selectedIds = new Set(input.componentIds);
  try {
    return await withTenantTransaction(client, context, async (tx) => {
      const preview = await previewInTransaction(tx, context, selectedIds);
      const currentSnapshot = preview
        .filter((item) => selectedIds.has(item.id))
        .map(({ id, status }) => ({ id, status }))
        .sort((left, right) => left.id.localeCompare(right.id));
      const confirmedSnapshot = [...input.preview].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
      if (JSON.stringify(currentSnapshot) !== JSON.stringify(confirmedSnapshot))
        throw new ConflictError(
          "PROVISIONING_PREVIEW_STALE",
          "Company configuration changed; preview the selection again",
        );
      for (const outcome of preview) {
        if (outcome.status !== "CREATE") continue;
        const item = starters.find((candidate) => candidate.id === outcome.id)!;
        if (item.group === "VEHICLE_CATEGORY") await createCategory(tx, context, item);
        else if (item.group === "COMPLIANCE") await createCompliance(tx, context, item);
        else await createInspection(tx, context, item);
      }
      await recordTenantActivity(tx, context, {
        action: "company.pilot_provisioning_applied",
        entityType: "company",
        entityId: context.companyId,
        metadata: {
          selectedComponentIds: input.componentIds,
          outcomes: preview
            .filter((item) => selectedIds.has(item.id))
            .map(({ id, status }) => ({ id, status })),
        } as Prisma.InputJsonValue,
      });
      return preview;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002")
      throw new ConflictError(
        "PROVISIONING_STATE_CHANGED",
        "Company configuration changed; preview the selection again",
      );
    throw error;
  }
}
