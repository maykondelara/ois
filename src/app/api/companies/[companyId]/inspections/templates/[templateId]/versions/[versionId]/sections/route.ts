import { prisma } from "@/db/prisma";
import { apiResponse, readJson, tenantRoute } from "@/lib/http/api";
import { inspectionSectionDto } from "@/lib/http/phase3c-dto";
import { sectionInput } from "@/lib/http/phase3c-input";
import { addInspectionSection } from "@/modules/inspections/inspection-template.service";
type Params = Promise<{ companyId: string; templateId: string; versionId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) =>
    apiResponse(
      {
        data: inspectionSectionDto(
          await addInspectionSection(prisma, context, {
            templateVersionId: value.versionId,
            ...sectionInput.parse(await readJson(request)),
          }),
        ),
      },
      201,
    ),
  );
}
