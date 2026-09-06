import { prisma } from "@/db/prisma";
import { licenceDto } from "@/lib/http/dto";
import { readJson, tenantRoute } from "@/lib/http/api";
import { updateDriverLicence } from "@/modules/drivers/driver-licence.service";
import { licenceCryptoFromEnvironment } from "@/modules/drivers/licence-crypto";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ companyId: string; driverId: string; licenceId: string }> },
) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: licenceDto(
      await updateDriverLicence(
        prisma,
        context,
        licenceCryptoFromEnvironment(),
        value.driverId,
        value.licenceId,
        await readJson(request),
      ),
    ),
  }));
}
