import { prisma } from "@/db/prisma";
import { tenantRoute } from "@/lib/http/api";
import { getFileStorageProvider } from "@/modules/documents/r2-file-storage.provider";
import { createStoredFileDownload } from "@/modules/documents/stored-file.service";

type Params = Promise<{ companyId: string; fileId: string }>;
export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const storage = getFileStorageProvider();
    const result = await createStoredFileDownload(
      prisma,
      context,
      storage.provider,
      value.fileId,
      storage.downloadUrlTtlSeconds,
    );
    return {
      data: {
        downloadUrl: result.url,
        filename: result.filename,
        expiresInSeconds: storage.downloadUrlTtlSeconds,
      },
    };
  });
}
