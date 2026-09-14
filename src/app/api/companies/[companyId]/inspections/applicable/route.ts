import { prisma } from "@/db/prisma";
import { parseOptionalUuid, tenantRoute } from "@/lib/http/api";
import { ValidationError } from "@/lib/errors";
import { inspectionTemplateDto, inspectionVersionDto } from "@/lib/http/phase3c-dto";
import { listApplicableInspectionTemplates } from "@/modules/inspections/inspection-submission.service";
type Params = Promise<{ companyId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  const query = new URL(request.url).searchParams;
  return tenantRoute(request, value, async (context) => {
    const vehicleId = parseOptionalUuid(query, "vehicleId");
    if (!vehicleId) throw new ValidationError("VEHICLE_ID_REQUIRED", "vehicleId is required");
    const rows = await listApplicableInspectionTemplates(prisma, context, vehicleId);
    return {
      data: rows.map(({ template, version }) => ({
        template: inspectionTemplateDto(template),
        version: inspectionVersionDto(version),
      })),
    };
  });
}
