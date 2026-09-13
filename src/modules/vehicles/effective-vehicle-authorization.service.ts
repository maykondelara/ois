import type { PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { TenantRecordNotFoundError } from "@/lib/errors";
import {
  effectiveVehicleAuthorization,
  legalLicenceEntitlement,
} from "@/modules/compliance/compliance-domain";
import { selectDriverLicence } from "@/modules/drivers/driver-licence-selector";
import { requirePermission, requireRecordScope } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";

type TenantClient = Pick<PrismaClient, "$transaction">;

/** Legal entitlement is intentionally calculated only from explicit category metadata. */
export async function getEffectiveVehicleAuthorization(
  client: TenantClient,
  context: TenantContext,
  driverId: string,
  vehicleId: string,
  evaluationDate: Date,
) {
  requirePermission(context, "vehicles.read");
  return withTenantTransaction(client, context, async (transaction) => {
    const [driver, vehicle] = await Promise.all([
      transaction.driver.findUnique({
        where: { companyId_id: { companyId: context.companyId, id: driverId } },
      }),
      transaction.vehicle.findUnique({
        where: { companyId_id: { companyId: context.companyId, id: vehicleId } },
      }),
    ]);
    if (!driver) throw new TenantRecordNotFoundError("Driver");
    if (!vehicle) throw new TenantRecordNotFoundError("Vehicle");
    requireRecordScope(context, { companyId: driver.companyId, driverUserId: driver.userId });
    const category = await transaction.vehicleCategory.findUnique({
      where: { companyId_id: { companyId: context.companyId, id: vehicle.vehicleCategoryId } },
    });
    if (!category) throw new TenantRecordNotFoundError("Vehicle category");
    const [licences, capability] = await Promise.all([
      transaction.driverLicence.findMany({ where: { companyId: context.companyId, driverId } }),
      transaction.driverVehicleCapability.findFirst({
        where: {
          companyId: context.companyId,
          driverId,
          vehicleCategoryId: category.id,
          isActive: true,
          OR: [{ expiresOn: null }, { expiresOn: { gte: evaluationDate } }],
        },
      }),
    ]);
    const selection = selectDriverLicence(licences, evaluationDate);
    const legal = legalLicenceEntitlement(
      selection.kind === "RESOLVED" ? selection.licence.licenceClass : null,
      category.requiredLicenceClass,
    );
    return {
      legalEntitlement: legal,
      companyAuthorizationActive: Boolean(capability),
      authorization: effectiveVehicleAuthorization(legal, Boolean(capability)),
    };
  });
}
