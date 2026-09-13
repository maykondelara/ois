import { prisma } from "@/db/prisma";
import { apiResponse, tenantRoute } from "@/lib/http/api";
import { getFileStorageProvider } from "@/modules/documents/r2-file-storage.provider";
import { finalizeStoredFile } from "@/modules/documents/stored-file.service";

type Params = Promise<{ companyId: string; fileId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const storage = getFileStorageProvider();
    const file = await finalizeStoredFile(prisma, context, storage.provider, value.fileId);
    return apiResponse(
      {
        data: {
          fileId: file.id,
          fileState: file.fileState,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
        },
      },
      200,
    );
  });
}
