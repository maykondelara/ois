import { Prisma, type PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission, requireRecordScope } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
import { LicenceCrypto } from "@/modules/drivers/licence-crypto";
import { licenceLastFour, normalizeLicenceNumber } from "@/modules/drivers/licence-normalization";
import {
  licenceCreateSchema,
  licenceRenewalSchema,
  licenceRevocationSchema,
  licenceUpdateSchema,
} from "@/modules/drivers/driver.schemas";
import { driverRepository } from "@/modules/drivers/driver.repository";
import {
  selectDriverLicence,
  type DriverLicenceSelection,
} from "@/modules/drivers/driver-licence-selector";

type TenantClient = Pick<PrismaClient, "$transaction">;

export type SafeDriverLicence = Readonly<{
  id: string;
  driverId: string;
  licenceType: string;
  issuingJurisdiction: string | null;
  licenceNumberLast4: string;
  issuedOn: Date | null;
  expiresOn: Date;
}>;

function safeLicence(licence: {
  id: string;
  driverId: string;
  licenceType: string;
  issuingJurisdiction: string | null;
  licenceNumberLast4: string;
  issuedOn: Date | null;
  expiresOn: Date;
}): SafeDriverLicence {
  return {
    id: licence.id,
    driverId: licence.driverId,
    licenceType: licence.licenceType,
    issuingJurisdiction: licence.issuingJurisdiction,
    licenceNumberLast4: licence.licenceNumberLast4,
    issuedOn: licence.issuedOn,
    expiresOn: licence.expiresOn,
  };
}

async function requireManagedDriver(
  transaction: Parameters<typeof driverRepository.findById>[0],
  context: TenantContext,
  driverId: string,
) {
  const driver = await driverRepository.findById(transaction, context, driverId);
  if (!driver) throw new TenantRecordNotFoundError("Driver");
  requireRecordScope(context, { companyId: driver.companyId, driverUserId: driver.userId });
  return driver;
}

