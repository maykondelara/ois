import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { inspectionSectionDto } from "@/lib/http/phase3c-dto";
import { sectionUpdateInput } from "@/lib/http/phase3c-input";
import {
  removeInspectionSection,
  updateInspectionSection,
} from "@/modules/inspections/inspection-template.service";
type Params = Promise<{ companyId: string; sectionId: string }>;
export async function PATCH(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: inspectionSectionDto(
      await updateInspectionSection(
        prisma,
        context,
        value.sectionId,
        sectionUpdateInput.parse(await readJson(request)),
      ),
    ),
  }));
}
export async function DELETE(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    await removeInspectionSection(prisma, context, value.sectionId);
    return { data: { id: value.sectionId, isActive: false } };
  });
}
