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
import { documentDto } from "@/lib/http/phase3b-dto";
import { documentCreateInput } from "@/lib/http/phase3b-input";
import { createDocument } from "@/modules/documents/document.service";
import { listDocumentsPage } from "@/modules/documents/phase3b-read.service";
type Params = Promise<{ companyId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  const query = new URL(request.url).searchParams;
  return tenantRoute(request, value, async (context) => {
    const page = parseOffsetPage(query);
    const subjectType = parseOptionalEnum(query, "subjectType", ["DRIVER", "VEHICLE", "COMPANY"]);
    const driverId = parseOptionalUuid(query, "driverId");
    const vehicleId = parseOptionalUuid(query, "vehicleId");
    const documentTypeId = parseOptionalUuid(query, "documentTypeId");
    const reviewStatus = parseOptionalEnum(query, "reviewStatus", [
      "PENDING_REVIEW",
      "APPROVED",
      "REJECTED",
    ]);
    const includeArchived = parseOptionalBoolean(query, "includeArchived");
    const result = await listDocumentsPage(prisma, context, page, {
      ...(subjectType === undefined ? {} : { subjectType }),
      ...(driverId === undefined ? {} : { driverId }),
      ...(vehicleId === undefined ? {} : { vehicleId }),
      ...(documentTypeId === undefined ? {} : { documentTypeId }),
      ...(reviewStatus === undefined ? {} : { reviewStatus }),
      ...(includeArchived === undefined ? {} : { includeArchived }),
    });
    return {
      data: result.data.map(documentDto),
      page: { ...page, hasNextPage: result.hasNextPage },
    };
  });
}
export async function POST(request: Request, { params }: { params: Params }) {
  return tenantRoute(request, await params, async (context) =>
    apiResponse(
      {
        data: documentDto(
          await createDocument(prisma, context, documentCreateInput.parse(await readJson(request))),
        ),
      },
      201,
    ),
  );
}
