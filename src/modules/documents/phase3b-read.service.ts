import { Prisma, type PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { AuthorizationError, TenantRecordNotFoundError } from "@/lib/errors";
import { companyLocalDate } from "@/modules/companies/company-date";
import { evaluateCompanyCompliance } from "@/modules/compliance/compliance-evaluation.service";
import { requirePermission, requireRecordScope } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";

type TenantClient = Pick<PrismaClient, "$transaction">;
type Page = Readonly<{ number: number; pageSize: number }>;

function pageResult<T>(rows: T[], pageSize: number) {
  return { data: rows.slice(0, pageSize), hasNextPage: rows.length > pageSize };
}

async function ownDriverId(transaction: Prisma.TransactionClient, context: TenantContext) {
  const driver = await transaction.driver.findFirst({
    where: { companyId: context.companyId, userId: context.actorUserId },
    select: { id: true, companyId: true, userId: true },
  });
  if (!driver) throw new TenantRecordNotFoundError("Driver");
  requireRecordScope(context, { companyId: driver.companyId, driverUserId: driver.userId });
  return driver.id;
}

export async function listDocumentTypesPage(
  client: TenantClient,
  context: TenantContext,
  page: Page,
  filters: Readonly<{
    subjectType?: "DRIVER" | "VEHICLE" | "COMPANY";
    evidenceSourceType?: "DOCUMENT" | "DRIVER_LICENCE";
    isActive?: boolean;
  }>,
) {
  requirePermission(context, "documents.read");
  return withTenantTransaction(client, context, async (tx) =>
    pageResult(
      await tx.documentType.findMany({
        where: { companyId: context.companyId, ...filters },
        orderBy: [{ code: "asc" }, { id: "asc" }],
        skip: (page.number - 1) * page.pageSize,
        take: page.pageSize + 1,
      }),
      page.pageSize,
    ),
  );
}

export async function getDocumentType(client: TenantClient, context: TenantContext, id: string) {
  requirePermission(context, "documents.read");
  return withTenantTransaction(client, context, async (tx) => {
    const item = await tx.documentType.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!item) throw new TenantRecordNotFoundError("Document type");
    return item;
  });
}

export async function listRequirementsPage(
  client: TenantClient,
  context: TenantContext,
  page: Page,
  filters: Readonly<{
    subjectType?: "DRIVER" | "VEHICLE" | "COMPANY";
    documentTypeId?: string;
    applicability?: "GLOBAL" | "SPECIFIC";
    isActive?: boolean;
  }>,
) {
  requirePermission(context, "compliance.read");
  return withTenantTransaction(client, context, async (tx) =>
    pageResult(
      await tx.complianceRequirement.findMany({
        where: { companyId: context.companyId, ...filters },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page.number - 1) * page.pageSize,
        take: page.pageSize + 1,
      }),
      page.pageSize,
    ),
  );
}

export async function getRequirement(client: TenantClient, context: TenantContext, id: string) {
  requirePermission(context, "compliance.read");
  return withTenantTransaction(client, context, async (tx) => {
    const item = await tx.complianceRequirement.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!item) throw new TenantRecordNotFoundError("Compliance requirement");
    return item;
  });
}

