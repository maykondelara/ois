-- Phase 3B.1: Documents + Compliance database foundation only.
-- This migration intentionally does not implement storage, uploads, services,
-- compliance evaluation, API routes, or workflow behavior.

CREATE TYPE "ComplianceSubjectType" AS ENUM ('DRIVER', 'VEHICLE', 'COMPANY');
CREATE TYPE "EvidenceSourceType" AS ENUM ('DOCUMENT', 'DRIVER_LICENCE');
CREATE TYPE "RequirementApplicability" AS ENUM ('GLOBAL', 'SPECIFIC');
CREATE TYPE "DocumentReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "StoredFileState" AS ENUM ('PENDING', 'AVAILABLE', 'QUARANTINED');
CREATE TYPE "DriverLicenceFileRole" AS ENUM ('FRONT', 'BACK', 'COMBINED');
CREATE TYPE "DriverLicenceClass" AS ENUM ('C', 'LR', 'MR', 'HR', 'HC', 'MC');

CREATE TABLE document_types (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,62}$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  subject_type "ComplianceSubjectType" NOT NULL,
  evidence_source_type "EvidenceSourceType" NOT NULL,
  requires_issue_date boolean NOT NULL DEFAULT false,
  requires_expiry_date boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, code),
  UNIQUE(company_id, id, subject_type),
  CHECK (evidence_source_type <> 'DRIVER_LICENCE' OR subject_type = 'DRIVER')
);

CREATE TABLE compliance_requirements (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id),
  document_type_id uuid NOT NULL,
  subject_type "ComplianceSubjectType" NOT NULL,
  applicability "RequirementApplicability" NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  expiry_warning_days integer NOT NULL DEFAULT 30 CHECK (expiry_warning_days BETWEEN 0 AND 3650),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, id, subject_type),
  FOREIGN KEY (company_id, document_type_id, subject_type)
    REFERENCES document_types(company_id, id, subject_type),
  CHECK (subject_type <> 'COMPANY' OR applicability = 'GLOBAL')
);

CREATE TABLE compliance_requirement_assignments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id),
  requirement_id uuid NOT NULL,
  subject_type "ComplianceSubjectType" NOT NULL,
  driver_id uuid,
  vehicle_id uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  removed_at timestamptz,
  removed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  removal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  FOREIGN KEY (company_id, requirement_id, subject_type)
    REFERENCES compliance_requirements(company_id, id, subject_type),
  FOREIGN KEY (company_id, driver_id) REFERENCES drivers(company_id, id),
  FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles(company_id, id),
  CHECK (
    (subject_type = 'DRIVER' AND driver_id IS NOT NULL AND vehicle_id IS NULL)
    OR (subject_type = 'VEHICLE' AND vehicle_id IS NOT NULL AND driver_id IS NULL)
  ),
  CHECK (
    (removed_at IS NULL AND removed_by_user_id IS NULL AND removal_reason IS NULL)
    OR (removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL AND length(btrim(COALESCE(removal_reason, ''))) > 0)
  )
);

CREATE TABLE compliance_requirement_exemptions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id),
  requirement_id uuid NOT NULL,
  subject_type "ComplianceSubjectType" NOT NULL,
  driver_id uuid,
  vehicle_id uuid,
  company_subject_id uuid,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  effective_from date NOT NULL,
  expires_on date,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  FOREIGN KEY (company_id, requirement_id, subject_type)
    REFERENCES compliance_requirements(company_id, id, subject_type),
  FOREIGN KEY (company_id, driver_id) REFERENCES drivers(company_id, id),
  FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles(company_id, id),
  FOREIGN KEY (company_subject_id) REFERENCES companies(id),
  CHECK (
    (subject_type = 'DRIVER' AND driver_id IS NOT NULL AND vehicle_id IS NULL AND company_subject_id IS NULL)
    OR (subject_type = 'VEHICLE' AND vehicle_id IS NOT NULL AND driver_id IS NULL AND company_subject_id IS NULL)
    OR (subject_type = 'COMPANY' AND company_subject_id = company_id AND driver_id IS NULL AND vehicle_id IS NULL)
  ),
  CHECK (expires_on IS NULL OR effective_from <= expires_on),
  CHECK (
    (revoked_at IS NULL AND revoked_by_user_id IS NULL AND revocation_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL AND length(btrim(COALESCE(revocation_reason, ''))) > 0)
  )
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id),
  document_type_id uuid NOT NULL,
  subject_type "ComplianceSubjectType" NOT NULL,
  driver_id uuid,
  vehicle_id uuid,
  company_subject_id uuid,
  issue_date date,
  valid_from date,
  expiry_date date,
  review_status "DocumentReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  rejection_reason text,
  archived_at timestamptz,
  archived_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  revocation_reason text,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  FOREIGN KEY (company_id, document_type_id, subject_type)
    REFERENCES document_types(company_id, id, subject_type),
  FOREIGN KEY (company_id, driver_id) REFERENCES drivers(company_id, id),
  FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles(company_id, id),
  FOREIGN KEY (company_subject_id) REFERENCES companies(id),
  CHECK (
    (subject_type = 'DRIVER' AND driver_id IS NOT NULL AND vehicle_id IS NULL AND company_subject_id IS NULL)
    OR (subject_type = 'VEHICLE' AND vehicle_id IS NOT NULL AND driver_id IS NULL AND company_subject_id IS NULL)
    OR (subject_type = 'COMPANY' AND company_subject_id = company_id AND driver_id IS NULL AND vehicle_id IS NULL)
  ),
  CHECK (valid_from IS NULL OR expiry_date IS NULL OR valid_from <= expiry_date),
  CHECK (
    (review_status = 'PENDING_REVIEW' AND reviewed_at IS NULL AND reviewed_by_user_id IS NULL AND rejection_reason IS NULL)
    OR (review_status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND rejection_reason IS NULL)
    OR (review_status = 'REJECTED' AND reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND length(btrim(COALESCE(rejection_reason, ''))) > 0)
  ),
  CHECK ((archived_at IS NULL AND archived_by_user_id IS NULL) OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL)),
  CHECK (
    (revoked_at IS NULL AND revoked_by_user_id IS NULL AND revocation_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL AND length(btrim(COALESCE(revocation_reason, ''))) > 0)
  )
);

