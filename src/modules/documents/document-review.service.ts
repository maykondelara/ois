import { Prisma, type PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
type TenantClient = Pick<PrismaClient, "$transaction">;
export async function reviewDocument(
  client: TenantClient,
  context: TenantContext,
  documentId: string,
  decision: "APPROVED" | "REJECTED",
  rejectionReason?: string,
) {
  requirePermission(context, "documents.review");
  if (context.role === "DRIVER")
    throw new ValidationError("DRIVER_CANNOT_REVIEW", "Driver may not review documents");
  if (decision === "REJECTED" && !rejectionReason?.trim())
    throw new ValidationError("REJECTION_REASON_REQUIRED", "Rejection reason is required");
  return withTenantTransaction(client, context, async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM documents WHERE company_id=${context.companyId}::uuid AND id=${documentId}::uuid FOR UPDATE`,
    );
    const doc = await tx.document.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: documentId } },
    });
    if (!doc) throw new TenantRecordNotFoundError("Document");
    if (doc.reviewStatus !== "PENDING_REVIEW" || doc.archivedAt || doc.revokedAt)
      throw new ConflictError("DOCUMENT_ALREADY_RESOLVED", "Document cannot be reviewed");
    if (doc.createdByUserId === context.actorUserId)
      throw new ValidationError("DOCUMENT_FOUR_EYES_REQUIRED", "Document creator cannot review it");
    if (decision === "APPROVED") {
      const documentType = await tx.documentType.findUnique({
        where: { companyId_id: { companyId: context.companyId, id: doc.documentTypeId } },
      });
      if (!documentType || documentType.evidenceSourceType !== "DOCUMENT")
        throw new ValidationError("DOCUMENT_TYPE_INVALID", "Document type is unavailable");
      if (documentType.requiresIssueDate && !doc.issueDate)
        throw new ValidationError("ISSUE_DATE_REQUIRED", "Issue date is required");
      if (documentType.requiresExpiryDate && !doc.expiryDate)
        throw new ValidationError("EXPIRY_DATE_REQUIRED", "Expiry date is required");
      if (doc.validFrom && doc.expiryDate && doc.validFrom > doc.expiryDate)
        throw new ValidationError("DOCUMENT_DATE_RANGE_INVALID", "Validity date range is invalid");
      const attachments = await tx.documentFile.findMany({
        where: { companyId: context.companyId, documentId, removedAt: null },
        select: { storedFileId: true },
      });
      const file =
        attachments.length === 0
          ? null
          : await tx.storedFile.findFirst({
              where: {
                companyId: context.companyId,
                id: { in: attachments.map((attachment) => attachment.storedFileId) },
                fileState: "AVAILABLE",
              },
              select: { id: true },
            });
      if (!file)
        throw new ValidationError(
          "DOCUMENT_FILE_REQUIRED",
          "Approved document requires an available file",
        );
    }
    const updated = await tx.document.update({
      where: { companyId_id: { companyId: context.companyId, id: documentId } },
      data: {
        reviewStatus: decision,
        reviewedAt: new Date(),
        reviewedByUserId: context.actorUserId,
        rejectionReason: decision === "REJECTED" ? rejectionReason!.trim() : null,
      },
    });
    await tx.documentReviewHistory.create({
      data: {
        companyId: context.companyId,
        documentId,
        fromStatus: "PENDING_REVIEW",
        toStatus: decision,
        reviewedByUserId: context.actorUserId,
        reason: decision === "REJECTED" ? rejectionReason!.trim() : null,
      },
    });
    await recordTenantActivity(tx, context, {
      action: decision === "APPROVED" ? "document.approved" : "document.rejected",
      entityType: "document",
      entityId: documentId,
    });
    return updated;
  });
}
