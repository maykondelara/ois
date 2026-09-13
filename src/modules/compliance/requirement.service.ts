import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";

type TenantClient = Pick<PrismaClient, "$transaction">;
const base = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  expiryWarningDays: z.number().int().min(0).max(3650).optional(),
});
const createSchema = base
  .extend({
    documentTypeId: z.string().uuid(),
    subjectType: z.enum(["DRIVER", "VEHICLE", "COMPANY"]),
    applicability: z.enum(["GLOBAL", "SPECIFIC"]),
  })
  .superRefine((value, ctx) => {
    if (value.subjectType === "COMPANY" && value.applicability !== "GLOBAL")
      ctx.addIssue({ code: "custom", message: "Company requirements are global" });
  });

export async function createComplianceRequirement(
  client: TenantClient,
  context: TenantContext,
  raw: unknown,
) {
  requirePermission(context, "compliance.manage");
  const input = createSchema.parse(raw);
  return withTenantTransaction(client, context, async (tx) => {
    const type = await tx.documentType.findFirst({
      where: {
        companyId: context.companyId,
        id: input.documentTypeId,
        subjectType: input.subjectType,
        isActive: true,
      },
    });
    if (!type)
      throw new ValidationError(
        "INVALID_DOCUMENT_TYPE",
        "Document type is inactive or incompatible",
      );
    try {
      const requirement = await tx.complianceRequirement.create({
        data: {
          companyId: context.companyId,
          documentTypeId: input.documentTypeId,
          subjectType: input.subjectType,
          applicability: input.applicability,
          name: input.name,
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.expiryWarningDays === undefined
            ? {}
            : { expiryWarningDays: input.expiryWarningDays }),
        },
      });
      await recordTenantActivity(tx, context, {
        action: "compliance_requirement.created",
        entityType: "compliance_requirement",
        entityId: requirement.id,
      });
      return requirement;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new ConflictError(
          "DUPLICATE_COMPLIANCE_REQUIREMENT",
          "Active requirement already exists",
        );
      throw error;
    }
  });
}
export async function updateComplianceRequirement(
  client: TenantClient,
  context: TenantContext,
  id: string,
  raw: unknown,
) {
  requirePermission(context, "compliance.manage");
  const input = base.partial().parse(raw);
  return withTenantTransaction(client, context, async (tx) => {
    const prior = await tx.complianceRequirement.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!prior) throw new TenantRecordNotFoundError("Compliance requirement");
    const updated = await tx.complianceRequirement.update({
      where: { companyId_id: { companyId: context.companyId, id } },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.expiryWarningDays === undefined
          ? {}
          : { expiryWarningDays: input.expiryWarningDays }),
      },
    });
    await recordTenantActivity(tx, context, {
      action: "compliance_requirement.updated",
      entityType: "compliance_requirement",
      entityId: id,
    });
    return updated;
  });
}
export async function setRequirementActive(
  client: TenantClient,
  context: TenantContext,
  id: string,
  isActive: boolean,
) {
  requirePermission(context, "compliance.manage");
  return withTenantTransaction(client, context, async (tx) => {
    const requirement = await tx.complianceRequirement.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!requirement) throw new TenantRecordNotFoundError("Compliance requirement");
    if (isActive) {
      const type = await tx.documentType.findFirst({
        where: { companyId: context.companyId, id: requirement.documentTypeId, isActive: true },
      });
      if (!type)
        throw new ConflictError("DOCUMENT_TYPE_INACTIVE", "Referenced document type is inactive");
    }
    const updated = await tx.complianceRequirement.update({
      where: { companyId_id: { companyId: context.companyId, id } },
      data: { isActive },
    });
    await recordTenantActivity(tx, context, {
      action: isActive ? "compliance_requirement.activated" : "compliance_requirement.deactivated",
      entityType: "compliance_requirement",
      entityId: id,
    });
    return updated;
  });
}
export async function changeRequirementApplicability(
  client: TenantClient,
  context: TenantContext,
  id: string,
  applicability: "GLOBAL" | "SPECIFIC",
  reason: string,
) {
  requirePermission(context, "compliance.manage");
  if (!reason.trim())
    throw new ValidationError("APPLICABILITY_REASON_REQUIRED", "A change reason is required");
  return withTenantTransaction(client, context, async (tx) => {
    const requirement = await tx.complianceRequirement.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!requirement) throw new TenantRecordNotFoundError("Compliance requirement");
    if (requirement.subjectType === "COMPANY" && applicability !== "GLOBAL")
      throw new ValidationError("COMPANY_REQUIREMENT_GLOBAL", "Company requirements are global");
    const updated = await tx.complianceRequirement.update({
      where: { companyId_id: { companyId: context.companyId, id } },
      data: { applicability },
    });
    await recordTenantActivity(tx, context, {
      action: "compliance_requirement.applicability_changed",
      entityType: "compliance_requirement",
      entityId: id,
      metadata: { from: requirement.applicability, to: applicability, reason: reason.trim() },
    });
    return updated;
  });
}
