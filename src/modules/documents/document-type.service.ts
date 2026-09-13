import type { EvidenceSourceType, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";

type TenantClient = Pick<PrismaClient, "$transaction">;
const createSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{0,62}$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).nullable().optional(),
  subjectType: z.enum(["DRIVER", "VEHICLE", "COMPANY"]),
  evidenceSourceType: z.enum(["DOCUMENT", "DRIVER_LICENCE"]),
  requiresIssueDate: z.boolean().default(false),
  requiresExpiryDate: z.boolean().default(false),
});
const updateSchema = createSchema
  .pick({ name: true, description: true, requiresIssueDate: true, requiresExpiryDate: true })
  .partial();

export async function listDocumentTypes(
  client: TenantClient,
  context: TenantContext,
  includeInactive = false,
) {
  requirePermission(context, "documents.read");
  return withTenantTransaction(client, context, (tx) =>
    tx.documentType.findMany({
      where: { companyId: context.companyId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { code: "asc" },
    }),
  );
}
export async function createDocumentType(
  client: TenantClient,
  context: TenantContext,
  raw: unknown,
) {
  requirePermission(context, "compliance.manage");
  const input = createSchema.parse(raw);
  return withTenantTransaction(client, context, async (tx) => {
    try {
      const item = await tx.documentType.create({
        data: {
          companyId: context.companyId,
          code: input.code,
          name: input.name,
          subjectType: input.subjectType,
          evidenceSourceType: input.evidenceSourceType,
          requiresIssueDate: input.requiresIssueDate,
          requiresExpiryDate: input.requiresExpiryDate,
          ...(input.description === undefined ? {} : { description: input.description }),
        },
      });
      await recordTenantActivity(tx, context, {
        action: "document_type.created",
        entityType: "document_type",
        entityId: item.id,
        metadata: { code: item.code, evidenceSourceType: item.evidenceSourceType },
      });
      return item;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new ConflictError("DUPLICATE_DOCUMENT_TYPE", "Document type already exists");
      throw error;
    }
  });
}
export async function updateDocumentType(
  client: TenantClient,
  context: TenantContext,
  id: string,
  raw: unknown,
) {
  requirePermission(context, "compliance.manage");
  const input = updateSchema.parse(raw);
  return withTenantTransaction(client, context, async (tx) => {
    const item = await tx.documentType.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!item) throw new TenantRecordNotFoundError("Document type");
    const updated = await tx.documentType.update({
      where: { companyId_id: { companyId: context.companyId, id } },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.requiresIssueDate === undefined
          ? {}
          : { requiresIssueDate: input.requiresIssueDate }),
        ...(input.requiresExpiryDate === undefined
          ? {}
          : { requiresExpiryDate: input.requiresExpiryDate }),
      },
    });
    await recordTenantActivity(tx, context, {
      action: "document_type.updated",
      entityType: "document_type",
      entityId: id,
    });
    return updated;
  });
}
export async function setDocumentTypeActive(
  client: TenantClient,
  context: TenantContext,
  id: string,
  isActive: boolean,
) {
  requirePermission(context, "compliance.manage");
  return withTenantTransaction(client, context, async (tx) => {
    const item = await tx.documentType.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!item) throw new TenantRecordNotFoundError("Document type");
    if (!isActive) {
      const activeRequirement = await tx.complianceRequirement.findFirst({
        where: { companyId: context.companyId, documentTypeId: id, isActive: true },
        select: { id: true },
      });
      if (activeRequirement)
        throw new ConflictError("DOCUMENT_TYPE_IN_USE", "Deactivate active requirements first");
    }
    const updated = await tx.documentType.update({
      where: { companyId_id: { companyId: context.companyId, id } },
      data: { isActive },
    });
    await recordTenantActivity(tx, context, {
      action: isActive ? "document_type.activated" : "document_type.deactivated",
      entityType: "document_type",
      entityId: id,
    });
    return updated;
  });
}
export type DocumentEvidenceSource = EvidenceSourceType;
