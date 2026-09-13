import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
import { rangesOverlap } from "@/modules/compliance/compliance-domain";
type TenantClient = Pick<PrismaClient, "$transaction">;
const inputSchema = z
  .object({
    requirementId: z.string().uuid(),
    subjectType: z.enum(["DRIVER", "VEHICLE", "COMPANY"]),
    driverId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
    reason: z.string().trim().min(1).max(2000),
    effectiveFrom: z.coerce.date().nullable().optional(),
    expiresOn: z.coerce.date().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.effectiveFrom && value.expiresOn && value.effectiveFrom > value.expiresOn)
      ctx.addIssue({ code: "custom", message: "Expiry precedes effective date" });
  });
export async function grantRequirementExemption(
  client: TenantClient,
  context: TenantContext,
  raw: unknown,
) {
  requirePermission(context, "compliance.manage");
  const input = inputSchema.parse(raw);
  return withTenantTransaction(client, context, async (tx) => {
    // Serializes overlapping-range checks for this requirement without a workflow table.
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM compliance_requirements WHERE company_id=${context.companyId}::uuid AND id=${input.requirementId}::uuid FOR UPDATE`,
    );
    const requirement = await tx.complianceRequirement.findFirst({
      where: {
        companyId: context.companyId,
        id: input.requirementId,
        subjectType: input.subjectType,
      },
    });
    if (!requirement)
      throw new ValidationError("EXEMPTION_REQUIREMENT_INVALID", "Requirement is incompatible");
    const where = {
      companyId: context.companyId,
      requirementId: input.requirementId,
      subjectType: input.subjectType,
      ...(input.subjectType === "DRIVER"
        ? { driverId: input.driverId ?? null }
        : input.subjectType === "VEHICLE"
          ? { vehicleId: input.vehicleId ?? null }
          : { companySubjectId: context.companyId }),
      revokedAt: null,
    };
    const current = await tx.complianceRequirementExemption.findMany({
      where,
      select: { effectiveFrom: true, expiresOn: true },
    });
    if (
      current.some((item) =>
        rangesOverlap(
          { from: item.effectiveFrom, until: item.expiresOn },
          { from: input.effectiveFrom ?? null, until: input.expiresOn ?? null },
        ),
      )
    )
      throw new ConflictError("OVERLAPPING_EXEMPTION", "Exemption overlaps an existing exemption");
    const item = await tx.complianceRequirementExemption.create({
      data: {
        companyId: context.companyId,
        requirementId: input.requirementId,
        subjectType: input.subjectType,
        driverId: input.subjectType === "DRIVER" ? (input.driverId ?? null) : null,
        vehicleId: input.subjectType === "VEHICLE" ? (input.vehicleId ?? null) : null,
        companySubjectId: input.subjectType === "COMPANY" ? context.companyId : null,
        reason: input.reason,
        effectiveFrom: input.effectiveFrom ?? null,
        expiresOn: input.expiresOn ?? null,
        grantedByUserId: context.actorUserId,
      },
    });
    await recordTenantActivity(tx, context, {
      action: "compliance_requirement.exemption_granted",
      entityType: "compliance_requirement_exemption",
      entityId: item.id,
    });
    return item;
  });
}
export async function revokeRequirementExemption(
  client: TenantClient,
  context: TenantContext,
  id: string,
  reason: string,
) {
  requirePermission(context, "compliance.manage");
  if (!reason.trim())
    throw new ValidationError("REVOCATION_REASON_REQUIRED", "Revocation reason is required");
  return withTenantTransaction(client, context, async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM compliance_requirement_exemptions WHERE company_id=${context.companyId}::uuid AND id=${id}::uuid FOR UPDATE`,
    );
    const item = await tx.complianceRequirementExemption.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!item) throw new TenantRecordNotFoundError("Compliance requirement exemption");
    if (item.revokedAt)
      throw new ConflictError("EXEMPTION_ALREADY_REVOKED", "Exemption is already revoked");
    const updated = await tx.complianceRequirementExemption.update({
      where: { companyId_id: { companyId: context.companyId, id } },
      data: {
        revokedAt: new Date(),
        revokedByUserId: context.actorUserId,
        revocationReason: reason.trim(),
      },
    });
    await recordTenantActivity(tx, context, {
      action: "compliance_requirement.exemption_revoked",
      entityType: "compliance_requirement_exemption",
      entityId: id,
    });
    return updated;
  });
}