export async function listDocumentsPage(
  client: TenantClient,
  context: TenantContext,
  page: Page,
  filters: Readonly<{
    subjectType?: "DRIVER" | "VEHICLE" | "COMPANY";
    driverId?: string;
    vehicleId?: string;
    documentTypeId?: string;
    reviewStatus?: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
    includeArchived?: boolean;
  }>,
) {
  requirePermission(context, "documents.read");
  return withTenantTransaction(client, context, async (tx) => {
    const where: Prisma.DocumentWhereInput = {
      companyId: context.companyId,
      ...(filters.subjectType === undefined ? {} : { subjectType: filters.subjectType }),
      ...(filters.driverId === undefined ? {} : { driverId: filters.driverId }),
      ...(filters.vehicleId === undefined ? {} : { vehicleId: filters.vehicleId }),
      ...(filters.documentTypeId === undefined ? {} : { documentTypeId: filters.documentTypeId }),
      ...(filters.reviewStatus === undefined ? {} : { reviewStatus: filters.reviewStatus }),
      ...(filters.includeArchived ? {} : { archivedAt: null }),
    };
    if (context.role === "DRIVER") {
      const driverId = await ownDriverId(tx, context);
      if (filters.subjectType && filters.subjectType !== "DRIVER")
        throw new AuthorizationError("Driver document scope denied");
      if (filters.driverId && filters.driverId !== driverId)
        throw new AuthorizationError("Driver document scope denied");
      where.subjectType = "DRIVER";
      where.driverId = driverId;
    }
    return pageResult(
      await tx.document.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page.number - 1) * page.pageSize,
        take: page.pageSize + 1,
      }),
      page.pageSize,
    );
  });
}

export async function getDocument(client: TenantClient, context: TenantContext, id: string) {
  requirePermission(context, "documents.read");
  return withTenantTransaction(client, context, async (tx) => {
    const item = await tx.document.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!item) throw new TenantRecordNotFoundError("Document");
    if (context.role === "DRIVER") {
      const driverId = await ownDriverId(tx, context);
      if (item.subjectType !== "DRIVER" || item.driverId !== driverId)
        throw new AuthorizationError("Driver document scope denied");
    }
    return item;
  });
}

export async function getOperationalDocumentDetail(
  client: TenantClient,
  context: TenantContext,
  id: string,
) {
  requirePermission(context, "documents.read");
  return withTenantTransaction(client, context, async (tx) => {
    const document = await tx.document.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!document) throw new TenantRecordNotFoundError("Document");
    if (context.role === "DRIVER") {
      const driverId = await ownDriverId(tx, context);
      if (document.subjectType !== "DRIVER" || document.driverId !== driverId)
        throw new AuthorizationError("Driver document scope denied");
    }
    const [fileAssociations, reviewHistory] = await Promise.all([
      tx.documentFile.findMany({
        where: { companyId: context.companyId, documentId: id, removedAt: null },
        orderBy: [{ attachedAt: "asc" }, { id: "asc" }],
      }),
      tx.documentReviewHistory.findMany({
        where: { companyId: context.companyId, documentId: id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    const storedFiles = await tx.storedFile.findMany({
      where: {
        companyId: context.companyId,
        id: { in: fileAssociations.map((item) => item.storedFileId) },
      },
    });
    const files = fileAssociations.flatMap((association) => {
      const storedFile = storedFiles.find((item) => item.id === association.storedFileId);
      return storedFile ? [{ ...association, storedFile }] : [];
    });
    return {
      document,
      files,
      reviewHistory,
      createdByCurrentUser: document.createdByUserId === context.actorUserId,
    };
  });
}

export async function listComplianceSubjects(client: TenantClient, context: TenantContext) {
  requirePermission(context, "compliance.read");
  const evaluation = await currentEvaluation(client, context);
  return withTenantTransaction(client, context, async (tx) => {
    let summaries = [...evaluation.subjectSummaries];
    if (context.role === "DRIVER") {
      const driverId = await ownDriverId(tx, context);
      summaries = summaries.filter(
        (item) => item.subjectType === "DRIVER" && item.subjectId === driverId,
      );
    }
    const driverIds = summaries
      .filter((item) => item.subjectType === "DRIVER")
      .map((item) => item.subjectId);
    const vehicleIds = summaries
      .filter((item) => item.subjectType === "VEHICLE")
      .map((item) => item.subjectId);
    const [drivers, vehicles, company] = await Promise.all([
      tx.driver.findMany({
        where: { companyId: context.companyId, id: { in: driverIds } },
        select: { id: true, displayName: true },
      }),
      tx.vehicle.findMany({
        where: { companyId: context.companyId, id: { in: vehicleIds } },
        select: { id: true, registrationDisplay: true },
      }),
      tx.company.findUnique({ where: { id: context.companyId }, select: { id: true, name: true } }),
    ]);
    return summaries.map((summary) => {
      const obligations = evaluation.obligations.filter(
        (item) => item.subjectType === summary.subjectType && item.subjectId === summary.subjectId,
      );
      return {
        ...summary,
        displayName:
          summary.subjectType === "DRIVER"
            ? (drivers.find((item) => item.id === summary.subjectId)?.displayName ?? "Driver")
            : summary.subjectType === "VEHICLE"
              ? (vehicles.find((item) => item.id === summary.subjectId)?.registrationDisplay ??
                "Vehicle")
              : (company?.name ?? "Company"),
        obligations,
      };
    });
  });
}

export async function listRequirementAssignments(
  client: TenantClient,
  context: TenantContext,
  requirementId: string,
) {
  requirePermission(context, "compliance.read");
  if (context.role === "DRIVER") throw new AuthorizationError("Driver configuration scope denied");
  return withTenantTransaction(client, context, async (tx) => {
    const requirement = await tx.complianceRequirement.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: requirementId } },
      select: { id: true },
    });
    if (!requirement) throw new TenantRecordNotFoundError("Compliance requirement");
    return tx.complianceRequirementAssignment.findMany({
      where: { companyId: context.companyId, requirementId, removedAt: null },
      orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
      take: 100,
    });
  });
}

