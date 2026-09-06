import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { odometerSubmissionDto } from "@/lib/http/dto";
import { submitManualOdometerReading } from "@/modules/vehicles/odometer.service";
import { odometerConfirmationTokensFromEnvironment } from "@/modules/vehicles/odometer-confirmation";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string; vehicleId: string }> },
) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: odometerSubmissionDto(
      await submitManualOdometerReading(
        prisma,
        context,
        odometerConfirmationTokensFromEnvironment(),
        value.vehicleId,
        await readJson(request),
      ),
    ),
  }));
}
