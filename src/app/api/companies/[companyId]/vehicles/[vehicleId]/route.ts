import { prisma } from "@/db/prisma";
import { vehicleDetailDto, vehicleDto } from "@/lib/http/dto";
import { readJson, tenantRoute } from "@/lib/http/api";
import { getVehicle, updateVehicle } from "@/modules/vehicles/vehicle.service";
import { getVehicleOperationalSnapshot } from "@/modules/vehicles/odometer.service";
type Params = Promise<{ companyId: string; vehicleId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const vehicle = await getVehicle(prisma, context, value.vehicleId);
    const snapshot = await getVehicleOperationalSnapshot(prisma, context, value.vehicleId);
    return { data: vehicleDetailDto(vehicle, snapshot) };
  });
}
export async function PATCH(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: vehicleDto(
      await updateVehicle(prisma, context, value.vehicleId, await readJson(request)),
    ),
  }));
}
