import { prisma } from "@/db/prisma";
import {
  apiResponse,
  parseOffsetPage,
  parseOptionalBoolean,
  parseOptionalEnum,
  readJson,
  tenantRoute,
} from "@/lib/http/api";
import { inspectionTemplateDto, inspectionVersionDto } from "@/lib/http/phase3c-dto";
import { templateCreateInput } from "@/lib/http/phase3c-input";
import { listInspectionTemplatesPage } from "@/modules/inspections/inspection-read.service";
import { createInspectionTemplate } from "@/modules/inspections/inspection-template.service";
type Params = Promise<{ companyId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  const query = new URL(request.url).searchParams;
  return tenantRoute(request, value, async (context) => {
    const page = parseOffsetPage(query);
    const result = await listInspectionTemplatesPage(prisma, context, page, {
      isActive: parseOptionalBoolean(query, "isActive"),
      status: parseOptionalEnum(query, "status", ["DRAFT", "PUBLISHED"]),
    });
    return {
      data: result.data.map(({ template, versions }) => ({
        ...inspectionTemplateDto(template),
        versions: versions.map(inspectionVersionDto),
      })),
      page: { ...page, hasNextPage: result.hasNextPage },
    };
  });
}
export async function POST(request: Request, { params }: { params: Params }) {
  return tenantRoute(request, await params, async (context) => {
    const result = await createInspectionTemplate(
      prisma,
      context,
      templateCreateInput.parse(await readJson(request)),
    );
    return apiResponse(
      {
        data: {
          template: inspectionTemplateDto(result.template),
          draftVersion: inspectionVersionDto(result.version),
        },
      },
      201,
    );
  });
}
