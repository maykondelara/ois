import { z } from "zod";
import { prisma } from "@/db/prisma";
import { apiResponse, readJson, tenantRoute } from "@/lib/http/api";
import { driverLicenceFileDto } from "@/lib/http/phase3b-dto";
import { attachDriverLicenceFile } from "@/modules/documents/file-association.service";
import { requireDriverLicencePath } from "@/modules/documents/phase3b-read.service";
const body = z
  .object({
    storedFileId: z.string().uuid(),
    role: z.enum(["FRONT", "BACK", "COMBINED"]),
  })
  .strict();
type Params = Promise<{ companyId: string; driverId: string; licenceId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = body.parse(await readJson(request));
    await requireDriverLicencePath(prisma, context, value.driverId, value.licenceId);
    return apiResponse(
      {
        data: driverLicenceFileDto(
          await attachDriverLicenceFile(
            prisma,
            context,
            value.licenceId,
            input.storedFileId,
            input.role,
          ),
        ),
      },
      201,
    );
  });
}
