import { prisma } from "@/db/prisma";
import { tenantRoute } from "@/lib/http/api";
import { inspectionVersionDto } from "@/lib/http/phase3c-dto";
import { publishInspectionTemplateVersion } from "@/modules/inspections/inspection-template.service";
type Params = Promise<{ companyId: string; templateId: string; versionId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: inspectionVersionDto(
      await publishInspectionTemplateVersion(prisma, context, value.versionId),
    ),
  }));
}
