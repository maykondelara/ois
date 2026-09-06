import { prisma } from "@/db/prisma";
import { vehicleDto } from "@/lib/http/dto";
import { tenantRoute } from "@/lib/http/api";
import { resolveVehicleRegistration } from "@/modules/vehicles/vehicle.service";
import { TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const registration = new URL(request.url).searchParams.get("registration");
  return tenantRoute(request, await params, async (context) => {
    if (!registration)
      throw new ValidationError("MISSING_REGISTRATION", "registration is required");
    const vehicle = await resolveVehicleRegistration(prisma, context, registration);
    if (!vehicle) throw new TenantRecordNotFoundError("Vehicle");
    return { data: vehicleDto(vehicle) };
  });
}
