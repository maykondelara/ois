import type { PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { requirePermission } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";

type TenantClient = Pick<PrismaClient, "$transaction">;

export async function getSetupReadiness(client: TenantClient, context: TenantContext) {
  requirePermission(context, "company.read");
  return withTenantTransaction(client, context, async (transaction) => {
    const [
      company,
      settings,
      categoryCount,
      driverCount,
      vehicleCount,
      requirementCount,
      templateCount,
    ] = await Promise.all([
      transaction.company.findUnique({
        where: { id: context.companyId },
        select: { id: true, name: true, timezone: true },
      }),
      transaction.companyOperationalSettings.findUnique({
        where: { companyId: context.companyId },
        select: { companyId: true },
      }),
      transaction.vehicleCategory.count({
        where: { companyId: context.companyId, isActive: true },
      }),
      transaction.driver.count({
        where: { companyId: context.companyId, operationalStatus: { not: "INACTIVE" } },
      }),
      transaction.vehicle.count({
        where: { companyId: context.companyId, archivedAt: null },
      }),
      transaction.complianceRequirement.count({
        where: { companyId: context.companyId, isActive: true },
      }),
      transaction.inspectionTemplate.count({
        where: {
          companyId: context.companyId,
          isActive: true,
          currentPublishedVersionId: { not: null },
        },
      }),
    ]);
    const checks = {
      companyProfile: Boolean(company?.name.trim() && company.timezone.trim()),
      operationalSettings: settings !== null,
      vehicleCategory: categoryCount > 0,
      driver: driverCount > 0,
      vehicle: vehicleCount > 0,
      complianceRequirement: requirementCount > 0,
      publishedInspection: templateCount > 0,
    };
    const required = Object.values(checks);
    return {
      state: required.every(Boolean)
        ? ("READY" as const)
        : required.filter(Boolean).length <= 1
          ? ("NOT_STARTED" as const)
          : ("IN_PROGRESS" as const),
      checks,
      facts: { categoryCount, driverCount, vehicleCount, requirementCount, templateCount },
    };
  });
}
