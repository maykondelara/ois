import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";

type TenantClient = Pick<PrismaClient, "$transaction">;
const categoryCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{0,62}$/),
  name: z.string().trim().min(1).max(100),
});
const categoryUpdateSchema = z
  .object({ name: z.string().trim().min(1).max(100), isActive: z.boolean() })
  .partial();

export async function listVehicleCategories(
  client: TenantClient,
  context: TenantContext,
  includeInactive = false,
) {
  requirePermission(context, "vehicles.read");
  return withTenantTransaction(client, context, (transaction) =>
    transaction.vehicleCategory.findMany({
      where: { companyId: context.companyId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { code: "asc" },
    }),
  );
}

export async function createVehicleCategory(
  client: TenantClient,
  context: TenantContext,
  rawInput: unknown,
) {
  requirePermission(context, "vehicles.manage");
  const input = categoryCreateSchema.parse(rawInput);
  return withTenantTransaction(client, context, async (transaction) => {
    try {
      const category = await transaction.vehicleCategory.create({
        data: { companyId: context.companyId, ...input },
      });
      await recordTenantActivity(transaction, context, {
        action: "vehicle_category.created",
        entityType: "vehicle_category",
        entityId: category.id,
        metadata: { code: category.code, name: category.name },
      });
      return category;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new ConflictError("DUPLICATE_VEHICLE_CATEGORY", "Vehicle category already exists");
      throw error;
    }
  });
}

export async function updateVehicleCategory(
  client: TenantClient,
  context: TenantContext,
  categoryId: string,
  rawInput: unknown,
) {
  requirePermission(context, "vehicles.manage");
  const input = categoryUpdateSchema.parse(rawInput);
  return withTenantTransaction(client, context, async (transaction) => {
    const category = await transaction.vehicleCategory.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: categoryId } },
    });
    if (!category) throw new TenantRecordNotFoundError("Vehicle category");
    const updated = await transaction.vehicleCategory.update({
      where: { companyId_id: { companyId: context.companyId, id: categoryId } },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
    });
    await recordTenantActivity(transaction, context, {
      action: updated.isActive ? "vehicle_category.updated" : "vehicle_category.deactivated",
      entityType: "vehicle_category",
      entityId: categoryId,
      metadata: { code: updated.code, isActive: updated.isActive },
    });
    return updated;
  });
}
