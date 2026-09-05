import type { InspectionVehicleSelectionStrategy, PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";
import { defaultVehicleCategories } from "@/modules/vehicles/registration";
import { z } from "zod";

type TenantClient = Pick<PrismaClient, "$transaction">;

const settingsUpdateSchema = z.object({
  odometerExpectedIncreaseThresholdKm: z.number().int().positive().optional(),
  inspectionVehicleSelectionStrategy: z.enum(["SEARCH_SELECT", "MANUAL_REGO", "BOTH"]).optional(),
});

export const defaultOperationalSettings = {
  odometerExpectedIncreaseThresholdKm: 1000,
  inspectionVehicleSelectionStrategy: "BOTH" as InspectionVehicleSelectionStrategy,
};

/** Idempotent tenant repair/provisioning seam; never overwrites custom or inactive category records. */
export async function initializeOperationalDefaults(client: TenantClient, context: TenantContext) {
  requirePermission(context, "company.manage");
  return withTenantTransaction(client, context, async (transaction) => {
    const settings = await transaction.companyOperationalSettings.upsert({
      where: { companyId: context.companyId },
      update: {},
      create: { companyId: context.companyId },
    });
    await Promise.all(
      defaultVehicleCategories.map((code) =>
        transaction.vehicleCategory.upsert({
          where: { companyId_code: { companyId: context.companyId, code } },
          update: {},
          create: { companyId: context.companyId, code, name: code },
        }),
      ),
    );
    return settings;
  });
}

export async function getOperationalSettings(client: TenantClient, context: TenantContext) {
  requirePermission(context, "company.read");
  return withTenantTransaction(client, context, async (transaction) => {
    const settings = await transaction.companyOperationalSettings.findUnique({
      where: { companyId: context.companyId },
    });
    return settings ?? { companyId: context.companyId, ...defaultOperationalSettings };
  });
}

export async function updateOperationalSettings(
  client: TenantClient,
  context: TenantContext,
  rawInput: unknown,
) {
  requirePermission(context, "company.manage");
  const input = settingsUpdateSchema.parse(rawInput);
  return withTenantTransaction(client, context, async (transaction) => {
    const previous = await transaction.companyOperationalSettings.findUnique({
      where: { companyId: context.companyId },
    });
    const settings = await transaction.companyOperationalSettings.upsert({
      where: { companyId: context.companyId },
      update: {
        ...(input.odometerExpectedIncreaseThresholdKm === undefined
          ? {}
          : { odometerExpectedIncreaseThresholdKm: input.odometerExpectedIncreaseThresholdKm }),
        ...(input.inspectionVehicleSelectionStrategy === undefined
          ? {}
          : { inspectionVehicleSelectionStrategy: input.inspectionVehicleSelectionStrategy }),
      },
      create: {
        companyId: context.companyId,
        odometerExpectedIncreaseThresholdKm:
          input.odometerExpectedIncreaseThresholdKm ??
          defaultOperationalSettings.odometerExpectedIncreaseThresholdKm,
        inspectionVehicleSelectionStrategy:
          input.inspectionVehicleSelectionStrategy ??
          defaultOperationalSettings.inspectionVehicleSelectionStrategy,
      },
    });
    await recordTenantActivity(transaction, context, {
      action: "company.operational_settings_updated",
      entityType: "company_operational_settings",
      entityId: context.companyId,
      metadata: {
        previousThresholdKm: previous?.odometerExpectedIncreaseThresholdKm ?? null,
        thresholdKm: settings.odometerExpectedIncreaseThresholdKm,
        previousSelectionStrategy: previous?.inspectionVehicleSelectionStrategy ?? null,
        selectionStrategy: settings.inspectionVehicleSelectionStrategy,
      },
    });
    return settings;
  });
}
