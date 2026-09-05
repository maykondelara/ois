import type { DriverOperationalStatus, PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission, requireRecordScope } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
import {
  capabilityGrantSchema,
  driverAvailabilitySchema,
  driverCreateSchema,
  driverStatusSchema,
  driverUpdateSchema,
  driverUserLinkSchema,
} from "@/modules/drivers/driver.schemas";
import { driverRepository } from "@/modules/drivers/driver.repository";

type TenantClient = Pick<PrismaClient, "$transaction">;

async function requireDriver(
  transaction: Parameters<typeof driverRepository.findById>[0],
  context: TenantContext,
  driverId: string,
) {
  const driver = await driverRepository.findById(transaction, context, driverId);
  if (!driver) throw new TenantRecordNotFoundError("Driver");
  requireRecordScope(context, { companyId: driver.companyId, driverUserId: driver.userId });
  return driver;
}

export async function createDriver(
  client: TenantClient,
  context: TenantContext,
  rawInput: unknown,
) {
  requirePermission(context, "drivers.manage");
  const input = driverCreateSchema.parse(rawInput);
  return withTenantTransaction(client, context, async (transaction) => {
    if (
      input.userId &&
      !(await driverRepository.findActiveMembership(transaction, context, input.userId))
    )
      throw new ConflictError(
        "INVALID_DRIVER_USER_LINK",
        "Linked user requires an active company membership",
      );
    try {
      const driver = await driverRepository.create(transaction, context, {
        displayName: input.displayName,
        ...(input.phoneE164 === undefined ? {} : { phoneE164: input.phoneE164 }),
        ...(input.depotLocationId === undefined ? {} : { depotLocationId: input.depotLocationId }),
        ...(input.emergencyContactName === undefined
          ? {}
          : { emergencyContactName: input.emergencyContactName }),
        ...(input.emergencyContactPhoneE164 === undefined
          ? {}
          : { emergencyContactPhoneE164: input.emergencyContactPhoneE164 }),
        ...(input.userId === undefined ? {} : { userId: input.userId }),
      });
      await recordTenantActivity(transaction, context, {
        action: "driver.created",
        entityType: "driver",
        entityId: driver.id,
      });
      return driver;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new ConflictError("DUPLICATE_DRIVER_USER_LINK", "Driver user link already exists");
      throw error;
    }
  });
}

export async function getDriver(client: TenantClient, context: TenantContext, driverId: string) {
  requirePermission(context, "drivers.read");
  return withTenantTransaction(client, context, (transaction) =>
    requireDriver(transaction, context, driverId),
  );
}

export async function listDrivers(client: TenantClient, context: TenantContext, search?: string) {
  requirePermission(context, "drivers.read");
  return withTenantTransaction(client, context, (transaction) =>
    driverRepository.list(transaction, context, search?.trim() || undefined),
  );
}

export async function updateDriver(
  client: TenantClient,
  context: TenantContext,
  driverId: string,
  rawInput: unknown,
) {
  requirePermission(context, "drivers.manage");
  const input = driverUpdateSchema.parse(rawInput);
  return withTenantTransaction(client, context, async (transaction) => {
    const driver = await requireDriver(transaction, context, driverId);
    const updated = await driverRepository.update(transaction, context, driver.id, {
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      ...(input.phoneE164 === undefined ? {} : { phoneE164: input.phoneE164 }),
      ...(input.depotLocationId === undefined ? {} : { depotLocationId: input.depotLocationId }),
      ...(input.emergencyContactName === undefined
        ? {}
        : { emergencyContactName: input.emergencyContactName }),
      ...(input.emergencyContactPhoneE164 === undefined
        ? {}
        : { emergencyContactPhoneE164: input.emergencyContactPhoneE164 }),
    });
    await recordTenantActivity(transaction, context, {
      action: "driver.updated",
      entityType: "driver",
      entityId: updated.id,
    });
    return updated;
  });
}

