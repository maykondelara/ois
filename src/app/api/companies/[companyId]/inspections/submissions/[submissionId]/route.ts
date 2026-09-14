import { prisma } from "@/db/prisma";
import { tenantRoute } from "@/lib/http/api";
import {
  inspectionResponseDto,
  inspectionResponseFileDto,
  inspectionSubmissionDto,
} from "@/lib/http/phase3c-dto";
import { getInspectionSubmissionDetail } from "@/modules/inspections/inspection-read.service";
type Params = Promise<{ companyId: string; submissionId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const result = await getInspectionSubmissionDetail(prisma, context, value.submissionId);
    return {
      data: {
        submission: inspectionSubmissionDto(result.submission),
        responses: result.responses.map(inspectionResponseDto),
        options: result.options.map((item) => ({
          responseId: item.responseId,
          questionOptionId: item.questionOptionId,
        })),
        files: result.files.map(inspectionResponseFileDto),
      },
    };
  });
}
