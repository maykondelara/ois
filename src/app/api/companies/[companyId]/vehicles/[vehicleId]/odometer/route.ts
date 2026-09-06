import { prisma } from "@/db/prisma";
import { snapshotDto } from "@/lib/http/dto";
import { tenantRoute } from "@/lib/http/api";
import { getVehicleOperationalSnapshot } from "@/modules/vehicles/odometer.service";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string; vehicleId: string }> },
) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: snapshotDto(await getVehicleOperationalSnapshot(prisma, context, value.vehicleId)),
  }));
}
