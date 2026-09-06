import type { PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { ConflictError, TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission, requireRecordScope } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
import { LicenceCrypto } from "@/modules/drivers/licence-crypto";
import { licenceLastFour, normalizeLicenceNumber } from "@/modules/drivers/licence-normalization";
import { licenceCreateSchema, licenceUpdateSchema } from "@/modules/drivers/driver.schemas";
import { driverRepository } from "@/modules/drivers/driver.repository";

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

function duplicateLicence(error: unknown): never | void {
  if ((error as { code?: string }).code === "P2002")
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
  return withTenantTransaction(client, context, async (transaction) => {
    await requireManagedDriver(transaction, context, driverId);
    const lookupHash = Uint8Array.from(crypto.lookupHash(context.companyId, normalized));
    const existing = await transaction.driverLicence.findUnique({
      where: {
        companyId_licenceNumberLookupHash: {
          companyId: context.companyId,
          licenceNumberLookupHash: lookupHash,
        },
      },
      select: { id: true },
    });
    if (existing)
      throw new ConflictError(
        "DUPLICATE_LICENCE",
        "Licence is already registered for this company",
      );
    const encrypted = crypto.encrypt(context.companyId, driverId, normalized);
    try {
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
    } catch (error) {
      duplicateLicence(error);
      throw error;
    }
  });
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
  return withTenantTransaction(client, context, async (transaction) => {
    await requireManagedDriver(transaction, context, driverId);
    const existing = await transaction.driverLicence.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: licenceId } },
    });
    if (!existing || existing.driverId !== driverId)
      throw new TenantRecordNotFoundError("Driver licence");
    const normalized =
      input.licenceNumber === undefined ? null : normalizeLicenceNumber(input.licenceNumber);
    const lookupHash = normalized
      ? Uint8Array.from(crypto.lookupHash(context.companyId, normalized))
      : null;
    if (lookupHash) {
      const duplicate = await transaction.driverLicence.findUnique({
        where: {
          companyId_licenceNumberLookupHash: {
            companyId: context.companyId,
            licenceNumberLookupHash: lookupHash,
          },
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
}
