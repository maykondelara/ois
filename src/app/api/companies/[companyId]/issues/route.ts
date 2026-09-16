import { prisma } from "@/db/prisma";
import {
  parseOffsetPage,
  parseOptionalBoolean,
  parseOptionalEnum,
  parseOptionalUuid,
  tenantRoute,
} from "@/lib/http/api";
import { issueCapabilitiesDto, issueDto } from "@/lib/http/phase3d-dto";
import { listIssuesPage } from "@/modules/issues/issue.service";

type Params = Promise<{ companyId: string }>;

export async function GET(request: Request, { params }: { params: Params }) {
  const query = new URL(request.url).searchParams;
  return tenantRoute(request, await params, async (context) => {
    const page = parseOffsetPage(query);
    const blocking = parseOptionalBoolean(query, "blocking");
    const result = await listIssuesPage(prisma, context, page, {
      status: parseOptionalEnum(query, "status", ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
      severity: parseOptionalEnum(query, "severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      operationalImpact:
        blocking === undefined ? undefined : blocking ? "VEHICLE_BLOCKING" : "NON_BLOCKING",
      vehicleId: parseOptionalUuid(query, "vehicleId"),
    });
    return {
      data: result.data.map(issueDto),
      page: { ...page, hasNextPage: result.hasNextPage },
      capabilities: issueCapabilitiesDto(context),
    };
  });
}
