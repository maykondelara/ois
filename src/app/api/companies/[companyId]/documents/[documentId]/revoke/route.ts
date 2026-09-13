import { z } from "zod";
import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { documentDto } from "@/lib/http/phase3b-dto";
import { revokeDocument } from "@/modules/documents/document.service";
const body = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
type Params = Promise<{ companyId: string; documentId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = body.parse(await readJson(request));
    return {
      data: documentDto(await revokeDocument(prisma, context, value.documentId, input.reason)),
    };
  });
}
