import { prisma } from "@/db/prisma";
import { odometerReadingDto } from "@/lib/http/dto";
import { readJson, tenantRoute } from "@/lib/http/api";
import { reviewOdometerReading } from "@/modules/vehicles/odometer.service";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string; vehicleId: string; readingId: string }> },
) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: odometerReadingDto(
      await reviewOdometerReading(
        prisma,
        context,
        value.vehicleId,
        value.readingId,
        await readJson(request),
      ),
    ),
  }));
}
