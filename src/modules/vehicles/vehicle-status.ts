import type { VehicleOperationalStatus } from "@prisma/client";
import { ValidationError } from "@/lib/errors";

export function validateManualVehicleStatusTransition(
  fromStatus: VehicleOperationalStatus,
  toStatus: VehicleOperationalStatus,
  reason: string | undefined,
) {
  if (fromStatus === toStatus)
    throw new ValidationError("INVALID_STATUS_TRANSITION", "Vehicle status is already set");
  const requiresReason = fromStatus === "OUT_OF_SERVICE" || toStatus === "OUT_OF_SERVICE";
  if (requiresReason && !reason?.trim())
    throw new ValidationError(
      "MISSING_OUT_OF_SERVICE_REASON",
      "A status-transition reason is required",
    );
}
