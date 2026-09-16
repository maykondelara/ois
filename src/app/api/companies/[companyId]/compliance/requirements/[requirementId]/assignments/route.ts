import { prisma } from "@/db/prisma";
import { apiResponse, readJson, tenantRoute } from "@/lib/http/api";
import { assignmentDto } from "@/lib/http/phase3b-dto";
import { assignmentCreateInput } from "@/lib/http/phase3b-input";
import { assignRequirement } from "@/modules/compliance/assignment.service";
import { listRequirementAssignments } from "@/modules/documents/phase3b-read.service";
type Params = Promise<{ companyId: string; requirementId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: (await listRequirementAssignments(prisma, context, value.requirementId)).map(
      assignmentDto,
    ),
  }));
}
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) =>
    apiResponse(
      {
        data: assignmentDto(
          await assignRequirement(prisma, context, {
            ...assignmentCreateInput.parse(await readJson(request)),
            requirementId: value.requirementId,
          }),
        ),
      },
      201,
    ),
  );
}
