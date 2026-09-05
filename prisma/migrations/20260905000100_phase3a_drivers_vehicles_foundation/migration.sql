-- Phase 3A.1: Drivers and Vehicles foundation. PostgreSQL 18 supplies uuidv7().
-- This migration intentionally excludes Phase 3B documents/compliance, Phase 3C inspections,
-- and Phase 3D defects/issues/release workflows.

CREATE TYPE "DriverOperationalStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ON_LEAVE');
CREATE TYPE "VehicleOperationalStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'OUT_OF_SERVICE');
CREATE TYPE "VehicleStatusTransitionSource" AS ENUM ('MANUAL', 'INSPECTION', 'DEFECT');
CREATE TYPE "OdometerReadingStatus" AS ENUM ('ACCEPTED', 'REVIEW_REQUIRED', 'REJECTED');
CREATE TYPE "OdometerReadingSource" AS ENUM ('INITIAL_ENTRY', 'MANUAL_ENTRY', 'INSPECTION');
CREATE TYPE "InspectionVehicleSelectionStrategy" AS ENUM ('SEARCH_SELECT', 'MANUAL_REGO', 'BOTH');

CREATE TABLE company_operational_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  odometer_expected_increase_threshold_km integer NOT NULL DEFAULT 1000 CHECK (odometer_expected_increase_threshold_km > 0),
  inspection_vehicle_selection_strategy "InspectionVehicleSelectionStrategy" NOT NULL DEFAULT 'BOTH',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicle_categories (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,62}$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, code),
  UNIQUE(company_id, id)
);

CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  phone_e164 text,
  operational_status "DriverOperationalStatus" NOT NULL DEFAULT 'ACTIVE',
  depot_location_id uuid,
  emergency_contact_name text,
  emergency_contact_phone_e164 text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, user_id),
  FOREIGN KEY (company_id, user_id) REFERENCES company_memberships(company_id, user_id),
  FOREIGN KEY (company_id, depot_location_id) REFERENCES locations(company_id, id)
);

CREATE TABLE driver_regular_availability (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_available boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, driver_id, day_of_week),
  FOREIGN KEY (company_id, driver_id) REFERENCES drivers(company_id, id) ON DELETE CASCADE
);

CREATE TABLE driver_licences (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  licence_type text NOT NULL DEFAULT 'DRIVER_LICENCE' CHECK (length(btrim(licence_type)) > 0),
  issuing_jurisdiction text,
  licence_number_ciphertext text NOT NULL CHECK (length(licence_number_ciphertext) > 0),
  licence_number_lookup_hash bytea NOT NULL CHECK (octet_length(licence_number_lookup_hash) > 0),
  licence_number_last4 text NOT NULL CHECK (licence_number_last4 ~ '^[A-Z0-9]{4}$'),
  licence_number_key_version text NOT NULL CHECK (length(btrim(licence_number_key_version)) > 0),
  issued_on date,
  expires_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, licence_number_lookup_hash),
  FOREIGN KEY (company_id, driver_id) REFERENCES drivers(company_id, id) ON DELETE CASCADE
);

CREATE TABLE driver_vehicle_capabilities (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  vehicle_category_id uuid NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  authorized_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_on date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, driver_id, vehicle_category_id),
  FOREIGN KEY (company_id, driver_id) REFERENCES drivers(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, vehicle_category_id) REFERENCES vehicle_categories(company_id, id)
);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  registration_display text NOT NULL CHECK (length(btrim(registration_display)) > 0),
  registration_normalized text NOT NULL CHECK (registration_normalized ~ '^[A-Z0-9]+$'),
  vehicle_category_id uuid NOT NULL,
  depot_location_id uuid,
  operational_status "VehicleOperationalStatus" NOT NULL DEFAULT 'ACTIVE',
  registration_expires_on date,
  next_service_odometer_km integer CHECK (next_service_odometer_km >= 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, registration_normalized),
  FOREIGN KEY (company_id, vehicle_category_id) REFERENCES vehicle_categories(company_id, id),
  FOREIGN KEY (company_id, depot_location_id) REFERENCES locations(company_id, id)
);

CREATE TABLE vehicle_status_history (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL,
  from_status "VehicleOperationalStatus",
  to_status "VehicleOperationalStatus" NOT NULL,
  reason text,
  source "VehicleStatusTransitionSource" NOT NULL DEFAULT 'MANUAL',
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles(company_id, id) ON DELETE CASCADE,
  CHECK (to_status <> 'OUT_OF_SERVICE' OR length(btrim(COALESCE(reason, ''))) > 0)
);

