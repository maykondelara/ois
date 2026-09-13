import { z } from "zod";
import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { documentFileDto } from "@/lib/http/phase3b-dto";
import { removeDocumentFile } from "@/modules/documents/file-association.service";
import { requireDocumentFilePath } from "@/modules/documents/phase3b-read.service";
const body = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
type Params = Promise<{ companyId: string; documentId: string; documentFileId: string }>;
export async function DELETE(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = body.parse(await readJson(request));
    await requireDocumentFilePath(prisma, context, value.documentId, value.documentFileId);
    return {
      data: documentFileDto(
        await removeDocumentFile(prisma, context, value.documentFileId, input.reason),
      ),
    };
  });
}