CREATE TABLE stored_files (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id),
  storage_provider text NOT NULL CHECK (length(btrim(storage_provider)) > 0),
  bucket text NOT NULL CHECK (length(btrim(bucket)) > 0),
  object_key text NOT NULL CHECK (length(btrim(object_key)) > 0),
  original_filename text NOT NULL CHECK (length(btrim(original_filename)) > 0),
  mime_type text,
  size_bytes integer,
  sha256 bytea,
  file_state "StoredFileState" NOT NULL DEFAULT 'PENDING',
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(storage_provider, bucket, object_key),
  CHECK (sha256 IS NULL OR octet_length(sha256) = 32),
  CHECK (
    file_state <> 'AVAILABLE'
    OR (
      mime_type IS NOT NULL
      AND size_bytes IS NOT NULL
      AND sha256 IS NOT NULL
      AND octet_length(sha256) = 32
      AND size_bytes > 0
      AND size_bytes <= 10485760
    )
  )
);

CREATE TABLE document_files (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id),
  document_id uuid NOT NULL,
  stored_file_id uuid NOT NULL,
  attached_at timestamptz NOT NULL DEFAULT now(),
  attached_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  removed_at timestamptz,
  removed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  removal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, stored_file_id),
  FOREIGN KEY (company_id, document_id) REFERENCES documents(company_id, id),
  FOREIGN KEY (company_id, stored_file_id) REFERENCES stored_files(company_id, id),
  CHECK (
    (removed_at IS NULL AND removed_by_user_id IS NULL AND removal_reason IS NULL)
    OR (removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL AND length(btrim(COALESCE(removal_reason, ''))) > 0)
  )
);

CREATE TABLE driver_licence_files (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id),
  driver_licence_id uuid NOT NULL,
  stored_file_id uuid NOT NULL,
  role "DriverLicenceFileRole" NOT NULL,
  attached_at timestamptz NOT NULL DEFAULT now(),
  attached_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  removed_at timestamptz,
  removed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  removal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, stored_file_id),
  FOREIGN KEY (company_id, driver_licence_id) REFERENCES driver_licences(company_id, id),
  FOREIGN KEY (company_id, stored_file_id) REFERENCES stored_files(company_id, id),
  CHECK (
    (removed_at IS NULL AND removed_by_user_id IS NULL AND removal_reason IS NULL)
    OR (removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL AND length(btrim(COALESCE(removal_reason, ''))) > 0)
  )
);

CREATE TABLE document_review_history (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id),
  document_id uuid NOT NULL,
  from_status "DocumentReviewStatus",
  to_status "DocumentReviewStatus" NOT NULL,
  reviewed_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  FOREIGN KEY (company_id, document_id) REFERENCES documents(company_id, id)
);

ALTER TABLE driver_licences
  ADD COLUMN licence_class "DriverLicenceClass",
  ADD COLUMN valid_from date,
  ADD COLUMN replaces_licence_id uuid,
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN revoked_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN revocation_reason text;

ALTER TABLE driver_licences
  ADD CONSTRAINT driver_licences_company_driver_id_id_key UNIQUE(company_id, driver_id, id);

ALTER TABLE driver_licences
  ADD CONSTRAINT driver_licences_replaces_licence_fk
    FOREIGN KEY (company_id, driver_id, replaces_licence_id)
    REFERENCES driver_licences(company_id, driver_id, id),
  ADD CONSTRAINT driver_licences_replaces_not_self_check
    CHECK (replaces_licence_id IS NULL OR replaces_licence_id <> id),
  ADD CONSTRAINT driver_licences_replaces_requires_valid_from_check
    CHECK (replaces_licence_id IS NULL OR valid_from IS NOT NULL),
  ADD CONSTRAINT driver_licences_revocation_consistency_check
    CHECK (
      (revoked_at IS NULL AND revoked_by_user_id IS NULL AND revocation_reason IS NULL)
      OR (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL AND length(btrim(COALESCE(revocation_reason, ''))) > 0)
    );

