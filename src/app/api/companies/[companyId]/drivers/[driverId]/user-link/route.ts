import { tenantRoute, readJson } from "@/lib/http/api";
import { driverDto } from "@/lib/http/dto";
import { linkDriverToUser } from "@/modules/drivers/driver.service";
import { prisma } from "@/db/prisma";
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ companyId: string; driverId: string }> },
) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: driverDto(
      await linkDriverToUser(prisma, context, value.driverId, await readJson(request)),
    ),
  }));
}