export async function changeDriverOperationalStatus(
  client: TenantClient,
  context: TenantContext,
  driverId: string,
  rawInput: unknown,
) {
  requirePermission(context, "drivers.manage");
  const input = driverStatusSchema.parse(rawInput);
  return withTenantTransaction(client, context, async (transaction) => {
    const driver = await requireDriver(transaction, context, driverId);
    if (driver.operationalStatus === input.status)
      throw new ConflictError("DRIVER_STATUS_UNCHANGED", "Driver status is already set");
    const updated = await driverRepository.update(transaction, context, driver.id, {
      operationalStatus: input.status as DriverOperationalStatus,
    });
    await recordTenantActivity(transaction, context, {
      action: "driver.status_changed",
      entityType: "driver",
      entityId: driver.id,
      metadata: { fromStatus: driver.operationalStatus, toStatus: input.status },
    });
    return updated;
  });
}

/** Links are optional and must always resolve through an active same-company membership. */
export async function linkDriverToUser(
  client: TenantClient,
  context: TenantContext,
  driverId: string,
  rawInput: unknown,
) {
  requirePermission(context, "drivers.manage");
  const input = driverUserLinkSchema.parse(rawInput);
  return withTenantTransaction(client, context, async (transaction) => {
    await requireDriver(transaction, context, driverId);
    if (
      input.userId &&
      !(await driverRepository.findActiveMembership(transaction, context, input.userId))
    )
      throw new ConflictError(
        "INVALID_DRIVER_USER_LINK",
        "Linked user requires an active company membership",
      );
    try {
      const updated = await driverRepository.update(transaction, context, driverId, {
        userId: input.userId,
      });
      await recordTenantActivity(transaction, context, {
        action: "driver.updated",
        entityType: "driver",
        entityId: driverId,
        metadata: { userLinked: input.userId !== null },
      });
      return updated;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new ConflictError("DUPLICATE_DRIVER_USER_LINK", "Driver user link already exists");
      throw error;
    }
  });
}

export async function replaceDriverRegularAvailability(
  client: TenantClient,
  context: TenantContext,
  driverId: string,
  rawInput: unknown,
) {
  requirePermission(context, "drivers.manage");
  const entries = driverAvailabilitySchema.parse(rawInput);
  return withTenantTransaction(client, context, async (transaction) => {
    await requireDriver(transaction, context, driverId);
    const availability = await driverRepository.replaceAvailability(
      transaction,
      context,
      driverId,
      entries,
    );
    await recordTenantActivity(transaction, context, {
      action: "driver.availability_updated",
      entityType: "driver",
      entityId: driverId,
      metadata: {
        days: entries.map((entry) => ({
          dayOfWeek: entry.dayOfWeek,
          isAvailable: entry.isAvailable,
        })),
      },
    });
    return availability;
  });
}

export async function grantDriverVehicleCapability(
  client: TenantClient,
  context: TenantContext,
  driverId: string,
  rawInput: unknown,
) {
  requirePermission(context, "drivers.manage");
  const input = capabilityGrantSchema.parse(rawInput);
  return withTenantTransaction(client, context, async (transaction) => {
    await requireDriver(transaction, context, driverId);
    if (!(await driverRepository.findActiveCategory(transaction, context, input.vehicleCategoryId)))
      throw new ConflictError("INACTIVE_VEHICLE_CATEGORY", "Vehicle category is unavailable");
    const capability = await driverRepository.grantCapability(transaction, context, {
      driverId,
      vehicleCategoryId: input.vehicleCategoryId,
      expiresOn: input.expiresOn ?? null,
    });
    await recordTenantActivity(transaction, context, {
      action: "driver.capability_granted",
      entityType: "driver_vehicle_capability",
      entityId: capability.id,
      metadata: {
        driverId,
        vehicleCategoryId: input.vehicleCategoryId,
        expiresOn: input.expiresOn?.toISOString(),
      },
    });
    return capability;
  });
}

export async function revokeDriverVehicleCapability(
  client: TenantClient,
  context: TenantContext,
  driverId: string,
  vehicleCategoryId: string,
) {
  requirePermission(context, "drivers.manage");
  return withTenantTransaction(client, context, async (transaction) => {
    await requireDriver(transaction, context, driverId);
    const result = await driverRepository.revokeCapability(
      transaction,
      context,
      driverId,
      vehicleCategoryId,
    );
    if (result.count !== 1) throw new TenantRecordNotFoundError("Active driver vehicle capability");
    await recordTenantActivity(transaction, context, {
      action: "driver.capability_revoked",
      entityType: "driver_vehicle_capability",
      metadata: { driverId, vehicleCategoryId },
    });
  });
}
