import { prisma } from "@/db/prisma";
import { tenantRoute } from "@/lib/http/api";
import { revokeDriverVehicleCapability } from "@/modules/drivers/driver.service";
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ companyId: string; driverId: string; categoryId: string }> },
) {
  const value = await params;
  return tenantRoute(request, value, async (context) => {
    await revokeDriverVehicleCapability(prisma, context, value.driverId, value.categoryId);
    return { data: null };
  });
}
