import { z } from "zod";
import { prisma } from "@/db/prisma";
import { apiResponse, readJson, tenantRoute } from "@/lib/http/api";
import { documentFileDto } from "@/lib/http/phase3b-dto";
import { attachDocumentFile } from "@/modules/documents/file-association.service";
const body = z.object({ storedFileId: z.string().uuid() }).strict();
type Params = Promise<{ companyId: string; documentId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = body.parse(await readJson(request));
    return apiResponse(
      {
        data: documentFileDto(
          await attachDocumentFile(prisma, context, value.documentId, input.storedFileId),
        ),
      },
      201,
    );
  });
}
