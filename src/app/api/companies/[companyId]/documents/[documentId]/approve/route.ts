import { prisma } from "@/db/prisma";
import { tenantRoute } from "@/lib/http/api";
import { documentDto } from "@/lib/http/phase3b-dto";
import { reviewDocument } from "@/modules/documents/document-review.service";
type Params = Promise<{ companyId: string; documentId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => ({
    data: documentDto(await reviewDocument(prisma, context, value.documentId, "APPROVED")),
  }));
}
