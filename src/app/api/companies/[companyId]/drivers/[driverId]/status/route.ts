import { tenantRoute, readJson } from "@/lib/http/api";
import { driverDto } from "@/lib/http/dto";
import { changeDriverOperationalStatus } from "@/modules/drivers/driver.service";
import { prisma } from "@/db/prisma";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string; driverId: string }> },
) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: driverDto(
      await changeDriverOperationalStatus(prisma, context, value.driverId, await readJson(request)),
    ),
  }));
}
