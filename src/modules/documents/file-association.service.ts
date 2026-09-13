import { Prisma, type PrismaClient } from "@prisma/client";
import type { TenantTransaction } from "@/db/tenant-transaction";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission, requireRecordScope } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";

type TenantClient = Pick<PrismaClient, "$transaction">;

async function requireEditableDocument(
  transaction: TenantTransaction,
  context: TenantContext,
  documentId: string,
) {
  const document = await transaction.document.findUnique({
    where: { companyId_id: { companyId: context.companyId, id: documentId } },
  });
  if (!document) throw new TenantRecordNotFoundError("Document");
  if (context.role === "DRIVER") {
    if (document.subjectType !== "DRIVER" || !document.driverId)
      throw new ValidationError("DRIVER_SELF_SCOPE", "Driver may manage only their own document");
    const driver = await transaction.driver.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: document.driverId } },
      select: { companyId: true, userId: true },
    });
    requireRecordScope(
      context,
      driver
        ? { companyId: driver.companyId, driverUserId: driver.userId }
        : { companyId: context.companyId, driverUserId: null },
    );
  }
  if (document.reviewStatus !== "PENDING_REVIEW" || document.archivedAt || document.revokedAt)
    throw new ConflictError("DOCUMENT_IMMUTABLE", "Document evidence is immutable");
  return document;
}

async function requireLicenceScope(
  transaction: TenantTransaction,
  context: TenantContext,
  licenceId: string,
) {
  const licence = await transaction.driverLicence.findUnique({
    where: { companyId_id: { companyId: context.companyId, id: licenceId } },
  });
  if (!licence) throw new TenantRecordNotFoundError("Driver licence");
  const driver = await transaction.driver.findUnique({
    where: { companyId_id: { companyId: context.companyId, id: licence.driverId } },
    select: { companyId: true, userId: true },
  });
  requireRecordScope(
    context,
    driver
      ? { companyId: driver.companyId, driverUserId: driver.userId }
      : { companyId: context.companyId, driverUserId: null },
  );
  return licence;
}

