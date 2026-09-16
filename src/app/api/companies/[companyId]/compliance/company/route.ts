import { prisma } from "@/db/prisma";
import { tenantRoute } from "@/lib/http/api";
import {
  complianceObligationDto,
  complianceSummaryDto,
  exemptionDto,
} from "@/lib/http/phase3b-dto";
import { getCompanyCompliance } from "@/modules/documents/phase3b-read.service";
type Params = Promise<{ companyId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const result = await getCompanyCompliance(prisma, context);
    return {
      data: {
        evaluationDate: result.evaluationDate.toISOString(),
        obligations: result.obligations.map(complianceObligationDto),
        exemptions: result.exemptions.map(exemptionDto),
        summary: complianceSummaryDto(
          result.summary?.status ?? "NOT_EVALUATED",
          result.obligations,
        ),
      },
    };
  });
}
