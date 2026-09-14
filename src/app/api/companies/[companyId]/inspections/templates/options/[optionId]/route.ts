import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { inspectionOptionDto } from "@/lib/http/phase3c-dto";
import { optionUpdateInput } from "@/lib/http/phase3c-input";
import {
  removeInspectionQuestionOption,
  updateInspectionQuestionOption,
} from "@/modules/inspections/inspection-template.service";
type Params = Promise<{ companyId: string; optionId: string }>;
export async function PATCH(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: inspectionOptionDto(
      await updateInspectionQuestionOption(
        prisma,
        context,
        value.optionId,
        optionUpdateInput.parse(await readJson(request)),
      ),
    ),
  }));
}
export async function DELETE(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    await removeInspectionQuestionOption(prisma, context, value.optionId);
    return { data: { id: value.optionId, isActive: false } };
  });
}
