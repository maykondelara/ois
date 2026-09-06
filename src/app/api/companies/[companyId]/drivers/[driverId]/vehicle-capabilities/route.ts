import { prisma } from "@/db/prisma";
import { capabilityDto } from "@/lib/http/dto";
import { readJson, tenantRoute } from "@/lib/http/api";
import {
  grantDriverVehicleCapability,
  listDriverVehicleCapabilities,
} from "@/modules/drivers/driver.service";
type Params = Promise<{ companyId: string; driverId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: (await listDriverVehicleCapabilities(prisma, context, value.driverId)).map(capabilityDto),
  }));
}
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: capabilityDto(
      await grantDriverVehicleCapability(prisma, context, value.driverId, await readJson(request)),
    ),
  }));
}
