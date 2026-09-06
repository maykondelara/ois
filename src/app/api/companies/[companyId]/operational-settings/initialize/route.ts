import { prisma } from "@/db/prisma";
import { settingsDto } from "@/lib/http/dto";
import { tenantRoute } from "@/lib/http/api";
import { initializeOperationalDefaults } from "@/modules/companies/operational-settings.service";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  return tenantRoute(request, await params, async (context) => ({
    data: settingsDto(await initializeOperationalDefaults(prisma, context)),
  }));
}
