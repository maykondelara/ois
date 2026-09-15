import { Prisma, type PrismaClient, type VehicleOperationalStatus } from "@prisma/client";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
import { normalizeRegistration } from "@/modules/vehicles/registration";
import { validateManualVehicleStatusTransition } from "@/modules/vehicles/vehicle-status";
import {
  nextServiceSchema,
  vehicleCreateSchema,
  vehicleStatusSchema,
  vehicleUpdateSchema,
} from "@/modules/vehicles/vehicle.schemas";
import { vehicleRepository } from "@/modules/vehicles/vehicle.repository";

type TenantClient = Pick<PrismaClient, "$transaction">;

export type VehicleListPageInput = Readonly<{
  page: number;
  pageSize: number;
  q?: string;
  status?: "ACTIVE" | "INACTIVE" | "OUT_OF_SERVICE";
  vehicleCategoryId?: string;
}>;

function duplicateRegistration(error: unknown): never | void {
  if ((error as { code?: string }).code === "P2002")
    throw new ConflictError("DUPLICATE_REGISTRATION", "Vehicle registration already exists");
}

async function requireVehicle(
  transaction: Parameters<typeof vehicleRepository.findById>[0],
  context: TenantContext,
  vehicleId: string,
) {
  const vehicle = await vehicleRepository.findById(transaction, context, vehicleId);
  if (!vehicle) throw new TenantRecordNotFoundError("Vehicle");
  return vehicle;
}

async function requireActiveCategory(
  transaction: Parameters<typeof vehicleRepository.findActiveCategory>[0],
  context: TenantContext,
  categoryId: string,
) {
  if (!(await vehicleRepository.findActiveCategory(transaction, context, categoryId)))
    throw new ConflictError("INACTIVE_VEHICLE_CATEGORY", "Vehicle category is unavailable");
}

export async function createVehicle(
  client: TenantClient,
  context: TenantContext,
  rawInput: unknown,
) {
  requirePermission(context, "vehicles.manage");
  const input = vehicleCreateSchema.parse(rawInput);
  const registration = normalizeRegistration(input.registration);
  if (input.operationalStatus === "OUT_OF_SERVICE" && !input.statusReason)
    throw new ValidationError(
      "MISSING_OUT_OF_SERVICE_REASON",
      "A status-transition reason is required",
    );
  return withTenantTransaction(client, context, async (transaction) => {
    await requireActiveCategory(transaction, context, input.vehicleCategoryId);
    try {
      const vehicle = await vehicleRepository.create(transaction, context, {
        registrationDisplay: registration.display,
        registrationNormalized: registration.normalized,
        vehicleCategoryId: input.vehicleCategoryId,
        operationalStatus: input.operationalStatus,
        ...(input.depotLocationId === undefined ? {} : { depotLocationId: input.depotLocationId }),
        ...(input.registrationExpiresOn === undefined
          ? {}
          : { registrationExpiresOn: input.registrationExpiresOn }),
        ...(input.nextServiceOdometerKm === undefined
          ? {}
          : { nextServiceOdometerKm: input.nextServiceOdometerKm }),
      });
      await transaction.vehicleStatusHistory.create({
        data: {
          companyId: context.companyId,
          vehicleId: vehicle.id,
          fromStatus: null,
          toStatus: vehicle.operationalStatus,
          ...(input.statusReason === undefined ? {} : { reason: input.statusReason }),
          source: "MANUAL",
          actorUserId: context.actorUserId,
        },
      });
      if (input.initialOdometerKm !== undefined) {
        const reading = await transaction.vehicleOdometerReading.create({
          data: {
            companyId: context.companyId,
            vehicleId: vehicle.id,
            readingKm: input.initialOdometerKm,
            source: "INITIAL_ENTRY",
            status: "ACCEPTED",
            reportedAt: new Date(),
            acceptedAt: new Date(),
            actorUserId: context.actorUserId,
          },
        });
        await recordTenantActivity(transaction, context, {
          action: "vehicle.odometer_accepted",
          entityType: "vehicle_odometer_reading",
          entityId: reading.id,
          metadata: { source: "INITIAL_ENTRY", readingKm: reading.readingKm },
        });
      }
      await recordTenantActivity(transaction, context, {
        action: "vehicle.created",
        entityType: "vehicle",
        entityId: vehicle.id,
        metadata: {
          operationalStatus: vehicle.operationalStatus,
          vehicleCategoryId: vehicle.vehicleCategoryId,
        },
      });
      return vehicle;
    } catch (error) {
      duplicateRegistration(error);
      throw error;
    }
  });
}

export async function getVehicle(client: TenantClient, context: TenantContext, vehicleId: string) {
  requirePermission(context, "vehicles.read");
  return withTenantTransaction(client, context, (transaction) =>
    requireVehicle(transaction, context, vehicleId),
  );
}

export async function listVehicles(client: TenantClient, context: TenantContext, search?: string) {
  requirePermission(context, "vehicles.read");
  return withTenantTransaction(client, context, (transaction) =>
    vehicleRepository.list(transaction, context, search?.trim() || undefined),
  );
}