ALTER TABLE vehicle_categories
  ADD COLUMN required_licence_class "DriverLicenceClass";

UPDATE vehicle_categories
SET required_licence_class = CASE code
  WHEN 'VAN' THEN 'C'::"DriverLicenceClass"
  WHEN 'LR' THEN 'LR'::"DriverLicenceClass"
  WHEN 'MR' THEN 'MR'::"DriverLicenceClass"
  WHEN 'HR' THEN 'HR'::"DriverLicenceClass"
  WHEN 'HC' THEN 'HC'::"DriverLicenceClass"
  WHEN 'MC' THEN 'MC'::"DriverLicenceClass"
  ELSE required_licence_class
END
WHERE code IN ('VAN', 'LR', 'MR', 'HR', 'HC', 'MC');

CREATE UNIQUE INDEX document_types_one_active_driver_licence_source_idx
  ON document_types(company_id)
  WHERE is_active AND subject_type = 'DRIVER' AND evidence_source_type = 'DRIVER_LICENCE';
CREATE UNIQUE INDEX compliance_requirements_one_active_document_type_idx
  ON compliance_requirements(company_id, document_type_id)
  WHERE is_active;
CREATE UNIQUE INDEX compliance_requirement_assignments_one_active_driver_idx
  ON compliance_requirement_assignments(company_id, requirement_id, driver_id)
  WHERE removed_at IS NULL;
CREATE UNIQUE INDEX compliance_requirement_assignments_one_active_vehicle_idx
  ON compliance_requirement_assignments(company_id, requirement_id, vehicle_id)
  WHERE removed_at IS NULL;
CREATE UNIQUE INDEX driver_licence_files_one_active_role_idx
  ON driver_licence_files(company_id, driver_licence_id, role)
  WHERE removed_at IS NULL;
CREATE UNIQUE INDEX driver_licences_one_direct_successor_idx
  ON driver_licences(company_id, replaces_licence_id)
  WHERE replaces_licence_id IS NOT NULL;

CREATE INDEX document_types_company_subject_active_idx ON document_types(company_id, subject_type, is_active);
CREATE INDEX compliance_requirements_company_subject_active_idx ON compliance_requirements(company_id, subject_type, is_active);
CREATE INDEX compliance_requirement_assignments_company_requirement_active_idx ON compliance_requirement_assignments(company_id, requirement_id) WHERE removed_at IS NULL;
CREATE INDEX compliance_requirement_exemptions_company_requirement_subject_idx ON compliance_requirement_exemptions(company_id, requirement_id, subject_type);
CREATE INDEX documents_company_subject_review_idx ON documents(company_id, subject_type, review_status);
CREATE INDEX stored_files_company_state_idx ON stored_files(company_id, file_state);
CREATE INDEX document_files_company_document_active_idx ON document_files(company_id, document_id) WHERE removed_at IS NULL;
CREATE INDEX driver_licence_files_company_licence_active_idx ON driver_licence_files(company_id, driver_licence_id) WHERE removed_at IS NULL;
CREATE INDEX document_review_history_company_document_created_idx ON document_review_history(company_id, document_id, created_at DESC);

ALTER TABLE document_types ENABLE ROW LEVEL SECURITY; ALTER TABLE document_types FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance_requirements ENABLE ROW LEVEL SECURITY; ALTER TABLE compliance_requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance_requirement_assignments ENABLE ROW LEVEL SECURITY; ALTER TABLE compliance_requirement_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance_requirement_exemptions ENABLE ROW LEVEL SECURITY; ALTER TABLE compliance_requirement_exemptions FORCE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY; ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE stored_files ENABLE ROW LEVEL SECURITY; ALTER TABLE stored_files FORCE ROW LEVEL SECURITY;
ALTER TABLE document_files ENABLE ROW LEVEL SECURITY; ALTER TABLE document_files FORCE ROW LEVEL SECURITY;
ALTER TABLE driver_licence_files ENABLE ROW LEVEL SECURITY; ALTER TABLE driver_licence_files FORCE ROW LEVEL SECURITY;
ALTER TABLE document_review_history ENABLE ROW LEVEL SECURITY; ALTER TABLE document_review_history FORCE ROW LEVEL SECURITY;

CREATE POLICY document_types_tenant ON document_types USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY compliance_requirements_tenant ON compliance_requirements USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY compliance_requirement_assignments_tenant ON compliance_requirement_assignments USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY compliance_requirement_exemptions_tenant ON compliance_requirement_exemptions USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY documents_tenant ON documents USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY stored_files_tenant ON stored_files USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY document_files_tenant ON document_files USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY driver_licence_files_tenant ON driver_licence_files USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY document_review_history_tenant ON document_review_history USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
