import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { requirementDto } from "@/lib/http/phase3b-dto";
import { changeRequirementApplicability } from "@/modules/compliance/requirement.service";
import { z } from "zod";
const body = z.object({
  applicability: z.enum(["GLOBAL", "SPECIFIC"]),
  reason: z.string().trim().min(1).max(2000),
});
type Params = Promise<{ companyId: string; requirementId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = body.parse(await readJson(request));
    return {
      data: requirementDto(
        await changeRequirementApplicability(
          prisma,
          context,
          value.requirementId,
          input.applicability,
          input.reason,
        ),
      ),
    };
  });
}
