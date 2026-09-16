import { prisma } from "@/db/prisma";
import { vehicleDto } from "@/lib/http/dto";
import {
  parseOffsetPage,
  parseOptionalEnum,
  parseOptionalSearch,
  parseOptionalUuid,
  apiResponse,
  readJson,
  tenantRoute,
} from "@/lib/http/api";
import { createVehicle, listVehiclesPage } from "@/modules/vehicles/vehicle.service";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const query = new URL(request.url).searchParams;
  return tenantRoute(request, await params, async (context) => {
    const page = parseOffsetPage(query);
    const q = parseOptionalSearch(query);
    const status = parseOptionalEnum(query, "status", ["ACTIVE", "INACTIVE", "OUT_OF_SERVICE"]);
    const vehicleCategoryId = parseOptionalUuid(query, "vehicleCategoryId");
    const result = await listVehiclesPage(prisma, context, {
      page: page.number,
      pageSize: page.pageSize,
      ...(q === undefined ? {} : { q }),
      ...(status === undefined ? {} : { status }),
      ...(vehicleCategoryId === undefined ? {} : { vehicleCategoryId }),
    });
    return {
      data: result.data.map(vehicleDto),
      capabilities: { canManage: context.permissions.has("vehicles.manage") },
      page: { number: page.number, pageSize: page.pageSize, hasNextPage: result.hasNextPage },
    };
  });
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  return tenantRoute(request, await params, async (context) =>
    apiResponse(
      { data: vehicleDto(await createVehicle(prisma, context, await readJson(request))) },
      201,
    ),
  );
}
