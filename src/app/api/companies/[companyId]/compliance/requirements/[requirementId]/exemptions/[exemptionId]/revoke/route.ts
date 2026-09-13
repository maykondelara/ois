import { z } from "zod";
import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { exemptionDto } from "@/lib/http/phase3b-dto";
import { revokeRequirementExemption } from "@/modules/compliance/exemption.service";
import { requireRequirementChild } from "@/modules/documents/phase3b-read.service";
const body = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
type Params = Promise<{ companyId: string; requirementId: string; exemptionId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = body.parse(await readJson(request));
    await requireRequirementChild(
      prisma,
      context,
      value.requirementId,
      value.exemptionId,
      "exemption",
    );
    return {
      data: exemptionDto(
        await revokeRequirementExemption(prisma, context, value.exemptionId, input.reason),
      ),
    };
  });
}
