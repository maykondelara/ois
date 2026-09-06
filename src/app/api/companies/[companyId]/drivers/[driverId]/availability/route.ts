import { prisma } from "@/db/prisma";
import { availabilityDto } from "@/lib/http/dto";
import { readJson, tenantRoute } from "@/lib/http/api";
import {
  listDriverRegularAvailability,
  replaceDriverRegularAvailability,
} from "@/modules/drivers/driver.service";

type Params = Promise<{ companyId: string; driverId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: (await listDriverRegularAvailability(prisma, context, value.driverId)).map(
      availabilityDto,
    ),
  }));
}
export async function PUT(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: (
      await replaceDriverRegularAvailability(
        prisma,
        context,
        value.driverId,
        await readJson(request),
      )
    ).map(availabilityDto),
  }));
}
