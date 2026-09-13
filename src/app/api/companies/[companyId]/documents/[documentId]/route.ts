import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { documentDto } from "@/lib/http/phase3b-dto";
import { documentUpdateInput } from "@/lib/http/phase3b-input";
import { updatePendingDocument } from "@/modules/documents/document.service";
import { getDocument } from "@/modules/documents/phase3b-read.service";
type Params = Promise<{ companyId: string; documentId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: documentDto(await getDocument(prisma, context, value.documentId)),
  }));
}
export async function PATCH(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: documentDto(
      await updatePendingDocument(
        prisma,
        context,
        value.documentId,
        documentUpdateInput.parse(await readJson(request)),
      ),
    ),
  }));
}
