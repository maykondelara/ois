import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { applyPilotProvisioning } from "@/modules/companies/pilot-provisioning.service";
import { getSetupReadiness } from "@/modules/companies/setup-readiness.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  return tenantRoute(request, await params, async (context) => ({
    data: {
      outcomes: await applyPilotProvisioning(prisma, context, await readJson(request)),
      readiness: await getSetupReadiness(prisma, context),
    },
  }));
}
