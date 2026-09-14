import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { applicabilityInput } from "@/lib/http/phase3c-input";
import { configureInspectionApplicability } from "@/modules/inspections/inspection-template.service";
type Params = Promise<{ companyId: string; templateId: string; versionId: string }>;
export async function PUT(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = applicabilityInput.parse(await readJson(request));
    await configureInspectionApplicability(prisma, context, {
      templateVersionId: value.versionId,
      ...input,
    });
    return { data: { templateVersionId: value.versionId, ...input } };
  });
}
