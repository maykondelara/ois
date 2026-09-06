import { prisma } from "@/db/prisma";
import { vehicleDto } from "@/lib/http/dto";
import { readJson, tenantRoute } from "@/lib/http/api";
import { changeManualVehicleStatus } from "@/modules/vehicles/vehicle.service";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string; vehicleId: string }> },
) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: vehicleDto(
      await changeManualVehicleStatus(prisma, context, value.vehicleId, await readJson(request)),
    ),
  }));
}
