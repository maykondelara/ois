import type { PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { TenantRecordNotFoundError } from "@/lib/errors";
import { requirePermission, requireRecordScope } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";

type TenantClient = Pick<PrismaClient, "$transaction">;
type Page = Readonly<{ number: number; pageSize: number }>;

async function ownDriverId(client: TenantClient, context: TenantContext) {
  return withTenantTransaction(client, context, async (tx) => {
    const driver = await tx.driver.findUnique({
      where: { companyId_userId: { companyId: context.companyId, userId: context.actorUserId } },
      select: { id: true },
    });
    if (!driver) throw new TenantRecordNotFoundError("Driver");
    return driver.id;
  });
}

export async function listInspectionTemplatesPage(
  client: TenantClient,
  context: TenantContext,
  page: Page,
  filters: Readonly<{
    isActive?: boolean | undefined;
    status?: "DRAFT" | "PUBLISHED" | undefined;
  }> = {},
) {
  requirePermission(context, "inspections.read");
  return withTenantTransaction(client, context, async (tx) => {
    const data = await tx.inspectionTemplate.findMany({
      where: {
        companyId: context.companyId,
        ...(filters.isActive === undefined ? {} : { isActive: filters.isActive }),
        ...(filters.status === undefined
          ? {}
          : { versions: { some: { companyId: context.companyId, status: filters.status } } }),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page.number - 1) * page.pageSize,
      take: page.pageSize + 1,
    });
    const ids = data.map((item) => item.id);
    const versions = await tx.inspectionTemplateVersion.findMany({
      where: {
        companyId: context.companyId,
        templateId: { in: ids },
        ...(filters.status === undefined ? {} : { status: filters.status }),
      },
      orderBy: [{ templateId: "asc" }, { version: "desc" }],
    });
    return {
      data: data.slice(0, page.pageSize).map((template) => ({
        template,
        versions: versions.filter((version) => version.templateId === template.id),
      })),
      hasNextPage: data.length > page.pageSize,
    };
  });
}

export async function getInspectionTemplateDetail(
  client: TenantClient,
  context: TenantContext,
  templateId: string,
  versionId?: string | undefined,
) {
  requirePermission(context, "inspections.read");
  return withTenantTransaction(client, context, async (tx) => {
    const template = await tx.inspectionTemplate.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: templateId } },
    });
    if (!template) throw new TenantRecordNotFoundError("Inspection template");
    const versions = await tx.inspectionTemplateVersion.findMany({
      where: { companyId: context.companyId, templateId },
      orderBy: { version: "desc" },
    });
    const selected = versionId
      ? versions.find((item) => item.id === versionId)
      : (versions.find((item) => item.id === template.currentPublishedVersionId) ??
        versions.find((item) => item.status === "DRAFT") ??
        versions[0]);
    if (!selected)
      return {
        template,
        versions,
        version: null,
        sections: [],
        questions: [],
        options: [],
        categoryApplicability: [],
        vehicleApplicability: [],
      };
    const [sections, questions, options, categoryApplicability, vehicleApplicability] =
      await Promise.all([
        tx.inspectionSection.findMany({
          where: { companyId: context.companyId, templateVersionId: selected.id, isActive: true },
          orderBy: { sortOrder: "asc" },
        }),
        tx.inspectionQuestion.findMany({
          where: { companyId: context.companyId, templateVersionId: selected.id, isActive: true },
          orderBy: [{ sectionId: "asc" }, { sortOrder: "asc" }],
        }),
        tx.inspectionQuestionOption.findMany({
          where: { companyId: context.companyId, templateVersionId: selected.id, isActive: true },
          orderBy: [{ questionId: "asc" }, { sortOrder: "asc" }],
        }),
        tx.inspectionTemplateCategoryApplicability.findMany({
          where: { companyId: context.companyId, templateVersionId: selected.id, isActive: true },
        }),
        tx.inspectionTemplateVehicleApplicability.findMany({
          where: { companyId: context.companyId, templateVersionId: selected.id, isActive: true },
        }),
      ]);
    return {
      template,
      versions,
      version: selected,
      sections,
      questions,
      options,
      categoryApplicability,
      vehicleApplicability,
    };
  });
}

export async function listInspectionSubmissionsPage(
  client: TenantClient,
  context: TenantContext,
  page: Page,
  filters: Readonly<{
    vehicleId?: string | undefined;
    driverId?: string | undefined;
    templateId?: string | undefined;
    status?: "DRAFT" | "SUBMITTED" | "CANCELLED" | undefined;
  }> = {},
) {
  requirePermission(context, "inspections.read");
  const driverId =
    context.role === "DRIVER" ? await ownDriverId(client, context) : filters.driverId;
  return withTenantTransaction(client, context, async (tx) => {
    const data = await tx.inspectionSubmission.findMany({
      where: {
        companyId: context.companyId,
        ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
        ...(driverId ? { driverId } : {}),
        ...(filters.templateId ? { templateId: filters.templateId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      skip: (page.number - 1) * page.pageSize,
      take: page.pageSize + 1,
    });
    return { data: data.slice(0, page.pageSize), hasNextPage: data.length > page.pageSize };
  });
}

export async function getInspectionSubmissionDetail(
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
    if (context.role === "DRIVER") {
      const driver = await tx.driver.findUnique({
        where: {
          companyId_id: {
            companyId: context.companyId,
            id: submission.driverId ?? "00000000-0000-0000-0000-000000000000",
          },
        },
        select: { companyId: true, userId: true },
      });
      if (!driver) throw new TenantRecordNotFoundError("Inspection submission");
      requireRecordScope(context, { companyId: driver.companyId, driverUserId: driver.userId });
    }
    const responses = await tx.inspectionResponse.findMany({
      where: { companyId: context.companyId, submissionId },
      orderBy: { createdAt: "asc" },
    });
    const responseIds = responses.map((item) => item.id);
    const [options, files] = await Promise.all([
      tx.inspectionResponseOption.findMany({
        where: { companyId: context.companyId, responseId: { in: responseIds }, isActive: true },
      }),
      tx.inspectionResponseFile.findMany({
        where: { companyId: context.companyId, responseId: { in: responseIds }, removedAt: null },
      }),
    ]);
    return { submission, responses, options, files };
  });
}
