import { prisma } from "@/db/prisma";
import {
  apiResponse,
  parseOffsetPage,
  parseOptionalEnum,
  parseOptionalUuid,
  readJson,
  tenantRoute,
} from "@/lib/http/api";
import { inspectionSubmissionDto } from "@/lib/http/phase3c-dto";
import { startInspectionInput } from "@/lib/http/phase3c-input";
import { listInspectionSubmissionsPage } from "@/modules/inspections/inspection-read.service";
import { startInspection } from "@/modules/inspections/inspection-submission.service";
type Params = Promise<{ companyId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  const query = new URL(request.url).searchParams;
  return tenantRoute(request, value, async (context) => {
    const page = parseOffsetPage(query);
    const result = await listInspectionSubmissionsPage(prisma, context, page, {
      vehicleId: parseOptionalUuid(query, "vehicleId"),
      driverId: parseOptionalUuid(query, "driverId"),
      templateId: parseOptionalUuid(query, "templateId"),
      status: parseOptionalEnum(query, "status", ["DRAFT", "SUBMITTED", "CANCELLED"]),
    });
    return {
      data: result.data.map(inspectionSubmissionDto),
      page: { ...page, hasNextPage: result.hasNextPage },
    };
  });
}
export async function POST(request: Request, { params }: { params: Params }) {
  return tenantRoute(request, await params, async (context) => {
    const submission = await startInspection(
      prisma,
      context,
      startInspectionInput.parse(await readJson(request)),
    );
    return apiResponse({ data: inspectionSubmissionDto(submission) }, 201);
  });
}
