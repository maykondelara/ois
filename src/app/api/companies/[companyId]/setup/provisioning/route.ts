import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import {
  pilotProvisioningCatalog,
  previewPilotProvisioning,
} from "@/modules/companies/pilot-provisioning.service";

type Params = Promise<{ companyId: string }>;

export async function GET(request: Request, { params }: { params: Params }) {
  return tenantRoute(request, await params, async (context) => {
    await previewPilotProvisioning(prisma, context, { componentIds: [] });
    return { data: pilotProvisioningCatalog() };
  });
}

export async function POST(request: Request, { params }: { params: Params }) {
  return tenantRoute(request, await params, async (context) => ({
    data: await previewPilotProvisioning(prisma, context, await readJson(request)),
  }));
}
