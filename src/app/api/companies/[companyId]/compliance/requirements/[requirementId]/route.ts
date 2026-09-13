import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { requirementDto } from "@/lib/http/phase3b-dto";
import { requirementUpdateInput } from "@/lib/http/phase3b-input";
import {
  setRequirementActive,
  updateComplianceRequirement,
} from "@/modules/compliance/requirement.service";
import { getRequirement } from "@/modules/documents/phase3b-read.service";
type Params = Promise<{ companyId: string; requirementId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: requirementDto(await getRequirement(prisma, context, value.requirementId)),
  }));
}
export async function PATCH(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = requirementUpdateInput.parse(await readJson(request));
    const item =
      typeof input.isActive === "boolean"
        ? await setRequirementActive(prisma, context, value.requirementId, input.isActive)
        : await updateComplianceRequirement(prisma, context, value.requirementId, input);
    return { data: requirementDto(item) };
  });
}
