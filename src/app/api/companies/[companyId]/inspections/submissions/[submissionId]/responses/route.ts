import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { inspectionResponseDto } from "@/lib/http/phase3c-dto";
import { responseInput } from "@/lib/http/phase3c-input";
import { saveInspectionResponse } from "@/modules/inspections/inspection-submission.service";
type Params = Promise<{ companyId: string; submissionId: string }>;
export async function PUT(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: inspectionResponseDto(
      await saveInspectionResponse(prisma, context, {
        submissionId: value.submissionId,
        ...responseInput.parse(await readJson(request)),
      }),
    ),
  }));
}
