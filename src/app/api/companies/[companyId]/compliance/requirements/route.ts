import { prisma } from "@/db/prisma";
import {
  apiResponse,
  parseOffsetPage,
  parseOptionalBoolean,
  parseOptionalEnum,
  parseOptionalUuid,
  readJson,
  tenantRoute,
} from "@/lib/http/api";
import { requirementDto } from "@/lib/http/phase3b-dto";
import { requirementCreateInput } from "@/lib/http/phase3b-input";
import { createComplianceRequirement } from "@/modules/compliance/requirement.service";
import { listRequirementsPage } from "@/modules/documents/phase3b-read.service";
type Params = Promise<{ companyId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  const query = new URL(request.url).searchParams;
  return tenantRoute(request, value, async (context) => {
    const page = parseOffsetPage(query);
    const subjectType = parseOptionalEnum(query, "subjectType", ["DRIVER", "VEHICLE", "COMPANY"]);
    const documentTypeId = parseOptionalUuid(query, "documentTypeId");
    const applicability = parseOptionalEnum(query, "applicability", ["GLOBAL", "SPECIFIC"]);
    const isActive = parseOptionalBoolean(query, "isActive");
    const result = await listRequirementsPage(prisma, context, page, {
      ...(subjectType === undefined ? {} : { subjectType }),
      ...(documentTypeId === undefined ? {} : { documentTypeId }),
      ...(applicability === undefined ? {} : { applicability }),
      ...(isActive === undefined ? {} : { isActive }),
    });
    return {
      data: result.data.map(requirementDto),
      page: { ...page, hasNextPage: result.hasNextPage },
    };
  });
}
export async function POST(request: Request, { params }: { params: Params }) {
  return tenantRoute(request, await params, async (context) =>
    apiResponse(
      {
        data: requirementDto(
          await createComplianceRequirement(
            prisma,
            context,
            requirementCreateInput.parse(await readJson(request)),
          ),
        ),
      },
      201,
    ),
  );
}
