import { prisma } from "@/db/prisma";
import { categoryDto } from "@/lib/http/dto";
import { readJson, tenantRoute } from "@/lib/http/api";
import { updateVehicleCategory } from "@/modules/vehicles/vehicle-category.service";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ companyId: string; categoryId: string }> },
) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: categoryDto(
      await updateVehicleCategory(prisma, context, value.categoryId, await readJson(request)),
    ),
  }));
}