export async function listRequirementExemptions(
  client: TenantClient,
  context: TenantContext,
  requirementId: string,
) {
  requirePermission(context, "compliance.read");
  if (context.role === "DRIVER") throw new AuthorizationError("Driver configuration scope denied");
  return withTenantTransaction(client, context, async (tx) => {
    const requirement = await tx.complianceRequirement.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: requirementId } },
      select: { id: true },
    });
    if (!requirement) throw new TenantRecordNotFoundError("Compliance requirement");
    return tx.complianceRequirementExemption.findMany({
      where: { companyId: context.companyId, requirementId, revokedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });
  });
}

/** Validates URL parent/child relationships before invoking lifecycle services. */
export async function requireRequirementChild(
  client: TenantClient,
  context: TenantContext,
  requirementId: string,
  childId: string,
  kind: "assignment" | "exemption",
) {
  requirePermission(context, "compliance.manage");
  return withTenantTransaction(client, context, async (tx) => {
    const child =
      kind === "assignment"
        ? await tx.complianceRequirementAssignment.findUnique({
            where: { companyId_id: { companyId: context.companyId, id: childId } },
            select: { requirementId: true },
          })
        : await tx.complianceRequirementExemption.findUnique({
            where: { companyId_id: { companyId: context.companyId, id: childId } },
            select: { requirementId: true },
          });
    if (!child || child.requirementId !== requirementId)
      throw new TenantRecordNotFoundError(
        kind === "assignment" ? "Requirement assignment" : "Requirement exemption",
      );
  });
}

export async function requireDocumentFilePath(
  client: TenantClient,
  context: TenantContext,
  documentId: string,
  documentFileId: string,
) {
  return withTenantTransaction(client, context, async (tx) => {
    const association = await tx.documentFile.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: documentFileId } },
      select: { documentId: true },
    });
    if (!association || association.documentId !== documentId)
      throw new TenantRecordNotFoundError("Document file");
  });
}

export async function requireDriverLicencePath(
  client: TenantClient,
  context: TenantContext,
  driverId: string,
  licenceId: string,
  licenceFileId?: string,
) {
  return withTenantTransaction(client, context, async (tx) => {
    const licence = await tx.driverLicence.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: licenceId } },
      select: { driverId: true },
    });
    if (!licence || licence.driverId !== driverId)
      throw new TenantRecordNotFoundError("Driver licence");
    if (licenceFileId) {
      const attachment = await tx.driverLicenceFile.findUnique({
        where: { companyId_id: { companyId: context.companyId, id: licenceFileId } },
        select: { driverLicenceId: true },
      });
      if (!attachment || attachment.driverLicenceId !== licenceId)
        throw new TenantRecordNotFoundError("Driver licence file");
    }
    if (context.role === "DRIVER") {
      const driver = await tx.driver.findUnique({
        where: { companyId_id: { companyId: context.companyId, id: driverId } },
        select: { companyId: true, userId: true },
      });
      requireRecordScope(
        context,
        driver
          ? { companyId: driver.companyId, driverUserId: driver.userId }
          : { companyId: context.companyId, driverUserId: null },
      );
    }
  });
}