/** Bounded list path for HTTP/API consumers; derives next-page state without COUNT(*). */
export async function listVehiclesPage(
  client: TenantClient,
  context: TenantContext,
  input: VehicleListPageInput,
) {
  requirePermission(context, "vehicles.read");
  return withTenantTransaction(client, context, async (transaction) => {
    const rows = await vehicleRepository.listPage(transaction, context, {
      page: input.page,
      pageSize: input.pageSize,
      ...(input.q?.trim() ? { search: input.q.trim() } : {}),
      ...(input.status ? { operationalStatus: input.status } : {}),
      ...(input.vehicleCategoryId ? { vehicleCategoryId: input.vehicleCategoryId } : {}),
    });
    return { data: rows.slice(0, input.pageSize), hasNextPage: rows.length > input.pageSize };
  });
}

export async function resolveVehicleRegistration(
  client: TenantClient,
  context: TenantContext,
  registrationInput: string,
) {
  requirePermission(context, "vehicles.read");
  const registration = normalizeRegistration(registrationInput);
  return withTenantTransaction(client, context, (transaction) =>
    transaction.vehicle.findUnique({
      where: {
        companyId_registrationNormalized: {
          companyId: context.companyId,
          registrationNormalized: registration.normalized,
        },
      },
    }),
  );
}

export async function updateVehicle(
  client: TenantClient,
  context: TenantContext,
  vehicleId: string,
  rawInput: unknown,
) {
  requirePermission(context, "vehicles.manage");
  const input = vehicleUpdateSchema.parse(rawInput);
  return withTenantTransaction(client, context, async (transaction) => {
    await requireVehicle(transaction, context, vehicleId);
    if (input.vehicleCategoryId)
      await requireActiveCategory(transaction, context, input.vehicleCategoryId);
    const registration = input.registration ? normalizeRegistration(input.registration) : null;
    try {
      const vehicle = await transaction.vehicle.update({
        where: { companyId_id: { companyId: context.companyId, id: vehicleId } },
        data: {
          ...(registration
            ? {
                registrationDisplay: registration.display,
                registrationNormalized: registration.normalized,
              }
            : {}),
          ...(input.vehicleCategoryId === undefined
            ? {}
            : { vehicleCategoryId: input.vehicleCategoryId }),
          ...(input.depotLocationId === undefined
            ? {}
            : { depotLocationId: input.depotLocationId }),
          ...(input.registrationExpiresOn === undefined
            ? {}
            : { registrationExpiresOn: input.registrationExpiresOn }),
        },
      });
      await recordTenantActivity(transaction, context, {
        action: "vehicle.updated",
        entityType: "vehicle",
        entityId: vehicle.id,
      });
      return vehicle;
    } catch (error) {
      duplicateRegistration(error);
      throw error;
    }
  });
}

export async function changeManualVehicleStatus(
  client: TenantClient,
  context: TenantContext,
  vehicleId: string,
  rawInput: unknown,
) {
  requirePermission(context, "vehicles.manage");
  const input = vehicleStatusSchema.parse(rawInput);
  return withTenantTransaction(client, context, async (transaction) => {
    const locked = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id::text FROM vehicles WHERE company_id = ${context.companyId}::uuid AND id = ${vehicleId}::uuid FOR UPDATE`,
    );
    if (locked.length !== 1) throw new TenantRecordNotFoundError("Vehicle");
    const vehicle = await requireVehicle(transaction, context, vehicleId);
    if (
      vehicle.operationalStatus === "OUT_OF_SERVICE" &&
      input.status === "ACTIVE" &&
      (await transaction.vehicleDefectHold.count({
        where: { companyId: context.companyId, vehicleId, releasedAt: null },
      })) > 0
    )
      throw new ConflictError(
        "VEHICLE_DEFECT_RELEASE_REQUIRED",
        "Vehicle with an active defect hold must use the authorized release operation",
      );
    validateManualVehicleStatusTransition(vehicle.operationalStatus, input.status, input.reason);
    const updated = await transaction.vehicle.update({
      where: { companyId_id: { companyId: context.companyId, id: vehicleId } },
      data: { operationalStatus: input.status as VehicleOperationalStatus },
    });
    const history = await transaction.vehicleStatusHistory.create({
      data: {
        companyId: context.companyId,
        vehicleId,
        fromStatus: vehicle.operationalStatus,
        toStatus: input.status,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        source: "MANUAL",
        actorUserId: context.actorUserId,
      },
    });
    await recordTenantActivity(transaction, context, {
      action: "vehicle.status_changed",
      entityType: "vehicle",
      entityId: updated.id,
      metadata: {
        fromStatus: vehicle.operationalStatus,
        toStatus: input.status,
        historyId: history.id,
      },
    });
    return updated;
  });
}

export async function updateNextServiceOdometer(
  client: TenantClient,
  context: TenantContext,
  vehicleId: string,
  rawInput: unknown,
) {
  requirePermission(context, "vehicles.manage");
  const input = nextServiceSchema.parse(rawInput);
  return withTenantTransaction(client, context, async (transaction) => {
    const vehicle = await requireVehicle(transaction, context, vehicleId);
    const updated = await transaction.vehicle.update({
      where: { companyId_id: { companyId: context.companyId, id: vehicleId } },
      data: { nextServiceOdometerKm: input.nextServiceOdometerKm ?? null },
    });
    await recordTenantActivity(transaction, context, {
      action: "vehicle.next_service_updated",
      entityType: "vehicle",
      entityId: vehicleId,
      metadata: {
        previousKm: vehicle.nextServiceOdometerKm,
        nextKm: updated.nextServiceOdometerKm,
      },
    });
    return updated;
  });
}
