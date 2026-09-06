import { tenantRoute, readJson } from "@/lib/http/api";
import { driverDto } from "@/lib/http/dto";
import { getDriver, updateDriver } from "@/modules/drivers/driver.service";
import { prisma } from "@/db/prisma";

type Params = Promise<{ companyId: string; driverId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: driverDto(await getDriver(prisma, context, value.driverId)),
  }));
}
export async function PATCH(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: driverDto(await updateDriver(prisma, context, value.driverId, await readJson(request))),
  }));
}
