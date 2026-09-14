import { prisma } from "@/db/prisma";
import { apiResponse, readJson, tenantRoute } from "@/lib/http/api";
import { inspectionResponseFileDto } from "@/lib/http/phase3c-dto";
import { responseFileInput } from "@/lib/http/phase3c-input";
import { attachInspectionResponseFile } from "@/modules/inspections/inspection-submission.service";
type Params = Promise<{ companyId: string; submissionId: string; responseId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) =>
    apiResponse(
      {
        data: inspectionResponseFileDto(
          await attachInspectionResponseFile(prisma, context, {
            submissionId: value.submissionId,
            responseId: value.responseId,
            ...responseFileInput.parse(await readJson(request)),
          }),
        ),
      },
      201,
    ),
  );
}
