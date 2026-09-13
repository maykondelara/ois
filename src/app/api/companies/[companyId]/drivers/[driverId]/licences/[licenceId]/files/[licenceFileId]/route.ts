import { z } from "zod";
import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { driverLicenceFileDto } from "@/lib/http/phase3b-dto";
import { removeDriverLicenceFile } from "@/modules/documents/file-association.service";
import { requireDriverLicencePath } from "@/modules/documents/phase3b-read.service";
const body = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
type Params = Promise<{
  companyId: string;
  driverId: string;
  licenceId: string;
  licenceFileId: string;
}>;
export async function DELETE(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = body.parse(await readJson(request));
    await requireDriverLicencePath(
      prisma,
      context,
      value.driverId,
      value.licenceId,
      value.licenceFileId,
    );
    return {
      data: driverLicenceFileDto(
        await removeDriverLicenceFile(prisma, context, value.licenceFileId, input.reason),
      ),
    };
  });
}
