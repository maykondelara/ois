import { z } from "zod";
import { prisma } from "@/db/prisma";
import { apiResponse, readJson, tenantRoute } from "@/lib/http/api";
import { getFileStorageProvider } from "@/modules/documents/r2-file-storage.provider";
import { initiateStoredFile } from "@/modules/documents/stored-file.service";

const body = z.object({ originalFilename: z.string().trim().min(1).max(255) }).strict();
type Params = Promise<{ companyId: string }>;

export async function POST(request: Request, { params }: { params: Params }) {
  return tenantRoute(request, await params, async (context) => {
    const input = body.parse(await readJson(request));
    const storage = getFileStorageProvider();
    const result = await initiateStoredFile(
      prisma,
      context,
      storage.provider,
      storage.bucket,
      input.originalFilename,
      storage.uploadUrlTtlSeconds,
    );
    return apiResponse(
      {
        data: {
          fileId: result.file.id,
          uploadUrl: result.uploadUrl,
          expiresInSeconds: storage.uploadUrlTtlSeconds,
        },
      },
      201,
    );
  });
}
