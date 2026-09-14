import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { inspectionQuestionDto } from "@/lib/http/phase3c-dto";
import { questionUpdateInput } from "@/lib/http/phase3c-input";
import {
  removeInspectionQuestion,
  updateInspectionQuestion,
} from "@/modules/inspections/inspection-template.service";
type Params = Promise<{ companyId: string; questionId: string }>;
export async function PATCH(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: inspectionQuestionDto(
      await updateInspectionQuestion(
        prisma,
        context,
        value.questionId,
        questionUpdateInput.parse(await readJson(request)),
      ),
    ),
  }));
}
export async function DELETE(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    await removeInspectionQuestion(prisma, context, value.questionId);
    return { data: { id: value.questionId, isActive: false } };
  });
}
