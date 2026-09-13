import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission, requireRecordScope } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
type TenantClient = Pick<PrismaClient, "$transaction">;
const subjectSchema = z
  .object({
    documentTypeId: z.string().uuid(),
    subjectType: z.enum(["DRIVER", "VEHICLE", "COMPANY"]),
    driverId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
    issueDate: z.coerce.date().nullable().optional(),
    validFrom: z.coerce.date().nullable().optional(),
    expiryDate: z.coerce.date().nullable().optional(),
  })
  .superRefine((v, c) => {
    if (v.validFrom && v.expiryDate && v.validFrom > v.expiryDate)
      c.addIssue({ code: "custom", message: "Validity date range is invalid" });
  });
const pendingUpdateSchema = z
  .object({
    issueDate: z.coerce.date().nullable().optional(),
    validFrom: z.coerce.date().nullable().optional(),
    expiryDate: z.coerce.date().nullable().optional(),
  })
  .superRefine((v, c) => {
    if (v.validFrom && v.expiryDate && v.validFrom > v.expiryDate)
      c.addIssue({ code: "custom", message: "Validity date range is invalid" });
  });
function ownDriver(context: TenantContext, driverUserId: string | null, driverId: string) {
  if (context.role === "DRIVER")
    requireRecordScope(context, { companyId: context.companyId, driverUserId });
  return driverId;
}
export async function createDocument(client: TenantClient, context: TenantContext, raw: unknown) {
  const input = subjectSchema.parse(raw);
  if (context.role !== "DRIVER") requirePermission(context, "documents.manage");
  return withTenantTransaction(client, context, async (tx) => {
    const type = await tx.documentType.findFirst({
      where: {
        companyId: context.companyId,
        id: input.documentTypeId,
        subjectType: input.subjectType,
        evidenceSourceType: "DOCUMENT",
        isActive: true,
      },
    });
    if (!type) throw new ValidationError("DOCUMENT_TYPE_INVALID", "Document type is unavailable");
    if (type.requiresIssueDate && !input.issueDate)
      throw new ValidationError("ISSUE_DATE_REQUIRED", "Issue date is required");
    if (type.requiresExpiryDate && !input.expiryDate)
      throw new ValidationError("EXPIRY_DATE_REQUIRED", "Expiry date is required");
    if (input.subjectType === "DRIVER") {
      const driver = await tx.driver.findUnique({
        where: { companyId_id: { companyId: context.companyId, id: input.driverId! } },
      });
      if (!driver) throw new TenantRecordNotFoundError("Driver");
      ownDriver(context, driver.userId, driver.id);
    }
    if (context.role === "DRIVER" && input.subjectType !== "DRIVER")
      throw new ValidationError("DRIVER_SELF_SCOPE", "Drivers may submit only their own evidence");
    const item = await tx.document.create({
      data: {
        companyId: context.companyId,
        documentTypeId: input.documentTypeId,
        subjectType: input.subjectType,
        driverId: input.subjectType === "DRIVER" ? input.driverId! : null,
        vehicleId: input.subjectType === "VEHICLE" ? input.vehicleId! : null,
        companySubjectId: input.subjectType === "COMPANY" ? context.companyId : null,
        issueDate: input.issueDate ?? null,
        validFrom: input.validFrom ?? null,
        expiryDate: input.expiryDate ?? null,
        createdByUserId: context.actorUserId,
      },
    });
    await recordTenantActivity(tx, context, {
      action: "document.created",
      entityType: "document",
      entityId: item.id,
    });
    return item;
  });
}

