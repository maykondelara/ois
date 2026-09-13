import { prisma } from "@/db/prisma";
import { apiResponse, readJson, tenantRoute } from "@/lib/http/api";
import { exemptionDto } from "@/lib/http/phase3b-dto";
import { exemptionCreateInput } from "@/lib/http/phase3b-input";
import { grantRequirementExemption } from "@/modules/compliance/exemption.service";
type Params = Promise<{ companyId: string; requirementId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) =>
    apiResponse(
      {
        data: exemptionDto(
          await grantRequirementExemption(prisma, context, {
            ...exemptionCreateInput.parse(await readJson(request)),
            requirementId: value.requirementId,
          }),
        ),
      },
      201,
    ),
  );
}
