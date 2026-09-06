/**
 * HTTP acceptance manifest for the isolated Railway validation harness.
 * It deliberately declares the route-level checkpoints without replacing the
 * existing Phase 2, Phase 3A.1, Phase 3A.2, or membership-RLS checks.
 */
export const phase3a3ApiAcceptanceCheckpoints = [
  "phase3a3_api_authentication",
  "phase3a3_api_tenant_selection",
  "phase3a3_api_driver_crud",
  "phase3a3_api_driver_self_read",
  "phase3a3_api_driver_availability",
  "phase3a3_api_driver_categories",
  "phase3a3_api_driver_licence_redaction",
  "phase3a3_api_operational_settings",
  "phase3a3_api_vehicle_categories",
  "phase3a3_api_vehicle_crud",
  "phase3a3_api_vehicle_status",
  "phase3a3_api_vehicle_registration_resolution",
  "phase3a3_api_odometer_normal",
  "phase3a3_api_odometer_anomaly",
  "phase3a3_api_odometer_review",
  "phase3a3_api_authorization",
  "phase3a3_api_error_mapping",
  "phase3a3_api_cross_tenant_isolation",
  "phase3a3_api_observability_redaction",
] as const;

/**
 * Ensures the executable HTTP runner cannot finish without emitting every
 * checkpoint declared for Phase 3A.3 acceptance.
 */
// eslint-disable-next-line no-unused-vars
export function createPhase3a3CheckpointLedger(emit: (name: string, passed: boolean) => void) {
  const required = new Set<string>(phase3a3ApiAcceptanceCheckpoints);
  const emitted = new Set<string>();

  return {
    checkpoint(name: string, passed: boolean) {
      if (required.has(name) && emitted.has(name))
        throw new Error(`Phase 3A.3 checkpoint emitted more than once: ${name}`);
      emit(name, passed);
      if (required.has(name)) emitted.add(name);
    },
    assertComplete() {
      const missing = phase3a3ApiAcceptanceCheckpoints.filter((name) => !emitted.has(name));
      if (missing.length > 0)
        throw new Error(`Phase 3A.3 acceptance checkpoint(s) not emitted: ${missing.join(", ")}`);
    },
  };
}
