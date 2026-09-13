import type { DriverLicenceClass } from "@prisma/client";
import {
  effectiveVehicleAuthorization,
  legalLicenceEntitlement,
  type EffectiveVehicleAuthorization,
} from "@/modules/compliance/compliance-domain";

export function evaluateDriverVehicleEligibility(
  input: Readonly<{
    heldLicenceClass: DriverLicenceClass | null;
    requiredLicenceClass: DriverLicenceClass | null;
    companyAuthorizationActive: boolean;
  }>,
): EffectiveVehicleAuthorization {
  return effectiveVehicleAuthorization(
    legalLicenceEntitlement(input.heldLicenceClass, input.requiredLicenceClass),
    input.companyAuthorizationActive,
  );
}
