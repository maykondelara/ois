import { prisma } from "@/db/prisma";
import { tenantRoute } from "@/lib/http/api";
import { complianceAggregateDto } from "@/lib/http/phase3b-dto";
import { getComplianceSummary } from "@/modules/documents/phase3b-read.service";
type Params = Promise<{ companyId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const result = await getComplianceSummary(prisma, context);
    return {
      data: {
        evaluationDate: result.evaluationDate.toISOString(),
        aggregates: {
          DRIVER: complianceAggregateDto(result.aggregates.DRIVER),
          VEHICLE: complianceAggregateDto(result.aggregates.VEHICLE),
          COMPANY: complianceAggregateDto(result.aggregates.COMPANY),
          OVERALL: complianceAggregateDto(result.aggregates.OVERALL),
        },
      },
    };
  });
}
