import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import { submitInput } from "@/lib/http/phase3c-input";
import { submitInspection } from "@/modules/inspections/inspection-submission.service";
import { odometerConfirmationTokensFromEnvironment } from "@/modules/vehicles/odometer-confirmation";
type Params = Promise<{ companyId: string; submissionId: string }>;
export async function POST(request: Request, { params }: { params: Params }) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    const input = submitInput.parse(await readJson(request));
    const result = await submitInspection(
      prisma,
      context,
      odometerConfirmationTokensFromEnvironment(),
      value.submissionId,
      input.confirmationToken,
    );
    return { data: result };
  });
}
