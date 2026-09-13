import { z } from "zod";
import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { assignmentDto } from "@/lib/http/phase3b-dto";
import { removeRequirementAssignment } from "@/modules/compliance/assignment.service";
import { requireRequirementChild } from "@/modules/documents/phase3b-read.service";
const body = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
type Params = Promise<{ companyId: string; requirementId: string; assignmentId: string }>;
export async function DELETE(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = body.parse(await readJson(request));
    await requireRequirementChild(
      prisma,
      context,
      value.requirementId,
      value.assignmentId,
      "assignment",
    );
    return {
      data: assignmentDto(
        await removeRequirementAssignment(prisma, context, value.assignmentId, input.reason),
      ),
    };
  });
}
