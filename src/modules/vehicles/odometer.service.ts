import { Prisma, type PrismaClient } from "@prisma/client";
import { withTenantTransaction, type TenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
import { defaultOperationalSettings } from "@/modules/companies/operational-settings.service";
import { OdometerConfirmationTokenService } from "@/modules/vehicles/odometer-confirmation";
import {
  decideOdometerSubmission,
  kilometresRemaining,
  type AcceptedOdometer,
} from "@/modules/vehicles/odometer-decision";
import { odometerReviewSchema, odometerSubmissionSchema } from "@/modules/vehicles/vehicle.schemas";

type TenantClient = Pick<PrismaClient, "$transaction">;
type Reading = Awaited<ReturnType<TenantTransaction["vehicleOdometerReading"]["findFirst"]>>;

async function lockVehicle(
  transaction: TenantTransaction,
  context: TenantContext,
  vehicleId: string,
) {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id::text FROM vehicles WHERE company_id = ${context.companyId}::uuid AND id = ${vehicleId}::uuid FOR UPDATE`,
  );
  if (rows.length !== 1) throw new TenantRecordNotFoundError("Vehicle");
}

async function latestAccepted(
  transaction: TenantTransaction,
  context: TenantContext,
  vehicleId: string,
) {
  return transaction.vehicleOdometerReading.findFirst({
    where: { companyId: context.companyId, vehicleId, status: "ACCEPTED" },
    orderBy: [{ acceptedAt: "desc" }, { id: "desc" }],
  });
}

async function pendingReview(
  transaction: TenantTransaction,
  context: TenantContext,
  vehicleId: string,
) {
  return transaction.vehicleOdometerReading.findFirst({
    where: { companyId: context.companyId, vehicleId, status: "REVIEW_REQUIRED" },
    select: { id: true },
  });
}

async function thresholdFor(transaction: TenantTransaction, context: TenantContext) {
  const settings = await transaction.companyOperationalSettings.findUnique({
    where: { companyId: context.companyId },
    select: { odometerExpectedIncreaseThresholdKm: true },
  });
  return (
    settings?.odometerExpectedIncreaseThresholdKm ??
    defaultOperationalSettings.odometerExpectedIncreaseThresholdKm
  );
}

function acceptedSnapshot(reading: Reading): AcceptedOdometer | null {
  return reading ? { id: reading.id, readingKm: reading.readingKm } : null;
}

function mapDatabaseOdometerConflict(error: unknown): never | void {
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : "";
  if (code === "P2002" || code === "23505")
    throw new ConflictError(
      "UNRESOLVED_ODOMETER_REVIEW",
      "Odometer review is pending for this vehicle",
    );
  if (code === "23514" && message.includes("odometer review is pending"))
    throw new ConflictError(
      "UNRESOLVED_ODOMETER_REVIEW",
      "Odometer review is pending for this vehicle",
    );
}

export type VehicleOperationalSnapshot = Readonly<{
  vehicleId: string;
  latestAcceptedReading: {
    id: string;
    readingKm: number;
    source: string;
    acceptedAt: Date | null;
    actorUserId: string;
  } | null;
  authoritativeOdometerKm: number | null;
  nextServiceOdometerKm: number | null;
  kilometresRemaining: number | null;
}>;

export async function getVehicleOperationalSnapshot(
  client: TenantClient,
  context: TenantContext,
  vehicleId: string,
): Promise<VehicleOperationalSnapshot> {
  requirePermission(context, "vehicles.read");
  return withTenantTransaction(client, context, async (transaction) => {
    const vehicle = await transaction.vehicle.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: vehicleId } },
    });
    if (!vehicle) throw new TenantRecordNotFoundError("Vehicle");
    const reading = await latestAccepted(transaction, context, vehicleId);
    return {
      vehicleId,
      latestAcceptedReading: reading
        ? {
            id: reading.id,
            readingKm: reading.readingKm,
            source: reading.source,
            acceptedAt: reading.acceptedAt,
            actorUserId: reading.actorUserId,
          }
        : null,
      authoritativeOdometerKm: reading?.readingKm ?? null,
      nextServiceOdometerKm: vehicle.nextServiceOdometerKm,
      kilometresRemaining: kilometresRemaining(
        reading?.readingKm ?? null,
        vehicle.nextServiceOdometerKm,
      ),
    };
  });
}

export type OdometerSubmissionResult =
  | Readonly<{ kind: "ACCEPTED"; readingId: string; readingKm: number }>
  | Readonly<{ kind: "REVIEW_REQUIRED"; readingId: string; readingKm: number }>
  | Readonly<{
      kind: "ANOMALY_CONFIRMATION_REQUIRED";
      confirmationToken: string;
      previousReadingId: string;
      previousOdometerKm: number;
      thresholdKm: number;
      differenceKm: number;
    }>;

async function submitOdometerReadingInTenantTransaction(
  transaction: TenantTransaction,
  context: TenantContext,
  confirmations: OdometerConfirmationTokenService,
  vehicleId: string,
  input: ReturnType<typeof odometerSubmissionSchema.parse>,
  source: "MANUAL_ENTRY" | "INSPECTION",
  sourceInspectionId?: string,
): Promise<OdometerSubmissionResult> {
  await lockVehicle(transaction, context, vehicleId);
  if (await pendingReview(transaction, context, vehicleId))
    throw new ConflictError(
      "UNRESOLVED_ODOMETER_REVIEW",
      "Resolve the pending odometer review first",
    );
  const latest = await latestAccepted(transaction, context, vehicleId);
  const thresholdKm = await thresholdFor(transaction, context);
  const decision = decideOdometerSubmission({
    proposedKm: input.readingKm,
    thresholdKm,
    latestAccepted: acceptedSnapshot(latest),
    hasPendingReview: false,
  });
  if (decision.kind === "NO_BASELINE")
    throw new ValidationError(
      "ODOMETER_BASELINE_REQUIRED",
      "Vehicle requires an initial odometer baseline",
    );
  if (decision.kind === "REGRESSION")
    throw new ValidationError(
      "ODOMETER_REGRESSION",
      "Odometer reading is below the authoritative value",
    );
  if (decision.kind === "PENDING_REVIEW")
    throw new ConflictError(
      "UNRESOLVED_ODOMETER_REVIEW",
      "Resolve the pending odometer review first",
    );
  if (decision.kind === "CONFIRMATION_REQUIRED" && !input.confirmationToken) {
    return {
      kind: "ANOMALY_CONFIRMATION_REQUIRED",
      confirmationToken: confirmations.issue({
        actorUserId: context.actorUserId,
        companyId: context.companyId,
        vehicleId,
        proposedKm: input.readingKm,
        acceptedReadingId: decision.previous.id,
        acceptedOdometerKm: decision.previous.readingKm,
        thresholdKm,
      }),
      previousReadingId: decision.previous.id,
      previousOdometerKm: decision.previous.readingKm,
      thresholdKm,
      differenceKm: decision.differenceKm,
    };
  }
  if (decision.kind === "CONFIRMATION_REQUIRED") {
    confirmations.verify(input.confirmationToken!, {
      actorUserId: context.actorUserId,
      companyId: context.companyId,
      vehicleId,
      proposedKm: input.readingKm,
      acceptedReadingId: decision.previous.id,
      acceptedOdometerKm: decision.previous.readingKm,
      thresholdKm,
    });
    const reading = await transaction.vehicleOdometerReading.create({
      data: {
        companyId: context.companyId,
        vehicleId,
        readingKm: input.readingKm,
        source,
        ...(sourceInspectionId === undefined ? {} : { sourceInspectionId }),
        status: "REVIEW_REQUIRED",
        reportedAt: new Date(),
        actorUserId: context.actorUserId,
        previousAcceptedReadingId: decision.previous.id,
        previousAcceptedOdometerKm: decision.previous.readingKm,
        thresholdKmSnapshot: thresholdKm,
        differenceKm: decision.differenceKm,
      },
    });
    await recordTenantActivity(transaction, context, {
      action: "vehicle.odometer_submitted",
      entityType: "vehicle_odometer_reading",
      entityId: reading.id,
      metadata: {
        source: reading.source,
        readingKm: reading.readingKm,
        thresholdKm,
        differenceKm: decision.differenceKm,
      },
    });
    await recordTenantActivity(transaction, context, {
      action: "vehicle.odometer_review_required",
      entityType: "vehicle_odometer_reading",
      entityId: reading.id,
      metadata: {
        previousReadingId: decision.previous.id,
        previousOdometerKm: decision.previous.readingKm,
      },
    });
    return { kind: "REVIEW_REQUIRED", readingId: reading.id, readingKm: reading.readingKm };
  }
  try {
    const reading = await transaction.vehicleOdometerReading.create({
      data: {
        companyId: context.companyId,
        vehicleId,
        readingKm: input.readingKm,
        source,
        ...(sourceInspectionId === undefined ? {} : { sourceInspectionId }),
        status: "ACCEPTED",
        reportedAt: new Date(),
        acceptedAt: new Date(),
        actorUserId: context.actorUserId,
        previousAcceptedReadingId: decision.previous.id,
        previousAcceptedOdometerKm: decision.previous.readingKm,
        thresholdKmSnapshot: thresholdKm,
        differenceKm: decision.differenceKm,
      },
    });
    await recordTenantActivity(transaction, context, {
      action: "vehicle.odometer_submitted",
      entityType: "vehicle_odometer_reading",
      entityId: reading.id,
      metadata: {
        source: reading.source,
        readingKm: reading.readingKm,
        thresholdKm,
        differenceKm: decision.differenceKm,
      },
    });
    await recordTenantActivity(transaction, context, {
      action: "vehicle.odometer_accepted",
      entityType: "vehicle_odometer_reading",
      entityId: reading.id,
      metadata: {
        previousReadingId: decision.previous.id,
        previousOdometerKm: decision.previous.readingKm,
      },
    });
    return { kind: "ACCEPTED", readingId: reading.id, readingKm: reading.readingKm };
  } catch (error) {
    mapDatabaseOdometerConflict(error);
    throw error;
  }
}

async function submitOdometerReading(
  client: TenantClient,
  context: TenantContext,
  confirmations: OdometerConfirmationTokenService,
  vehicleId: string,
  rawInput: unknown,
  source: "MANUAL_ENTRY" | "INSPECTION",
  sourceInspectionId?: string,
): Promise<OdometerSubmissionResult> {
  requirePermission(context, "vehicles.odometer.submit");
  const input = odometerSubmissionSchema.parse(rawInput);
  return withTenantTransaction(client, context, (transaction) =>
    submitOdometerReadingInTenantTransaction(
      transaction,
      context,
      confirmations,
      vehicleId,
      input,
      source,
      sourceInspectionId,
    ),
  );
}

export async function submitManualOdometerReading(
  client: TenantClient,
  context: TenantContext,
  confirmations: OdometerConfirmationTokenService,
  vehicleId: string,
  rawInput: unknown,
): Promise<OdometerSubmissionResult> {
  return submitOdometerReading(client, context, confirmations, vehicleId, rawInput, "MANUAL_ENTRY");
}

/** Inspection callers retain the accepted odometer decision/locking engine. */
export async function submitInspectionOdometerReading(
  client: TenantClient,
  context: TenantContext,
  confirmations: OdometerConfirmationTokenService,
  vehicleId: string,
  inspectionId: string,
  rawInput: unknown,
): Promise<OdometerSubmissionResult> {
  return submitOdometerReading(
    client,
    context,
    confirmations,
    vehicleId,
    rawInput,
    "INSPECTION",
    inspectionId,
  );
}

/**
 * Keeps inspection submission and its authoritative odometer mutation in one
 * tenant transaction. The public inspection service has already authorized
 * both inspection submission and odometer submission before invoking this.
 */
export async function submitInspectionOdometerReadingInTenantTransaction(
  transaction: TenantTransaction,
  context: TenantContext,
  confirmations: OdometerConfirmationTokenService,
  vehicleId: string,
  inspectionId: string,
  rawInput: unknown,
): Promise<OdometerSubmissionResult> {
  requirePermission(context, "vehicles.odometer.submit");
  return submitOdometerReadingInTenantTransaction(
    transaction,
    context,
    confirmations,
    vehicleId,
    odometerSubmissionSchema.parse(rawInput),
    "INSPECTION",
    inspectionId,
  );
}

export async function reviewOdometerReading(
  client: TenantClient,
  context: TenantContext,
  vehicleId: string,
  readingId: string,
  rawInput: unknown,
) {
  requirePermission(context, "vehicles.odometer.review");
  const input = odometerReviewSchema.parse(rawInput);
  return withTenantTransaction(client, context, async (transaction) => {
    await lockVehicle(transaction, context, vehicleId);
    const reading = await transaction.vehicleOdometerReading.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: readingId } },
    });
    if (!reading || reading.vehicleId !== vehicleId)
      throw new TenantRecordNotFoundError("Odometer reading");
    if (reading.status !== "REVIEW_REQUIRED")
      throw new ConflictError(
        "ODOMETER_ALREADY_REVIEWED",
        "Odometer reading has already been resolved",
      );
    const latest = await latestAccepted(transaction, context, vehicleId);
    if (input.decision === "ACCEPT" && (!latest || reading.readingKm < latest.readingKm))
      throw new ConflictError(
        "STALE_ODOMETER_REVIEW",
        "Odometer reading is below the current authoritative baseline",
      );
    try {
      const updated = await transaction.vehicleOdometerReading.update({
        where: { companyId_id: { companyId: context.companyId, id: readingId } },
        data:
          input.decision === "ACCEPT"
            ? {
                status: "ACCEPTED",
                acceptedAt: new Date(),
                reviewedByUserId: context.actorUserId,
                reviewedAt: new Date(),
                reviewNote: input.reviewNote,
              }
            : {
                status: "REJECTED",
                reviewedByUserId: context.actorUserId,
                reviewedAt: new Date(),
                reviewNote: input.reviewNote,
              },
      });
      await recordTenantActivity(transaction, context, {
        action: "vehicle.odometer_reviewed",
        entityType: "vehicle_odometer_reading",
        entityId: readingId,
        metadata: { decision: input.decision, reviewerUserId: context.actorUserId },
      });
      await recordTenantActivity(transaction, context, {
        action:
          input.decision === "ACCEPT" ? "vehicle.odometer_accepted" : "vehicle.odometer_rejected",
        entityType: "vehicle_odometer_reading",
        entityId: readingId,
        metadata: { readingKm: reading.readingKm },
      });
      return updated;
    } catch (error) {
      mapDatabaseOdometerConflict(error);
      throw error;
    }
  });
}
