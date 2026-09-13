import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { detectSupportedFileType } from "@/modules/compliance/compliance-domain";
import type { FileStorageProvider } from "@/modules/documents/file-storage";
import { opaqueObjectKey } from "@/modules/documents/file-storage";
import { requirePermission, requireRecordScope } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
type TenantClient = Pick<PrismaClient, "$transaction">;
const maxBytes = 10_485_760;

function requireStoredFileMutationPermission(context: TenantContext) {
  if (context.role === "DRIVER") return requirePermission(context, "documents.read");
  return requirePermission(context, "documents.manage");
}

export async function initiateStoredFile(
  client: TenantClient,
  context: TenantContext,
  provider: FileStorageProvider,
  bucket: string,
  originalFilename: string,
  uploadUrlTtlSeconds = 900,
) {
  requireStoredFileMutationPermission(context);
  return withTenantTransaction(client, context, async (tx) => {
    const file = await tx.storedFile.create({
      data: {
        companyId: context.companyId,
        storageProvider: "s3-compatible",
        bucket,
        objectKey: `pending/${crypto.randomUUID()}`,
        originalFilename: originalFilename.replace(/[\r\n]/g, " ").slice(0, 255),
        createdByUserId: context.actorUserId,
      },
    });
    const objectKey = opaqueObjectKey(context.companyId, file.id);
    const updated = await tx.storedFile.update({
      where: { companyId_id: { companyId: context.companyId, id: file.id } },
      data: { objectKey },
    });
    const uploadUrl = await provider.createUploadUrl({
      bucket,
      objectKey,
      expiresInSeconds: uploadUrlTtlSeconds,
    });
    await recordTenantActivity(tx, context, {
      action: "stored_file.initiated",
      entityType: "stored_file",
      entityId: updated.id,
    });
    return { file: updated, uploadUrl };
  });
}
export async function finalizeStoredFile(
  client: TenantClient,
  context: TenantContext,
  provider: FileStorageProvider,
  fileId: string,
) {
  requireStoredFileMutationPermission(context);
  return withTenantTransaction(client, context, async (tx) => {
    const file = await tx.storedFile.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: fileId } },
    });
    if (!file) throw new TenantRecordNotFoundError("Stored file");
    if (context.role === "DRIVER" && file.createdByUserId !== context.actorUserId)
      throw new TenantRecordNotFoundError("Stored file");
    if (file.fileState !== "PENDING")
      throw new ConflictError("STORED_FILE_NOT_PENDING", "Stored file is not pending");
    const object = await provider.inspectObject({
      bucket: file.bucket,
      objectKey: file.objectKey,
      maxBytes: maxBytes,
    });
    const mimeType = detectSupportedFileType(object.content);
    const oversized = object.content.byteLength > maxBytes;
    if (!mimeType || oversized) {
      const quarantined = await tx.storedFile.update({
        where: { companyId_id: { companyId: context.companyId, id: fileId } },
        data: { fileState: "QUARANTINED" },
      });
      await recordTenantActivity(tx, context, {
        action: "stored_file.quarantined",
        entityType: "stored_file",
        entityId: fileId,
      });
      return quarantined;
    }
    const sha256 = createHash("sha256").update(object.content).digest();
    const available = await tx.storedFile.update({
      where: { companyId_id: { companyId: context.companyId, id: fileId } },
      data: { fileState: "AVAILABLE", mimeType, sizeBytes: object.content.byteLength, sha256 },
    });
    await recordTenantActivity(tx, context, {
      action: "stored_file.finalized",
      entityType: "stored_file",
      entityId: fileId,
      metadata: { mimeType, sizeBytes: object.content.byteLength },
    });
    return available;
  });
}

/** AVAILABLE evidence may be quarantined later without altering verified metadata. */
export async function quarantineStoredFile(
  client: TenantClient,
  context: TenantContext,
  fileId: string,
) {
  requirePermission(context, "documents.manage");
  return withTenantTransaction(client, context, async (tx) => {
    const file = await tx.storedFile.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: fileId } },
    });
    if (!file) throw new TenantRecordNotFoundError("Stored file");
    if (file.fileState !== "AVAILABLE")
      throw new ConflictError("STORED_FILE_NOT_AVAILABLE", "Stored file is not available");
    const quarantined = await tx.storedFile.update({
      where: { companyId_id: { companyId: context.companyId, id: fileId } },
      data: { fileState: "QUARANTINED" },
    });
    await recordTenantActivity(tx, context, {
      action: "stored_file.quarantined",
      entityType: "stored_file",
      entityId: fileId,
    });
    return quarantined;
  });
}

export async function createStoredFileDownload(
  client: TenantClient,
  context: TenantContext,
  provider: FileStorageProvider,
  fileId: string,
  downloadUrlTtlSeconds = 300,
) {
  requirePermission(context, "documents.file.read");
  return withTenantTransaction(client, context, async (tx) => {
    const file = await tx.storedFile.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: fileId } },
    });
    if (!file || file.fileState !== "AVAILABLE") throw new TenantRecordNotFoundError("Stored file");
    if (context.role === "DRIVER") {
      const [documentAttachment, licenceAttachment] = await Promise.all([
        tx.documentFile.findFirst({
          where: { companyId: context.companyId, storedFileId: fileId, removedAt: null },
          select: { documentId: true },
        }),
        tx.driverLicenceFile.findFirst({
          where: { companyId: context.companyId, storedFileId: fileId, removedAt: null },
          select: { driverLicenceId: true },
        }),
      ]);
      let driverId: string | null = null;
      if (documentAttachment) {
        const document = await tx.document.findUnique({
          where: {
            companyId_id: { companyId: context.companyId, id: documentAttachment.documentId },
          },
          select: { subjectType: true, driverId: true },
        });
        driverId = document?.subjectType === "DRIVER" ? document.driverId : null;
      } else if (licenceAttachment) {
        const licence = await tx.driverLicence.findUnique({
          where: {
            companyId_id: { companyId: context.companyId, id: licenceAttachment.driverLicenceId },
          },
          select: { driverId: true },
        });
        driverId = licence?.driverId ?? null;
      }
      if (!driverId) throw new TenantRecordNotFoundError("Stored file");
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
    return {
      filename: file.originalFilename,
      url: await provider.createDownloadUrl({
        bucket: file.bucket,
        objectKey: file.objectKey,
        expiresInSeconds: downloadUrlTtlSeconds,
      }),
    };
  });
}
