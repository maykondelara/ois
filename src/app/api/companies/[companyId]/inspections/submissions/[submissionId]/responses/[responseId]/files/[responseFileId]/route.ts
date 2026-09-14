import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { removalInput } from "@/lib/http/phase3c-input";
import { removeInspectionResponseFile } from "@/modules/inspections/inspection-submission.service";
type Params = Promise<{
  companyId: string;
  submissionId: string;
  responseId: string;
  responseFileId: string;
}>;
export async function DELETE(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const body = removalInput.parse(await readJson(request));
    const removed = await removeInspectionResponseFile(prisma, context, {
      submissionId: value.submissionId,
      responseId: value.responseId,
      responseFileId: value.responseFileId,
      reason: body.reason,
    });
    return { data: { id: removed.id, removedAt: removed.removedAt?.toISOString() ?? null } };
  });
}
