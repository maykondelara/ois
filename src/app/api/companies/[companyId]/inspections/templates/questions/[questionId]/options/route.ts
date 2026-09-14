import { prisma } from "@/db/prisma";
import { apiResponse, readJson, tenantRoute } from "@/lib/http/api";
import { inspectionOptionDto } from "@/lib/http/phase3c-dto";
import { optionInput } from "@/lib/http/phase3c-input";
import { addInspectionQuestionOption } from "@/modules/inspections/inspection-template.service";
type Params = Promise<{ companyId: string; questionId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) =>
    apiResponse(
      {
        data: inspectionOptionDto(
          await addInspectionQuestionOption(prisma, context, {
            questionId: value.questionId,
            ...optionInput.parse(await readJson(request)),
          }),
        ),
      },
      201,
    ),
  );
}
