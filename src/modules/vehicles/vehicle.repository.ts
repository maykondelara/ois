import type { Prisma } from "@prisma/client";
import type { TenantTransaction } from "@/db/tenant-transaction";
import type { TenantContext } from "@/modules/identity/tenant-context";

export const vehicleRepository = {
  findById(transaction: TenantTransaction, context: TenantContext, vehicleId: string) {
    return transaction.vehicle.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: vehicleId } },
    });
  },
  list(transaction: TenantTransaction, context: TenantContext, search?: string) {
    return transaction.vehicle.findMany({
      where: {
        companyId: context.companyId,
        ...(search
          ? {
              OR: [
                { registrationDisplay: { contains: search, mode: "insensitive" } },
                { registrationNormalized: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { registrationNormalized: "asc" },
    });
  },
  findActiveCategory(transaction: TenantTransaction, context: TenantContext, categoryId: string) {
    return transaction.vehicleCategory.findFirst({
      where: { companyId: context.companyId, id: categoryId, isActive: true },
      select: { id: true },
    });
  },
  create(
    transaction: TenantTransaction,
    context: TenantContext,
    data: Omit<Prisma.VehicleUncheckedCreateInput, "companyId">,
  ) {
    return transaction.vehicle.create({ data: { ...data, companyId: context.companyId } });
  },
};