CREATE TABLE vehicle_odometer_readings (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL,
  reading_km integer NOT NULL CHECK (reading_km >= 0),
  source "OdometerReadingSource" NOT NULL,
  status "OdometerReadingStatus" NOT NULL,
  reported_at timestamptz NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  review_note text,
  previous_accepted_reading_id uuid,
  previous_accepted_odometer_km integer,
  threshold_km_snapshot integer,
  difference_km integer,
  source_inspection_id uuid,
  UNIQUE(company_id, id),
  UNIQUE(company_id, vehicle_id, id),
  FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, vehicle_id, previous_accepted_reading_id) REFERENCES vehicle_odometer_readings(company_id, vehicle_id, id),
  CHECK (previous_accepted_odometer_km IS NULL OR previous_accepted_odometer_km >= 0),
  CHECK (threshold_km_snapshot IS NULL OR threshold_km_snapshot > 0),
  CHECK (difference_km IS NULL OR difference_km >= 0),
  CHECK ((status = 'ACCEPTED') = (accepted_at IS NOT NULL)),
  CHECK (
    source <> 'INITIAL_ENTRY'
    OR (previous_accepted_reading_id IS NULL AND previous_accepted_odometer_km IS NULL AND threshold_km_snapshot IS NULL AND difference_km IS NULL)
  ),
  CHECK (
    source = 'INITIAL_ENTRY'
    OR (previous_accepted_reading_id IS NOT NULL AND previous_accepted_odometer_km IS NOT NULL AND threshold_km_snapshot IS NOT NULL AND difference_km IS NOT NULL)
  )
);

CREATE INDEX vehicle_categories_company_active_idx ON vehicle_categories(company_id, is_active);
CREATE INDEX drivers_company_status_idx ON drivers(company_id, operational_status);
CREATE INDEX drivers_company_depot_idx ON drivers(company_id, depot_location_id);
CREATE INDEX driver_regular_availability_company_driver_idx ON driver_regular_availability(company_id, driver_id);
CREATE INDEX driver_licences_company_driver_expiry_idx ON driver_licences(company_id, driver_id, expires_on);
CREATE INDEX driver_vehicle_capabilities_company_driver_active_idx ON driver_vehicle_capabilities(company_id, driver_id, is_active);
CREATE INDEX vehicles_company_status_idx ON vehicles(company_id, operational_status);
CREATE INDEX vehicles_company_depot_idx ON vehicles(company_id, depot_location_id);
CREATE INDEX vehicle_status_history_company_vehicle_occurred_idx ON vehicle_status_history(company_id, vehicle_id, occurred_at DESC);
CREATE INDEX vehicle_odometer_readings_company_vehicle_accepted_idx ON vehicle_odometer_readings(company_id, vehicle_id, accepted_at DESC) WHERE status = 'ACCEPTED';
CREATE INDEX vehicle_odometer_readings_company_vehicle_status_idx ON vehicle_odometer_readings(company_id, vehicle_id, status);
CREATE UNIQUE INDEX vehicle_odometer_readings_one_review_required_per_vehicle_idx ON vehicle_odometer_readings(company_id, vehicle_id) WHERE status = 'REVIEW_REQUIRED';

-- Do not advance an authoritative chain while a distinct anomalous reading is unresolved.
-- The function is SECURITY INVOKER; no role escalation or RLS bypass is used.
CREATE FUNCTION enforce_odometer_review_gate() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF NEW.status = 'ACCEPTED' THEN
    PERFORM 1 FROM vehicles WHERE company_id = NEW.company_id AND id = NEW.vehicle_id FOR UPDATE;
    IF EXISTS (
      SELECT 1
      FROM vehicle_odometer_readings
      WHERE company_id = NEW.company_id
        AND vehicle_id = NEW.vehicle_id
        AND status = 'REVIEW_REQUIRED'
        AND id IS DISTINCT FROM NEW.id
    ) THEN
      RAISE EXCEPTION 'odometer review is pending for vehicle %', NEW.vehicle_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER vehicle_odometer_review_gate
  BEFORE INSERT OR UPDATE OF status ON vehicle_odometer_readings
  FOR EACH ROW EXECUTE FUNCTION enforce_odometer_review_gate();

ALTER TABLE company_operational_settings ENABLE ROW LEVEL SECURITY; ALTER TABLE company_operational_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE vehicle_categories ENABLE ROW LEVEL SECURITY; ALTER TABLE vehicle_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY; ALTER TABLE drivers FORCE ROW LEVEL SECURITY;
ALTER TABLE driver_regular_availability ENABLE ROW LEVEL SECURITY; ALTER TABLE driver_regular_availability FORCE ROW LEVEL SECURITY;
ALTER TABLE driver_licences ENABLE ROW LEVEL SECURITY; ALTER TABLE driver_licences FORCE ROW LEVEL SECURITY;
ALTER TABLE driver_vehicle_capabilities ENABLE ROW LEVEL SECURITY; ALTER TABLE driver_vehicle_capabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY; ALTER TABLE vehicles FORCE ROW LEVEL SECURITY;
ALTER TABLE vehicle_status_history ENABLE ROW LEVEL SECURITY; ALTER TABLE vehicle_status_history FORCE ROW LEVEL SECURITY;
ALTER TABLE vehicle_odometer_readings ENABLE ROW LEVEL SECURITY; ALTER TABLE vehicle_odometer_readings FORCE ROW LEVEL SECURITY;

CREATE POLICY company_operational_settings_tenant ON company_operational_settings USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY vehicle_categories_tenant ON vehicle_categories USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY drivers_tenant ON drivers USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY driver_regular_availability_tenant ON driver_regular_availability USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY driver_licences_tenant ON driver_licences USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY driver_vehicle_capabilities_tenant ON driver_vehicle_capabilities USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY vehicles_tenant ON vehicles USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY vehicle_status_history_tenant ON vehicle_status_history USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY vehicle_odometer_readings_tenant ON vehicle_odometer_readings USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
