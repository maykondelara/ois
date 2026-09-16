import { prisma } from "@/db/prisma";
import { apiResponse, readJson, tenantRoute } from "@/lib/http/api";
import { issueActionDto } from "@/lib/http/phase3d-dto";
import { issueActionInput } from "@/lib/http/phase3d-input";
import { addIssueAction } from "@/modules/issues/issue.service";

type Params = Promise<{ companyId: string; issueId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = issueActionInput.parse(await readJson(request));
    return apiResponse(
      {
        data: issueActionDto(
          await addIssueAction(prisma, context, value.issueId, {
            actionType: input.actionType,
            description: input.description,
            ...(input.notes === undefined ? {} : { notes: input.notes }),
          }),
        ),
      },
      201,
    );
  });
}
