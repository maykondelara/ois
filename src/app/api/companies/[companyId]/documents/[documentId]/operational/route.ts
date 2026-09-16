import { prisma } from "@/db/prisma";
import { tenantRoute } from "@/lib/http/api";
import {
  documentDto,
  documentReviewHistoryDto,
  operationalDocumentFileDto,
} from "@/lib/http/phase3b-dto";
import { getOperationalDocumentDetail } from "@/modules/documents/phase3b-read.service";

type Params = Promise<{ companyId: string; documentId: string }>;

export async function GET(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const result = await getOperationalDocumentDetail(prisma, context, value.documentId);
    return {
      data: {
        document: documentDto(result.document),
        files: result.files.map(operationalDocumentFileDto),
        reviewHistory: result.reviewHistory.map(documentReviewHistoryDto),
      },
      capabilities: {
        canManage: context.role === "DRIVER" || context.permissions.has("documents.manage"),
        canReview:
          context.permissions.has("documents.review") &&
          context.role !== "DRIVER" &&
          !result.createdByCurrentUser,
        canDownload: context.permissions.has("documents.file.read"),
        canArchive: context.permissions.has("documents.manage") && context.role !== "DRIVER",
        canRevoke:
          context.permissions.has("documents.manage") &&
          context.permissions.has("documents.review") &&
          context.role !== "DRIVER",
      },
    };
  });
}
