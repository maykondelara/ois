import { prisma } from "@/db/prisma";
import { licenceDto } from "@/lib/http/dto";
import { apiResponse, readJson, tenantRoute } from "@/lib/http/api";
import { addDriverLicence, listDriverLicences } from "@/modules/drivers/driver-licence.service";
import { licenceCryptoFromEnvironment } from "@/modules/drivers/licence-crypto";
type Params = Promise<{ companyId: string; driverId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: (await listDriverLicences(prisma, context, value.driverId)).map(licenceDto),
  }));
}
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) =>
    apiResponse(
      {
        data: licenceDto(
          await addDriverLicence(
            prisma,
            context,
            licenceCryptoFromEnvironment(),
            value.driverId,
            await readJson(request),
          ),
        ),
      },
      201,
    ),
  );
}
