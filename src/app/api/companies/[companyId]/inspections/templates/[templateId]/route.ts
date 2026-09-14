import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import {
  inspectionOptionDto,
  inspectionQuestionDto,
  inspectionSectionDto,
  inspectionTemplateDto,
  inspectionVersionDto,
} from "@/lib/http/phase3c-dto";
import { templateUpdateInput } from "@/lib/http/phase3c-input";
import { getInspectionTemplateDetail } from "@/modules/inspections/inspection-read.service";
import { updateInspectionTemplate } from "@/modules/inspections/inspection-template.service";
type Params = Promise<{ companyId: string; templateId: string }>;
const dto = (item: Awaited<ReturnType<typeof getInspectionTemplateDetail>>) => ({
  template: inspectionTemplateDto(item.template),
  versions: item.versions.map(inspectionVersionDto),
  version: item.version ? inspectionVersionDto(item.version) : null,
  sections: item.sections.map(inspectionSectionDto),
  questions: item.questions.map(inspectionQuestionDto),
  options: item.options.map(inspectionOptionDto),
  applicability: {
    vehicleCategoryIds: item.categoryApplicability.map((row) => row.vehicleCategoryId),
    vehicleIds: item.vehicleApplicability.map((row) => row.vehicleId),
  },
});
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: dto(
      await getInspectionTemplateDetail(
        prisma,
        context,
        value.templateId,
        new URL(request.url).searchParams.get("versionId") ?? undefined,
      ),
    ),
  }));
}
export async function PATCH(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: inspectionTemplateDto(
      await updateInspectionTemplate(
        prisma,
        context,
        value.templateId,
        templateUpdateInput.parse(await readJson(request)),
      ),
    ),
  }));
}
