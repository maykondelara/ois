import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { inspectionSubmissionDto } from "@/lib/http/phase3c-dto";
import { removalInput } from "@/lib/http/phase3c-input";
import { cancelInspectionDraft } from "@/modules/inspections/inspection-submission.service";
type Params = Promise<{ companyId: string; submissionId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: inspectionSubmissionDto(
      await cancelInspectionDraft(
        prisma,
        context,
        value.submissionId,
        removalInput.parse(await readJson(request)).reason,
      ),
    ),
  }));
}