async function currentEvaluation(client: TenantClient, context: TenantContext) {
  const timezone = await withTenantTransaction(client, context, async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: context.companyId },
      select: { timezone: true },
    });
    if (!company) throw new TenantRecordNotFoundError("Company");
    return company.timezone;
  });
  return evaluateCompanyCompliance(client, context, companyLocalDate(new Date(), timezone));
}

export async function getDriverCompliance(
  client: TenantClient,
  context: TenantContext,
  driverId: string,
) {
  requirePermission(context, "compliance.read");
  if (context.role === "DRIVER")
    await withTenantTransaction(client, context, async (tx) => {
      if ((await ownDriverId(tx, context)) !== driverId)
        throw new AuthorizationError("Driver compliance scope denied");
    });
  const evaluation = await currentEvaluation(client, context);
  const exemptions = await withTenantTransaction(client, context, (tx) =>
    tx.complianceRequirementExemption.findMany({
      where: { companyId: context.companyId, subjectType: "DRIVER", driverId, revokedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  );
  return {
    evaluationDate: evaluation.evaluationDate,
    obligations: evaluation.obligations.filter(
      (item) => item.subjectType === "DRIVER" && item.subjectId === driverId,
    ),
    summary: evaluation.subjectSummaries.find(
      (item) => item.subjectType === "DRIVER" && item.subjectId === driverId,
    ),
    exemptions,
  };
}

export async function getVehicleCompliance(
  client: TenantClient,
  context: TenantContext,
  vehicleId: string,
) {
  requirePermission(context, "compliance.read");
  if (context.role === "DRIVER")
    throw new AuthorizationError("Driver vehicle compliance scope denied");
  const evaluation = await currentEvaluation(client, context);
  const exemptions = await withTenantTransaction(client, context, (tx) =>
    tx.complianceRequirementExemption.findMany({
      where: { companyId: context.companyId, subjectType: "VEHICLE", vehicleId, revokedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  );
  return {
    evaluationDate: evaluation.evaluationDate,
    obligations: evaluation.obligations.filter(
      (item) => item.subjectType === "VEHICLE" && item.subjectId === vehicleId,
    ),
    summary: evaluation.subjectSummaries.find(
      (item) => item.subjectType === "VEHICLE" && item.subjectId === vehicleId,
    ),
    exemptions,
  };
}

export async function getCompanyCompliance(client: TenantClient, context: TenantContext) {
  requirePermission(context, "compliance.read");
  if (context.role === "DRIVER")
    throw new AuthorizationError("Driver company compliance scope denied");
  const evaluation = await currentEvaluation(client, context);
  const exemptions = await withTenantTransaction(client, context, (tx) =>
    tx.complianceRequirementExemption.findMany({
      where: {
        companyId: context.companyId,
        subjectType: "COMPANY",
        companySubjectId: context.companyId,
        revokedAt: null,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  );
  return {
    evaluationDate: evaluation.evaluationDate,
    obligations: evaluation.obligations.filter((item) => item.subjectType === "COMPANY"),
    summary: evaluation.subjectSummaries.find((item) => item.subjectType === "COMPANY"),
    exemptions,
  };
}

export async function getComplianceSummary(client: TenantClient, context: TenantContext) {
  requirePermission(context, "compliance.read");
  if (context.role === "DRIVER")
    throw new AuthorizationError("Driver aggregate compliance scope denied");
  return currentEvaluation(client, context);
}
