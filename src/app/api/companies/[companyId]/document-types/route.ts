import { prisma } from "@/db/prisma";
import {
  apiResponse,
  parseOffsetPage,
  parseOptionalBoolean,
  parseOptionalEnum,
  readJson,
  tenantRoute,
} from "@/lib/http/api";
import { documentTypeDto } from "@/lib/http/phase3b-dto";
import { documentTypeCreateInput } from "@/lib/http/phase3b-input";
import { createDocumentType } from "@/modules/documents/document-type.service";
import { listDocumentTypesPage } from "@/modules/documents/phase3b-read.service";

type Params = Promise<{ companyId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  const query = new URL(request.url).searchParams;
  return tenantRoute(request, value, async (context) => {
    const page = parseOffsetPage(query);
    const subjectType = parseOptionalEnum(query, "subjectType", ["DRIVER", "VEHICLE", "COMPANY"]);
    const evidenceSourceType = parseOptionalEnum(query, "evidenceSourceType", [
      "DOCUMENT",
      "DRIVER_LICENCE",
    ]);
    const isActive = parseOptionalBoolean(query, "isActive");
    const result = await listDocumentTypesPage(prisma, context, page, {
      ...(subjectType === undefined ? {} : { subjectType }),
      ...(evidenceSourceType === undefined ? {} : { evidenceSourceType }),
      ...(isActive === undefined ? {} : { isActive }),
    });
    return {
      data: result.data.map(documentTypeDto),
      page: { ...page, hasNextPage: result.hasNextPage },
    };
  });
}
export async function POST(request: Request, { params }: { params: Params }) {
  return tenantRoute(request, await params, async (context) =>
    apiResponse(
      {
        data: documentTypeDto(
          await createDocumentType(
            prisma,
            context,
            documentTypeCreateInput.parse(await readJson(request)),
          ),
        ),
      },
      201,
    ),
  );
}
