import { prisma } from "@/db/prisma";
import { parseOffsetPage, parseOptionalEnum, tenantRoute } from "@/lib/http/api";
import { complianceSummaryDto } from "@/lib/http/phase3b-dto";
import { listComplianceSubjects } from "@/modules/documents/phase3b-read.service";

type Params = Promise<{ companyId: string }>;

export async function GET(request: Request, { params }: { params: Params }) {
  const query = new URL(request.url).searchParams;
  return tenantRoute(request, await params, async (context) => {
    const page = parseOffsetPage(query);
    const subjectType = parseOptionalEnum(query, "subjectType", ["DRIVER", "VEHICLE", "COMPANY"]);
    const status = parseOptionalEnum(query, "status", [
      "COMPLIANT",
      "AT_RISK",
      "NON_COMPLIANT",
      "NOT_EVALUATED",
    ]);
    const all = (await listComplianceSubjects(prisma, context)).filter(
      (item) =>
        (subjectType === undefined || item.subjectType === subjectType) &&
        (status === undefined || item.status === status),
    );
    const start = (page.number - 1) * page.pageSize;
    return {
      data: all.slice(start, start + page.pageSize).map((item) => ({
        subjectType: item.subjectType,
        subjectId: item.subjectId,
        displayName: item.displayName,
        summary: complianceSummaryDto(item.status, item.obligations),
      })),
      capabilities: {
        canManageDocuments:
          context.role === "DRIVER" || context.permissions.has("documents.manage"),
        canReviewDocuments:
          context.permissions.has("documents.review") && context.role !== "DRIVER",
        canManageCompliance: context.permissions.has("compliance.manage"),
      },
      page: {
        number: page.number,
        pageSize: page.pageSize,
        hasNextPage: all.length > start + page.pageSize,
      },
    };
  });
}
