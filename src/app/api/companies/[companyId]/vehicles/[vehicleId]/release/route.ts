import { prisma } from "@/db/prisma";
import { vehicleDto } from "@/lib/http/dto";
import { readJson, tenantRoute } from "@/lib/http/api";
import { vehicleReleaseInput } from "@/lib/http/phase3d-input";
import { releaseVehicleFromResolvedIssues } from "@/modules/issues/issue.service";

type Params = Promise<{ companyId: string; vehicleId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = vehicleReleaseInput.parse(await readJson(request));
    return {
      data: vehicleDto(
        await releaseVehicleFromResolvedIssues(prisma, context, value.vehicleId, input.reason),
      ),
    };
  });
}