export async function attachDocumentFile(
  client: TenantClient,
  context: TenantContext,
  documentId: string,
  storedFileId: string,
) {
  if (context.role !== "DRIVER") requirePermission(context, "documents.manage");
  return withTenantTransaction(client, context, async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT id FROM documents WHERE company_id=${context.companyId}::uuid AND id=${documentId}::uuid FOR UPDATE`,
    );
    await requireEditableDocument(transaction, context, documentId);
    const file = await transaction.storedFile.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: storedFileId } },
      select: { id: true, fileState: true },
    });
    if (!file) throw new TenantRecordNotFoundError("Stored file");
    if (file.fileState !== "AVAILABLE")
      throw new ValidationError(
        "DOCUMENT_FILE_UNAVAILABLE",
        "Document attachment must be available",
      );
    const existingLicenceAttachment = await transaction.driverLicenceFile.findFirst({
      where: { companyId: context.companyId, storedFileId, removedAt: null },
      select: { id: true },
    });
    if (existingLicenceAttachment)
      throw new ConflictError("STORED_FILE_ALREADY_ATTACHED", "Stored file is already attached");
    try {
      const association = await transaction.documentFile.create({
        data: {
          companyId: context.companyId,
          documentId,
          storedFileId,
          attachedByUserId: context.actorUserId,
        },
      });
      await recordTenantActivity(transaction, context, {
        action: "document.file_attached",
        entityType: "document_file",
        entityId: association.id,
        metadata: { documentId },
      });
      return association;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new ConflictError("STORED_FILE_ALREADY_ATTACHED", "Stored file is already attached");
      throw error;
    }
  });
}

export async function removeDocumentFile(
  client: TenantClient,
  context: TenantContext,
  id: string,
  reason: string,
) {
  if (context.role !== "DRIVER") requirePermission(context, "documents.manage");
  if (!reason.trim())
    throw new ValidationError("REMOVAL_REASON_REQUIRED", "Removal reason is required");
  return withTenantTransaction(client, context, async (transaction) => {
    const association = await transaction.documentFile.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!association) throw new TenantRecordNotFoundError("Document file");
    await transaction.$queryRaw(
      Prisma.sql`SELECT id FROM documents WHERE company_id=${context.companyId}::uuid AND id=${association.documentId}::uuid FOR UPDATE`,
    );
    await requireEditableDocument(transaction, context, association.documentId);
    if (association.removedAt)
      throw new ConflictError("FILE_ALREADY_REMOVED", "File association is removed");
    const removed = await transaction.documentFile.update({
      where: { companyId_id: { companyId: context.companyId, id } },
      data: {
        removedAt: new Date(),
        removedByUserId: context.actorUserId,
        removalReason: reason.trim(),
      },
    });
    await recordTenantActivity(transaction, context, {
      action: "document.file_removed",
      entityType: "document_file",
      entityId: id,
      metadata: { documentId: association.documentId },
    });
    return removed;
  });
}

export async function attachDriverLicenceFile(
  client: TenantClient,
  context: TenantContext,
  licenceId: string,
  storedFileId: string,
  role: "FRONT" | "BACK" | "COMBINED",
) {
  if (context.role !== "DRIVER") requirePermission(context, "documents.manage");
  return withTenantTransaction(client, context, async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT id FROM driver_licences WHERE company_id=${context.companyId}::uuid AND id=${licenceId}::uuid FOR UPDATE`,
    );
    const licence = await requireLicenceScope(transaction, context, licenceId);
    const file = await transaction.storedFile.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: storedFileId } },
    });
    if (!file || file.fileState !== "AVAILABLE")
      throw new ValidationError("LICENCE_FILE_UNAVAILABLE", "Licence attachment must be available");
    const existingDocumentAttachment = await transaction.documentFile.findFirst({
      where: { companyId: context.companyId, storedFileId, removedAt: null },
      select: { id: true },
    });
    if (existingDocumentAttachment)
      throw new ConflictError("STORED_FILE_ALREADY_ATTACHED", "Stored file is already attached");
    const expectedMime = role === "COMBINED" ? ["application/pdf"] : ["image/jpeg", "image/png"];
    if (!expectedMime.includes(file.mimeType ?? ""))
      throw new ValidationError("LICENCE_FILE_TYPE_INVALID", "Licence file type is invalid");
    try {
      const association = await transaction.driverLicenceFile.create({
        data: {
          companyId: context.companyId,
          driverLicenceId: licence.id,
          storedFileId,
          role,
          attachedByUserId: context.actorUserId,
        },
      });
      await recordTenantActivity(transaction, context, {
        action: "driver.licence_file_attached",
        entityType: "driver_licence_file",
        entityId: association.id,
        metadata: { driverLicenceId: licence.id, role },
      });
      return association;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new ConflictError("LICENCE_ATTACHMENT_CONFLICT", "Licence attachment conflicts");
      throw error;
    }
  });
}

export async function removeDriverLicenceFile(
  client: TenantClient,
  context: TenantContext,
  id: string,
  reason: string,
) {
  if (context.role !== "DRIVER") requirePermission(context, "documents.manage");
  if (!reason.trim())
    throw new ValidationError("REMOVAL_REASON_REQUIRED", "Removal reason is required");
  return withTenantTransaction(client, context, async (transaction) => {
    const association = await transaction.driverLicenceFile.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!association) throw new TenantRecordNotFoundError("Driver licence file");
    await transaction.$queryRaw(
      Prisma.sql`SELECT id FROM driver_licences WHERE company_id=${context.companyId}::uuid AND id=${association.driverLicenceId}::uuid FOR UPDATE`,
    );
    await requireLicenceScope(transaction, context, association.driverLicenceId);
    if (association.removedAt)
      throw new ConflictError("FILE_ALREADY_REMOVED", "File association is removed");
    const removed = await transaction.driverLicenceFile.update({
      where: { companyId_id: { companyId: context.companyId, id } },
      data: {
        removedAt: new Date(),
        removedByUserId: context.actorUserId,
        removalReason: reason.trim(),
      },
    });
    await recordTenantActivity(transaction, context, {
      action: "driver.licence_file_removed",
      entityType: "driver_licence_file",
      entityId: id,
      metadata: { driverLicenceId: association.driverLicenceId, role: association.role },
    });
    return removed;
  });
}
