import { prisma } from "@/db/prisma";
import { settingsDto } from "@/lib/http/dto";
import { readJson, tenantRoute } from "@/lib/http/api";
import {
  getOperationalSettings,
  updateOperationalSettings,
} from "@/modules/companies/operational-settings.service";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  return tenantRoute(request, await params, async (context) => ({
    data: settingsDto(await getOperationalSettings(prisma, context)),
  }));
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  return tenantRoute(request, await params, async (context) => ({
    data: settingsDto(await updateOperationalSettings(prisma, context, await readJson(request))),
  }));
}
