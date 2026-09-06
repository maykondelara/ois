import { prisma } from "@/db/prisma";
import { vehicleDto } from "@/lib/http/dto";
import { readJson, tenantRoute } from "@/lib/http/api";
import { updateNextServiceOdometer } from "@/modules/vehicles/vehicle.service";
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ companyId: string; vehicleId: string }> },
) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: vehicleDto(
      await updateNextServiceOdometer(prisma, context, value.vehicleId, await readJson(request)),
    ),
  }));
}
