import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
type TenantClient = Pick<PrismaClient, "$transaction">;
const subject = z
  .object({
    requirementId: z.string().uuid(),
    subjectType: z.enum(["DRIVER", "VEHICLE"]),
    driverId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.subjectType === "DRIVER") !== Boolean(value.driverId) ||
      (value.subjectType === "VEHICLE") !== Boolean(value.vehicleId)
    )
      ctx.addIssue({ code: "custom", message: "Subject does not match assignment" });
  });
export async function assignRequirement(
  client: TenantClient,
  context: TenantContext,
  raw: unknown,
) {
  requirePermission(context, "compliance.manage");
  const input = subject.parse(raw);
  return withTenantTransaction(client, context, async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM compliance_requirements WHERE company_id=${context.companyId}::uuid AND id=${input.requirementId}::uuid FOR UPDATE`,
    );
    const requirement = await tx.complianceRequirement.findFirst({
      where: {
        companyId: context.companyId,
        id: input.requirementId,
        subjectType: input.subjectType,
        isActive: true,
        applicability: "SPECIFIC",
      },
    });
    if (!requirement)
      throw new ValidationError(
        "ASSIGNMENT_REQUIREMENT_INVALID",
        "Requirement is not an active specific requirement",
      );
    try {
      const item = await tx.complianceRequirementAssignment.create({
        data: {
          companyId: context.companyId,
          requirementId: input.requirementId,
          subjectType: input.subjectType,
          driverId: input.driverId ?? null,
          vehicleId: input.vehicleId ?? null,
          assignedByUserId: context.actorUserId,
        },
      });
      await recordTenantActivity(tx, context, {
        action: "compliance_requirement.assigned",
        entityType: "compliance_requirement_assignment",
        entityId: item.id,
      });
      return item;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new ConflictError("DUPLICATE_ACTIVE_ASSIGNMENT", "Requirement is already assigned");
      throw error;
    }
  });
}
export async function removeRequirementAssignment(
  client: TenantClient,
  context: TenantContext,
  id: string,
  reason: string,
) {
  requirePermission(context, "compliance.manage");
  if (!reason.trim())
    throw new ValidationError("REMOVAL_REASON_REQUIRED", "Removal reason is required");
  return withTenantTransaction(client, context, async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM compliance_requirement_assignments WHERE company_id=${context.companyId}::uuid AND id=${id}::uuid FOR UPDATE`,
    );
    const assignment = await tx.complianceRequirementAssignment.findUnique({
      where: { companyId_id: { companyId: context.companyId, id } },
    });
    if (!assignment) throw new TenantRecordNotFoundError("Compliance requirement assignment");
    if (assignment.removedAt)
      throw new ConflictError("ASSIGNMENT_ALREADY_REMOVED", "Assignment is already removed");
    const updated = await tx.complianceRequirementAssignment.update({
      where: { companyId_id: { companyId: context.companyId, id } },
      data: {
        removedAt: new Date(),
        removedByUserId: context.actorUserId,
        removalReason: reason.trim(),
      },
    });
    await recordTenantActivity(tx, context, {
      action: "compliance_requirement.assignment_removed",
      entityType: "compliance_requirement_assignment",
      entityId: id,
    });
    return updated;
  });
}
