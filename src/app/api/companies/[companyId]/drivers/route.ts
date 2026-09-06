import {
  parseOffsetPage,
  parseOptionalBoolean,
  parseOptionalEnum,
  parseOptionalSearch,
  parseOptionalUuid,
  apiResponse,
  readJson,
  tenantRoute,
} from "@/lib/http/api";
import { driverDto } from "@/lib/http/dto";
import { createDriver, listDriversPage } from "@/modules/drivers/driver.service";
import { prisma } from "@/db/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const query = new URL(request.url).searchParams;
  return tenantRoute(request, await params, async (context) => {
    const page = parseOffsetPage(query);
    const q = parseOptionalSearch(query);
    const status = parseOptionalEnum(query, "status", [
      "ACTIVE",
      "INACTIVE",
      "SUSPENDED",
      "ON_LEAVE",
    ]);
    const linked = parseOptionalBoolean(query, "linked");
    const vehicleCategoryId = parseOptionalUuid(query, "vehicleCategoryId");
    const result = await listDriversPage(prisma, context, {
      page: page.number,
      pageSize: page.pageSize,
      ...(q === undefined ? {} : { q }),
      ...(status === undefined ? {} : { status }),
      ...(linked === undefined ? {} : { linked }),
      ...(vehicleCategoryId === undefined ? {} : { vehicleCategoryId }),
    });
    return {
      data: result.data.map(driverDto),
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
      { data: driverDto(await createDriver(prisma, context, await readJson(request))) },
      201,
    ),
  );
}
