import type { Prisma } from "@prisma/client";
import type { TenantTransaction } from "@/db/tenant-transaction";
import type { TenantContext } from "@/modules/identity/tenant-context";

const scope = (context: TenantContext) => ({ companyId: context.companyId });

export const driverRepository = {
  findById(transaction: TenantTransaction, context: TenantContext, driverId: string) {
    return transaction.driver.findUnique({
      where: { companyId_id: { ...scope(context), id: driverId } },
    });
  },
  list(transaction: TenantTransaction, context: TenantContext, search?: string) {
    return transaction.driver.findMany({
      where: {
        ...scope(context),
        ...(search ? { displayName: { contains: search, mode: "insensitive" } } : {}),
        ...(context.role === "DRIVER" ? { userId: context.actorUserId } : {}),
      },
      orderBy: { displayName: "asc" },
    });
  },
  create(
    transaction: TenantTransaction,
    context: TenantContext,
    data: Omit<Prisma.DriverUncheckedCreateInput, "companyId">,
  ) {
    return transaction.driver.create({ data: { ...data, ...scope(context) } });
  },
  update(
    transaction: TenantTransaction,
    context: TenantContext,
    driverId: string,
    data: Prisma.DriverUncheckedUpdateInput,
  ) {
    return transaction.driver.update({
      where: { companyId_id: { ...scope(context), id: driverId } },
      data,
    });
  },
  findActiveMembership(transaction: TenantTransaction, context: TenantContext, userId: string) {
    return transaction.companyMembership.findFirst({
      where: { ...scope(context), userId, status: "ACTIVE" },
      select: { id: true },
    });
  },
  replaceAvailability(
    transaction: TenantTransaction,
    context: TenantContext,
    driverId: string,
    entries: ReadonlyArray<{ dayOfWeek: number; isAvailable: boolean }>,
  ) {
    return Promise.all(
      entries.map((entry) =>
        transaction.driverRegularAvailability.upsert({
          where: {
            companyId_driverId_dayOfWeek: {
              ...scope(context),
              driverId,
              dayOfWeek: entry.dayOfWeek,
            },
          },
          update: { isAvailable: entry.isAvailable },
          create: { ...scope(context), driverId, ...entry },
        }),
      ),
    );
  },
  findActiveCategory(transaction: TenantTransaction, context: TenantContext, categoryId: string) {
    return transaction.vehicleCategory.findFirst({
      where: { ...scope(context), id: categoryId, isActive: true },
      select: { id: true },
    });
  },
  grantCapability(
    transaction: TenantTransaction,
    context: TenantContext,
    input: { driverId: string; vehicleCategoryId: string; expiresOn: Date | null },
  ) {
    return transaction.driverVehicleCapability.upsert({
      where: {
        companyId_driverId_vehicleCategoryId: {
          ...scope(context),
          driverId: input.driverId,
          vehicleCategoryId: input.vehicleCategoryId,
        },
      },
      update: {
        isActive: true,
        expiresOn: input.expiresOn,
        authorizedAt: new Date(),
        authorizedByUserId: context.actorUserId,
      },
      create: { ...scope(context), ...input, authorizedByUserId: context.actorUserId },
    });
  },
  revokeCapability(
    transaction: TenantTransaction,
    context: TenantContext,
    driverId: string,
    vehicleCategoryId: string,
  ) {
    return transaction.driverVehicleCapability.updateMany({
      where: { ...scope(context), driverId, vehicleCategoryId, isActive: true },
      data: { isActive: false },
    });
  },
};