async function lockManagedDriver(
  transaction: Parameters<typeof driverRepository.findById>[0],
  context: TenantContext,
  driverId: string,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT id FROM drivers WHERE company_id=${context.companyId}::uuid AND id=${driverId}::uuid FOR UPDATE`,
  );
  return requireManagedDriver(transaction, context, driverId);
}

function duplicateLicence(error: unknown): never | void {
  if ((error as { code?: string }).code === "P2002")
    throw new ConflictError("DUPLICATE_LICENCE", "Licence is already registered for this company");
}

const driverLicenceNumberOwnershipExclusionConstraint =
  "driver_licences_company_hash_different_driver_excl";

function isKnownDriverLicenceNumberOwnershipExclusion(error: unknown): boolean {
  const candidate = error as {
    meta?: { database_error?: unknown; target?: unknown };
    cause?: { constraint?: unknown; message?: unknown };
    message?: unknown;
  };
  if (candidate.cause?.constraint === driverLicenceNumberOwnershipExclusionConstraint) return true;

  // Prisma 6.19 may expose this PostgreSQL exclusion violation only in the
  // unknown-request representation. Inspect solely for this fixed physical
  // constraint name; no raw database detail is retained or logged.
  return [
    candidate.meta?.database_error,
    candidate.meta?.target,
    candidate.cause?.message,
    candidate.message,
  ].some((value) => {
    const text = Array.isArray(value) ? value.join(",") : value;
    return (
      typeof text === "string" && text.includes(driverLicenceNumberOwnershipExclusionConstraint)
    );
  });
}

function isConstraintViolation(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return (
    code === "P2002" ||
    code === "P2004" ||
    (error instanceof Prisma.PrismaClientUnknownRequestError &&
      isKnownDriverLicenceNumberOwnershipExclusion(error))
  );
}

function hasDirectSuccessorTarget(error: unknown): boolean {
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  return /(?:replaces|direct_successor)/.test(
    String(Array.isArray(target) ? target.join(",") : target),
  );
}

/**
 * PostgreSQL aborts the failed insert transaction. Prisma 6.19 may omit the
 * target for a partial unique index, so inspect committed tenant state only
 * after that transaction has rolled back.
 */
async function classifyRenewalUniqueViolation(
  client: TenantClient,
  context: TenantContext,
  lookupHash: Uint8Array<ArrayBuffer>,
  driverId: string,
  replacesLicenceId: string,
): Promise<"DUPLICATE_LICENCE" | "LICENCE_RENEWAL_CONFLICT" | null> {
  const result = await withTenantTransaction(client, context, async (transaction) => {
    const [duplicateLicence, directSuccessor] = await Promise.all([
      transaction.driverLicence.findFirst({
        where: {
          companyId: context.companyId,
          licenceNumberLookupHash: lookupHash,
          driverId: { not: driverId },
        },
        select: { id: true },
      }),
      transaction.driverLicence.findFirst({
        where: { companyId: context.companyId, replacesLicenceId },
        select: { id: true },
      }),
    ]);
    return { duplicateLicence, directSuccessor };
  });

  // A real number collision wins when both constraints could have fired.
  if (result.duplicateLicence) return "DUPLICATE_LICENCE";
  if (result.directSuccessor) return "LICENCE_RENEWAL_CONFLICT";
  return null;
}

async function hasOtherDriverWithNumber(
  transaction: Parameters<typeof driverRepository.findById>[0],
  context: TenantContext,
  driverId: string,
  lookupHash: Uint8Array<ArrayBuffer>,
) {
  return transaction.driverLicence.findFirst({
    where: {
      companyId: context.companyId,
      licenceNumberLookupHash: lookupHash,
      driverId: { not: driverId },
    },
    select: { id: true },
  });
}

async function mapCrossDriverNumberConstraintViolation(
  client: TenantClient,
  context: TenantContext,
  driverId: string,
  lookupHash: Uint8Array<ArrayBuffer>,
) {
  const conflicting = await withTenantTransaction(client, context, (transaction) =>
    hasOtherDriverWithNumber(transaction, context, driverId, lookupHash),
  );
  if (conflicting)
    throw new ConflictError("DUPLICATE_LICENCE", "Licence is already registered for this company");
}

export async function addDriverLicence(
  client: TenantClient,
  context: TenantContext,
  crypto: LicenceCrypto,
  driverId: string,
  rawInput: unknown,
): Promise<SafeDriverLicence> {
  requirePermission(context, "drivers.manage");
  const input = licenceCreateSchema.parse(rawInput);
  const normalized = normalizeLicenceNumber(input.licenceNumber);
  const lookupHash = Uint8Array.from(crypto.lookupHash(context.companyId, normalized));
  try {
    return await withTenantTransaction(client, context, async (transaction) => {
      // Serializes normal same-driver creates; the exclusion constraint guards other drivers.
      await lockManagedDriver(transaction, context, driverId);
      const existing = await transaction.driverLicence.findFirst({
        where: { companyId: context.companyId, licenceNumberLookupHash: lookupHash },
        select: { id: true },
      });
      if (existing)
        throw new ConflictError(
          "DUPLICATE_LICENCE",
          "Licence is already registered for this company",
        );
      const encrypted = crypto.encrypt(context.companyId, driverId, normalized);
      const licence = await transaction.driverLicence.create({
        data: {
          companyId: context.companyId,
          driverId,
          licenceType: input.licenceType,
          ...(input.issuingJurisdiction === undefined
            ? {}
            : { issuingJurisdiction: input.issuingJurisdiction }),
          licenceNumberCiphertext: encrypted.ciphertext,
          licenceNumberLookupHash: lookupHash,
          licenceNumberLast4: licenceLastFour(normalized),
          licenceNumberKeyVersion: encrypted.keyVersion,
          ...(input.issuedOn === undefined ? {} : { issuedOn: input.issuedOn }),
          expiresOn: input.expiresOn,
        },
      });
      await recordTenantActivity(transaction, context, {
        action: "driver.licence_added",
        entityType: "driver_licence",
        entityId: licence.id,
        metadata: {
          driverId,
          licenceType: licence.licenceType,
          expiresOn: licence.expiresOn.toISOString(),
          keyVersion: encrypted.keyVersion,
        },
      });
      return safeLicence(licence);
    });
  } catch (error) {
    if (!isConstraintViolation(error)) throw error;
    await mapCrossDriverNumberConstraintViolation(client, context, driverId, lookupHash);
    duplicateLicence(error);
    throw error;
  }
}

/** Read-only, redacted licence access for Driver detail/API use. */
export async function listDriverLicences(
  client: TenantClient,
  context: TenantContext,
  driverId: string,
): Promise<SafeDriverLicence[]> {
  requirePermission(context, "drivers.read");
  return withTenantTransaction(client, context, async (transaction) => {
    await requireManagedDriver(transaction, context, driverId);
    const licences = await transaction.driverLicence.findMany({
      where: { companyId: context.companyId, driverId },
      orderBy: [{ expiresOn: "asc" }, { id: "asc" }],
    });
    return licences.map(safeLicence);
  });
}

export async function updateDriverLicence(
  client: TenantClient,
  context: TenantContext,
  crypto: LicenceCrypto,
  driverId: string,
  licenceId: string,
  rawInput: unknown,
): Promise<SafeDriverLicence> {
  requirePermission(context, "drivers.manage");
  const input = licenceUpdateSchema.parse(rawInput);
  if (Object.keys(input).length === 0)
    throw new ValidationError("EMPTY_LICENCE_UPDATE", "Licence update requires at least one field");
  const normalized =
    input.licenceNumber === undefined ? null : normalizeLicenceNumber(input.licenceNumber);
  const lookupHash = normalized
    ? Uint8Array.from(crypto.lookupHash(context.companyId, normalized))
    : null;
  try {
    return await withTenantTransaction(client, context, async (transaction) => {
      await lockManagedDriver(transaction, context, driverId);
      const existing = await transaction.driverLicence.findUnique({
        where: { companyId_id: { companyId: context.companyId, id: licenceId } },
      });
      if (!existing || existing.driverId !== driverId)
        throw new TenantRecordNotFoundError("Driver licence");
      if (lookupHash) {
        const duplicate = await transaction.driverLicence.findFirst({
          where: {
            companyId: context.companyId,
            licenceNumberLookupHash: lookupHash,
            id: { not: licenceId },
          },
          select: { id: true },
        });
        if (duplicate && duplicate.id !== licenceId)
          throw new ConflictError(
            "DUPLICATE_LICENCE",
            "Licence is already registered for this company",
          );
      }
      const encrypted = normalized ? crypto.encrypt(context.companyId, driverId, normalized) : null;
      try {
        const licence = await transaction.driverLicence.update({
          where: { companyId_id: { companyId: context.companyId, id: licenceId } },
          data: {
            ...(input.licenceType === undefined ? {} : { licenceType: input.licenceType }),
            ...(input.issuingJurisdiction === undefined
              ? {}
              : { issuingJurisdiction: input.issuingJurisdiction }),
            ...(input.issuedOn === undefined ? {} : { issuedOn: input.issuedOn }),
            ...(input.expiresOn === undefined ? {} : { expiresOn: input.expiresOn }),
            ...(encrypted
              ? {
                  licenceNumberCiphertext: encrypted.ciphertext,
                  licenceNumberLookupHash: lookupHash!,
                  licenceNumberLast4: licenceLastFour(normalized!),
                  licenceNumberKeyVersion: encrypted.keyVersion,
                }
              : {}),
          },
        });
        await recordTenantActivity(transaction, context, {
          action: "driver.licence_updated",
          entityType: "driver_licence",
          entityId: licence.id,
          metadata: {
            driverId,
            licenceType: licence.licenceType,
            expiresOn: licence.expiresOn.toISOString(),
            keyVersion: licence.licenceNumberKeyVersion,
          },
        });
        return safeLicence(licence);
      } catch (error) {
        duplicateLicence(error);
        throw error;
      }
    });
  } catch (error) {
    if (!isConstraintViolation(error) || !lookupHash) throw error;
    await mapCrossDriverNumberConstraintViolation(client, context, driverId, lookupHash);
    duplicateLicence(error);
    throw error;
  }
}

/** Creates an immutable successor; attachments deliberately remain on the historical row. */
export async function renewDriverLicence(
  client: TenantClient,
  context: TenantContext,
  crypto: LicenceCrypto,
  driverId: string,
  replacesLicenceId: string,
  rawInput: unknown,
): Promise<SafeDriverLicence> {
  requirePermission(context, "drivers.manage");
  const input = licenceRenewalSchema.parse(rawInput);
  const normalized = normalizeLicenceNumber(input.licenceNumber);
  const lookupHash = Uint8Array.from(crypto.lookupHash(context.companyId, normalized));
  try {
    return await withTenantTransaction(client, context, async (transaction) => {
      await lockManagedDriver(transaction, context, driverId);
      await transaction.$queryRaw(
        Prisma.sql`SELECT id FROM driver_licences WHERE company_id=${context.companyId}::uuid AND id=${replacesLicenceId}::uuid FOR UPDATE`,
      );
      const predecessor = await transaction.driverLicence.findUnique({
        where: { companyId_id: { companyId: context.companyId, id: replacesLicenceId } },
      });
      if (!predecessor || predecessor.driverId !== driverId)
        throw new TenantRecordNotFoundError("Driver licence");
      if (predecessor.validFrom && input.validFrom <= predecessor.validFrom)
        throw new ValidationError(
          "LICENCE_SUCCESSOR_DATE_INVALID",
          "A successor must begin after its predecessor",
        );
      const duplicate = await hasOtherDriverWithNumber(transaction, context, driverId, lookupHash);
      if (duplicate)
        throw new ConflictError(
          "DUPLICATE_LICENCE",
          "Licence is already registered for this company",
        );
      const encrypted = crypto.encrypt(context.companyId, driverId, normalized);
      const licence = await transaction.driverLicence.create({
        data: {
          companyId: context.companyId,
          driverId,
          licenceType: input.licenceType,
          issuingJurisdiction: input.issuingJurisdiction ?? null,
          licenceNumberCiphertext: encrypted.ciphertext,
          licenceNumberLookupHash: lookupHash,
          licenceNumberLast4: licenceLastFour(normalized),
          licenceNumberKeyVersion: encrypted.keyVersion,
          issuedOn: input.issuedOn ?? null,
          expiresOn: input.expiresOn,
          licenceClass: input.licenceClass,
          validFrom: input.validFrom,
          replacesLicenceId: predecessor.id,
        },
      });
      await recordTenantActivity(transaction, context, {
        action: "driver.licence_renewed",
        entityType: "driver_licence",
        entityId: licence.id,
        metadata: {
          driverId,
          replacesLicenceId: predecessor.id,
          expiresOn: licence.expiresOn.toISOString(),
        },
      });
      return safeLicence(licence);
    });
  } catch (error) {
    if (!isConstraintViolation(error)) throw error;
    if (hasDirectSuccessorTarget(error))
      throw new ConflictError("LICENCE_RENEWAL_CONFLICT", "Licence already has a successor");
    const classification = await classifyRenewalUniqueViolation(
      client,
      context,
      lookupHash,
      driverId,
      replacesLicenceId,
    );
    if (classification === "LICENCE_RENEWAL_CONFLICT")
      throw new ConflictError("LICENCE_RENEWAL_CONFLICT", "Licence already has a successor");
    if (classification === "DUPLICATE_LICENCE")
      throw new ConflictError(
        "DUPLICATE_LICENCE",
        "Licence is already registered for this company",
      );
    duplicateLicence(error);
    throw error;
  }
}

export async function revokeDriverLicence(
  client: TenantClient,
  context: TenantContext,
  driverId: string,
  licenceId: string,
  rawInput: unknown,
) {
  requirePermission(context, "drivers.manage");
  const { reason } = licenceRevocationSchema.parse(rawInput);
  return withTenantTransaction(client, context, async (transaction) => {
    await requireManagedDriver(transaction, context, driverId);
    await transaction.$queryRaw(
      Prisma.sql`SELECT id FROM driver_licences WHERE company_id=${context.companyId}::uuid AND id=${licenceId}::uuid FOR UPDATE`,
    );
    const licence = await transaction.driverLicence.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: licenceId } },
    });
    if (!licence || licence.driverId !== driverId)
      throw new TenantRecordNotFoundError("Driver licence");
    if (licence.revokedAt)
      throw new ConflictError("LICENCE_ALREADY_REVOKED", "Licence is already revoked");
    const revoked = await transaction.driverLicence.update({
      where: { companyId_id: { companyId: context.companyId, id: licenceId } },
      data: {
        revokedAt: new Date(),
        revokedByUserId: context.actorUserId,
        revocationReason: reason,
      },
    });
    await recordTenantActivity(transaction, context, {
      action: "driver.licence_revoked",
      entityType: "driver_licence",
      entityId: licenceId,
      metadata: { driverId },
    });
    return safeLicence(revoked);
  });
}

/** Database-backed selection retains the conservative legacy ambiguity semantics. */
export async function selectDriverLicenceForEvaluation(
  client: TenantClient,
  context: TenantContext,
  driverId: string,
  evaluationDate: Date,
): Promise<DriverLicenceSelection> {
  requirePermission(context, "compliance.read");
  return withTenantTransaction(client, context, async (transaction) => {
    await requireManagedDriver(transaction, context, driverId);
    const licences = await transaction.driverLicence.findMany({
      where: { companyId: context.companyId, driverId },
      orderBy: [{ validFrom: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    return selectDriverLicence(licences, evaluationDate);
  });
}
