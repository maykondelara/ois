import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { issueDto } from "@/lib/http/phase3d-dto";
import { issueResolutionInput } from "@/lib/http/phase3d-input";
import { resolveIssue } from "@/modules/issues/issue.service";

type Params = Promise<{ companyId: string; issueId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = issueResolutionInput.parse(await readJson(request));
    return {
      data: issueDto(await resolveIssue(prisma, context, value.issueId, input.resolutionNotes)),
    };
  });
}
