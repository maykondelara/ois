import { prisma } from "@/db/prisma";
import { tenantRoute } from "@/lib/http/api";
import { complianceObligationDto, complianceSummaryDto } from "@/lib/http/phase3b-dto";
import { getVehicleCompliance } from "@/modules/documents/phase3b-read.service";
type Params = Promise<{ companyId: string; vehicleId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const result = await getVehicleCompliance(prisma, context, value.vehicleId);
    return {
      data: {
        evaluationDate: result.evaluationDate.toISOString(),
        obligations: result.obligations.map(complianceObligationDto),
        summary: complianceSummaryDto(
          result.summary?.status ?? "NOT_EVALUATED",
          result.obligations,
        ),
      },
    };
  });
}