/** Only pending evidence may be corrected; structural subject and type are immutable. */
export async function updatePendingDocument(
  client: TenantClient,
  context: TenantContext,
  id: string,
  raw: unknown,
) {
  const input = pendingUpdateSchema.parse(raw);
  if (context.role !== "DRIVER") requirePermission(context, "documents.manage");
  if (Object.keys(input).length === 0)
    throw new ValidationError("EMPTY_DOCUMENT_UPDATE", "Document update requires a field");
  return withTenantTransaction(client, context, async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM documents WHERE company_id=${context.companyId}::uuid AND id=${id}::uuid FOR UPDATE`,
    );
    const document = await tx.document.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!document) throw new TenantRecordNotFoundError("Document");
    if (document.subjectType === "DRIVER" && document.driverId) {
      const driver = await tx.driver.findUnique({
        where: { companyId_id: { companyId: context.companyId, id: document.driverId } },
      });
      ownDriver(context, driver?.userId ?? null, document.driverId);
    }
    if (context.role === "DRIVER" && document.subjectType !== "DRIVER")
      throw new ValidationError("DRIVER_SELF_SCOPE", "Drivers may update only their own evidence");
    if (document.reviewStatus !== "PENDING_REVIEW" || document.archivedAt || document.revokedAt)
      throw new ConflictError("DOCUMENT_IMMUTABLE", "Final document evidence is immutable");
    const issueDate = input.issueDate === undefined ? document.issueDate : input.issueDate;
    const validFrom = input.validFrom === undefined ? document.validFrom : input.validFrom;
    const expiryDate = input.expiryDate === undefined ? document.expiryDate : input.expiryDate;
    if (validFrom && expiryDate && validFrom > expiryDate)
      throw new ValidationError("DOCUMENT_DATE_RANGE_INVALID", "Validity date range is invalid");
    const type = await tx.documentType.findFirst({
      where: { companyId: context.companyId, id: document.documentTypeId },
    });
    if (!type) throw new TenantRecordNotFoundError("Document type");
    if (type.requiresIssueDate && !issueDate)
      throw new ValidationError("ISSUE_DATE_REQUIRED", "Issue date is required");
    if (type.requiresExpiryDate && !expiryDate)
      throw new ValidationError("EXPIRY_DATE_REQUIRED", "Expiry date is required");
    const updated = await tx.document.update({
      where: { companyId_id: { companyId: context.companyId, id } },
      data: {
        ...(input.issueDate === undefined ? {} : { issueDate }),
        ...(input.validFrom === undefined ? {} : { validFrom }),
        ...(input.expiryDate === undefined ? {} : { expiryDate }),
      },
    });
    await recordTenantActivity(tx, context, {
      action: "document.updated",
      entityType: "document",
      entityId: id,
    });
    return updated;
  });
}
export async function archiveDocument(client: TenantClient, context: TenantContext, id: string) {
  requirePermission(context, "documents.manage");
  return withTenantTransaction(client, context, async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM documents WHERE company_id=${context.companyId}::uuid AND id=${id}::uuid FOR UPDATE`,
    );
    const doc = await tx.document.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!doc) throw new TenantRecordNotFoundError("Document");
    if (doc.archivedAt)
      throw new ConflictError("DOCUMENT_ALREADY_ARCHIVED", "Document is already archived");
    const item = await tx.document.update({
      where: { companyId_id: { companyId: context.companyId, id } },
      data: { archivedAt: new Date(), archivedByUserId: context.actorUserId },
    });
    await recordTenantActivity(tx, context, {
      action: "document.archived",
      entityType: "document",
      entityId: id,
    });
    return item;
  });
}
export async function revokeDocument(
  client: TenantClient,
  context: TenantContext,
  id: string,
  reason: string,
) {
  requirePermission(context, "documents.manage");
  requirePermission(context, "documents.review");
  if (!reason.trim())
    throw new ValidationError("REVOCATION_REASON_REQUIRED", "Revocation reason is required");
  return withTenantTransaction(client, context, async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM documents WHERE company_id=${context.companyId}::uuid AND id=${id}::uuid FOR UPDATE`,
    );
    const doc = await tx.document.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!doc) throw new TenantRecordNotFoundError("Document");
    if (doc.reviewStatus !== "APPROVED" || doc.archivedAt || doc.revokedAt)
      throw new ConflictError(
        "DOCUMENT_NOT_REVOCABLE",
        "Only active approved documents may be revoked",
      );
    const item = await tx.document.update({
      where: { companyId_id: { companyId: context.companyId, id } },
      data: {
        revokedAt: new Date(),
        revokedByUserId: context.actorUserId,
        revocationReason: reason.trim(),
      },
    });
    await recordTenantActivity(tx, context, {
      action: "document.revoked",
      entityType: "document",
      entityId: id,
    });
    return item;
  });
}
