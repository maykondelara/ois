import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { documentTypeDto } from "@/lib/http/phase3b-dto";
import { documentTypeUpdateInput } from "@/lib/http/phase3b-input";
import {
  setDocumentTypeActive,
  updateDocumentType,
} from "@/modules/documents/document-type.service";
import { getDocumentType } from "@/modules/documents/phase3b-read.service";
type Params = Promise<{ companyId: string; documentTypeId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: documentTypeDto(await getDocumentType(prisma, context, value.documentTypeId)),
  }));
}
export async function PATCH(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = documentTypeUpdateInput.parse(await readJson(request));
    const item =
      typeof input.isActive === "boolean"
        ? await setDocumentTypeActive(prisma, context, value.documentTypeId, input.isActive)
        : await updateDocumentType(prisma, context, value.documentTypeId, input);
    return { data: documentTypeDto(item) };
  });
}
