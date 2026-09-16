import { prisma } from "@/db/prisma";
import { tenantRoute } from "@/lib/http/api";
import { vehicleStatusHistoryDto } from "@/lib/http/dto";
import { listVehicleStatusHistory } from "@/modules/vehicles/vehicle.service";

type Params = Promise<{ companyId: string; vehicleId: string }>;

export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: (await listVehicleStatusHistory(prisma, context, value.vehicleId)).map(
      vehicleStatusHistoryDto,
    ),
  }));
}
