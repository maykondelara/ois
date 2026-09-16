import { prisma } from "@/db/prisma";
import { tenantRoute } from "@/lib/http/api";
import { getSetupReadiness } from "@/modules/companies/setup-readiness.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  return tenantRoute(request, await params, async (context) => ({
    data: await getSetupReadiness(prisma, context),
    capabilities: {
      canManageCompany: context.permissions.has("company.manage"),
      canManageVehicles: context.permissions.has("vehicles.manage"),
      canManageCompliance: context.permissions.has("compliance.manage"),
      canConfigureInspections: context.permissions.has("inspections.configure"),
    },
  }));
}
