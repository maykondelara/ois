import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import {
  defectHoldDto,
  issueActionDto,
  issueCapabilitiesDto,
  issueDto,
  issueHistoryDto,
} from "@/lib/http/phase3d-dto";
import { issueSeverityInput } from "@/lib/http/phase3d-input";
import { getIssue, reclassifyIssueSeverity } from "@/modules/issues/issue.service";

type Params = Promise<{ companyId: string; issueId: string }>;

export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const result = await getIssue(prisma, context, value.issueId);
    return {
      data: {
        issue: issueDto(result.issue),
        vehicle: result.vehicle,
        history: result.history.map(issueHistoryDto),
        actions: result.actions.map(issueActionDto),
        holds: result.holds.map(defectHoldDto),
      },
      capabilities: issueCapabilitiesDto(context),
    };
  });
}

export async function PATCH(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = issueSeverityInput.parse(await readJson(request));
    return {
      data: issueDto(
        await reclassifyIssueSeverity(prisma, context, value.issueId, input.severity, input.reason),
      ),
    };
  });
}
