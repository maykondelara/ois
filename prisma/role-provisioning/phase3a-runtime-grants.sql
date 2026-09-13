-- Execute only as the controlled migrator/provisioning role.
-- Replace :"runtime_role" with the deployment runtime login role.
-- This role must remain LOGIN NOINHERIT NOBYPASSRLS and must not own tables.

GRANT USAGE ON SCHEMA public TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON company_operational_settings TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON vehicle_categories TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON drivers TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON driver_regular_availability TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON driver_licences TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON driver_vehicle_capabilities TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON vehicles TO :"runtime_role";
GRANT SELECT, INSERT ON vehicle_status_history TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON vehicle_odometer_readings TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON document_types TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON compliance_requirements TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON compliance_requirement_assignments TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON compliance_requirement_exemptions TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON documents TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON stored_files TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON document_files TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON driver_licence_files TO :"runtime_role";
GRANT SELECT, INSERT ON document_review_history TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON inspection_templates TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON inspection_template_versions TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON inspection_sections TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON inspection_questions TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON inspection_question_options TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON inspection_template_category_applicabilities TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON inspection_template_vehicle_applicabilities TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON inspection_submissions TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON inspection_responses TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON inspection_response_options TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON inspection_response_files TO :"runtime_role";

REVOKE CREATE ON SCHEMA public FROM :"runtime_role";
