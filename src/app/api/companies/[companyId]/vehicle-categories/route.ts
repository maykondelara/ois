import { prisma } from "@/db/prisma";
import { categoryDto } from "@/lib/http/dto";
import { apiResponse, readJson, tenantRoute } from "@/lib/http/api";
import {
  createVehicleCategory,
  listVehicleCategories,
} from "@/modules/vehicles/vehicle-category.service";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const query = new URL(request.url).searchParams;
  return tenantRoute(request, await params, async (context) => ({
    data: (
      await listVehicleCategories(prisma, context, query.get("includeInactive") === "true")
    ).map(categoryDto),
  }));
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  return tenantRoute(request, await params, async (context) =>
    apiResponse(
      { data: categoryDto(await createVehicleCategory(prisma, context, await readJson(request))) },
      201,
    ),
  );
}
