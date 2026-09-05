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

REVOKE CREATE ON SCHEMA public FROM :"runtime_role";
