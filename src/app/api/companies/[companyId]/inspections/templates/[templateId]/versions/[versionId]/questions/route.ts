import { prisma } from "@/db/prisma";
import { apiResponse, readJson, tenantRoute } from "@/lib/http/api";
import { inspectionQuestionDto } from "@/lib/http/phase3c-dto";
import { questionInput } from "@/lib/http/phase3c-input";
import { addInspectionQuestion } from "@/modules/inspections/inspection-template.service";
type Params = Promise<{ companyId: string; templateId: string; versionId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) =>
    apiResponse(
      {
        data: inspectionQuestionDto(
          await addInspectionQuestion(prisma, context, {
            templateVersionId: value.versionId,
            ...questionInput.parse(await readJson(request)),
          }),
        ),
      },
      201,
    ),
  );
}
