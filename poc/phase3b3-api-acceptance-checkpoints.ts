/* eslint-disable no-unused-vars */
export const phase3b3ApiAcceptanceCheckpoints = [
  "phase3b3_api_authentication",
  "phase3b3_api_tenant_selection",
  "phase3b3_api_document_types",
  "phase3b3_api_requirements",
  "phase3b3_api_assignments",
  "phase3b3_api_exemptions",
  "phase3b3_api_documents",
  "phase3b3_api_document_review",
  "phase3b3_api_document_lifecycle",
  "phase3b3_api_document_files",
  "phase3b3_api_driver_licence_files",
  "phase3b3_api_driver_self_scope",
  "phase3b3_api_compliance_subjects",
  "phase3b3_api_compliance_summary",
  "phase3b3_api_cross_tenant_isolation",
  "phase3b3_api_error_mapping",
  "phase3b3_api_observability_redaction",
] as const;

export function createPhase3b3CheckpointLedger(emit: (name: string, passed: boolean) => void) {
  const required = new Set<string>(phase3b3ApiAcceptanceCheckpoints);
  const emitted = new Set<string>();
  return {
    checkpoint(name: string, passed: boolean) {
      if (required.has(name) && emitted.has(name))
        throw new Error(`Phase 3B.3 checkpoint emitted more than once: ${name}`);
      emit(name, passed);
      if (required.has(name)) emitted.add(name);
    },
    assertComplete() {
      const missing = phase3b3ApiAcceptanceCheckpoints.filter((name) => !emitted.has(name));
      if (missing.length)
        throw new Error(`Phase 3B.3 checkpoint(s) not emitted: ${missing.join(", ")}`);
    },
  };
}
