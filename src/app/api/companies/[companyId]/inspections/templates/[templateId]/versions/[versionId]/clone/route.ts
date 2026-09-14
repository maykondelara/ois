import { prisma } from "@/db/prisma";
import { apiResponse, tenantRoute } from "@/lib/http/api";
import { inspectionVersionDto } from "@/lib/http/phase3c-dto";
import { clonePublishedInspectionTemplateVersion } from "@/modules/inspections/inspection-template.service";
type Params = Promise<{ companyId: string; templateId: string; versionId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) =>
    apiResponse(
      {
        data: inspectionVersionDto(
          await clonePublishedInspectionTemplateVersion(prisma, context, value.versionId),
        ),
      },
      201,
    ),
  );
}
