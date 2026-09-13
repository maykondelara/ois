-- Phase 3C.1: versioned, tenant-isolated vehicle inspection configuration and submissions.
-- Published configuration and submitted operational history are protected by service lifecycle guards.

CREATE TYPE "InspectionTemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "InspectionResponseType" AS ENUM ('YES_NO', 'PASS_FAIL', 'TEXT', 'NUMBER', 'ODOMETER', 'PHOTO', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'CHECKBOX', 'SIGNATURE');
CREATE TYPE "InspectionCommentRule" AS ENUM ('NEVER', 'OPTIONAL', 'REQUIRED_ON_TRIGGER');
CREATE TYPE "InspectionPhotoRequirement" AS ENUM ('NEVER', 'ALWAYS', 'ON_FAILURE');
CREATE TYPE "InspectionApplicabilityMode" AS ENUM ('ALL_ELIGIBLE', 'VEHICLE_CATEGORIES', 'SPECIFIC_VEHICLES');
CREATE TYPE "InspectionSubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CANCELLED');
CREATE TYPE "InspectionResponseOutcome" AS ENUM ('PASS', 'FAIL', 'NEUTRAL');

CREATE TABLE inspection_templates (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,62}$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  current_published_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, code)
);

CREATE TABLE inspection_template_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  template_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status "InspectionTemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
  applicability_mode "InspectionApplicabilityMode" NOT NULL DEFAULT 'ALL_ELIGIBLE',
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  published_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, template_id, id),
  UNIQUE(company_id, template_id, version),
  FOREIGN KEY (company_id, template_id) REFERENCES inspection_templates(company_id, id) ON DELETE RESTRICT,
  CHECK (
    (status = 'DRAFT' AND published_at IS NULL AND published_by_user_id IS NULL)
    OR (status = 'PUBLISHED' AND published_at IS NOT NULL AND published_by_user_id IS NOT NULL)
  )
);

ALTER TABLE inspection_templates
  ADD CONSTRAINT inspection_templates_current_published_version_fk
  FOREIGN KEY (company_id, id, current_published_version_id)
  REFERENCES inspection_template_versions(company_id, template_id, id) ON DELETE RESTRICT;

CREATE TABLE inspection_sections (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  description text,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, template_version_id, id),
  UNIQUE(company_id, template_version_id, sort_order),
  FOREIGN KEY (company_id, template_version_id) REFERENCES inspection_template_versions(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE inspection_questions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL,
  section_id uuid NOT NULL,
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  help_text text,
  is_required boolean NOT NULL DEFAULT false,
  response_type "InspectionResponseType" NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  failure_boolean_value boolean,
  minimum_value numeric(14,2),
  maximum_value numeric(14,2),
  comment_rule "InspectionCommentRule" NOT NULL DEFAULT 'OPTIONAL',
  photo_requirement "InspectionPhotoRequirement" NOT NULL DEFAULT 'NEVER',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, template_version_id, id),
  UNIQUE(company_id, template_version_id, section_id, id),
  UNIQUE(company_id, template_version_id, section_id, sort_order),
  FOREIGN KEY (company_id, template_version_id, section_id) REFERENCES inspection_sections(company_id, template_version_id, id) ON DELETE RESTRICT,
  CHECK (minimum_value IS NULL OR maximum_value IS NULL OR minimum_value <= maximum_value),
  CHECK (
    (response_type IN ('YES_NO', 'CHECKBOX') AND (minimum_value IS NULL AND maximum_value IS NULL))
    OR (response_type IN ('NUMBER', 'ODOMETER') AND failure_boolean_value IS NULL)
    OR (response_type NOT IN ('YES_NO', 'CHECKBOX', 'NUMBER', 'ODOMETER') AND failure_boolean_value IS NULL AND minimum_value IS NULL AND maximum_value IS NULL)
  )
);

CREATE TABLE inspection_question_options (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL,
  question_id uuid NOT NULL,
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  is_failure boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, template_version_id, question_id, id),
  UNIQUE(company_id, question_id, sort_order),
  FOREIGN KEY (company_id, template_version_id, question_id) REFERENCES inspection_questions(company_id, template_version_id, id) ON DELETE RESTRICT
);

CREATE TABLE inspection_template_category_applicabilities (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL,
  vehicle_category_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, template_version_id, vehicle_category_id),
  FOREIGN KEY (company_id, template_version_id) REFERENCES inspection_template_versions(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, vehicle_category_id) REFERENCES vehicle_categories(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE inspection_template_vehicle_applicabilities (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, template_version_id, vehicle_id),
  FOREIGN KEY (company_id, template_version_id) REFERENCES inspection_template_versions(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE inspection_submissions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  template_id uuid NOT NULL,
  template_version_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  driver_id uuid,
  status "InspectionSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
  outcome "InspectionResponseOutcome",
  vehicle_registration_snapshot text,
  template_name_snapshot text,
  driver_display_name_snapshot text,
  started_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, id, template_version_id),
  FOREIGN KEY (company_id, template_id, template_version_id) REFERENCES inspection_template_versions(company_id, template_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, driver_id) REFERENCES drivers(company_id, id) ON DELETE RESTRICT,
  CHECK (
    (status = 'DRAFT' AND outcome IS NULL AND submitted_at IS NULL AND cancelled_at IS NULL AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL)
    OR (status = 'SUBMITTED' AND outcome IS NOT NULL AND submitted_at IS NOT NULL AND cancelled_at IS NULL AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL)
    OR (status = 'CANCELLED' AND outcome IS NULL AND submitted_at IS NULL AND cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL AND length(btrim(COALESCE(cancellation_reason, ''))) > 0)
  )
);

ALTER TABLE vehicle_odometer_readings
  ADD CONSTRAINT vehicle_odometer_readings_source_inspection_fk
  FOREIGN KEY (company_id, source_inspection_id) REFERENCES inspection_submissions(company_id, id) ON DELETE RESTRICT;

CREATE TABLE inspection_responses (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL,
  template_version_id uuid NOT NULL,
  question_id uuid NOT NULL,
  boolean_value boolean,
  text_value text,
  number_value numeric(14,2),
  odometer_value_km integer CHECK (odometer_value_km IS NULL OR odometer_value_km >= 0),
  comment text,
  outcome "InspectionResponseOutcome" NOT NULL DEFAULT 'NEUTRAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, submission_id, question_id),
  UNIQUE(company_id, id, template_version_id, question_id),
  FOREIGN KEY (company_id, submission_id, template_version_id) REFERENCES inspection_submissions(company_id, id, template_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, template_version_id, question_id) REFERENCES inspection_questions(company_id, template_version_id, id) ON DELETE RESTRICT
);

CREATE TABLE inspection_response_options (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  response_id uuid NOT NULL,
  template_version_id uuid NOT NULL,
  question_id uuid NOT NULL,
  question_option_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, response_id, question_option_id),
  FOREIGN KEY (company_id, response_id, template_version_id, question_id) REFERENCES inspection_responses(company_id, id, template_version_id, question_id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, template_version_id, question_id, question_option_id) REFERENCES inspection_question_options(company_id, template_version_id, question_id, id) ON DELETE RESTRICT
);

CREATE TABLE inspection_response_files (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  response_id uuid NOT NULL,
  stored_file_id uuid NOT NULL,
  attached_at timestamptz NOT NULL DEFAULT now(),
  attached_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  removed_at timestamptz,
  removed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  removal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, stored_file_id),
  FOREIGN KEY (company_id, response_id) REFERENCES inspection_responses(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, stored_file_id) REFERENCES stored_files(company_id, id) ON DELETE RESTRICT,
  CHECK (
    (removed_at IS NULL AND removed_by_user_id IS NULL AND removal_reason IS NULL)
    OR (removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL AND length(btrim(COALESCE(removal_reason, ''))) > 0)
  )
);

CREATE INDEX inspection_templates_company_active_idx ON inspection_templates(company_id, is_active);
CREATE INDEX inspection_template_versions_company_template_status_idx ON inspection_template_versions(company_id, template_id, status);
CREATE INDEX inspection_sections_company_version_order_idx ON inspection_sections(company_id, template_version_id, sort_order);
CREATE INDEX inspection_questions_company_version_section_order_idx ON inspection_questions(company_id, template_version_id, section_id, sort_order);
CREATE INDEX inspection_question_options_company_question_order_idx ON inspection_question_options(company_id, question_id, sort_order);
CREATE INDEX inspection_template_category_applicability_company_version_active_idx ON inspection_template_category_applicabilities(company_id, template_version_id) WHERE is_active;
CREATE INDEX inspection_template_vehicle_applicability_company_version_active_idx ON inspection_template_vehicle_applicabilities(company_id, template_version_id) WHERE is_active;
CREATE INDEX inspection_submissions_company_vehicle_status_idx ON inspection_submissions(company_id, vehicle_id, status);
CREATE INDEX inspection_responses_company_submission_idx ON inspection_responses(company_id, submission_id);
CREATE INDEX inspection_response_files_company_response_active_idx ON inspection_response_files(company_id, response_id) WHERE removed_at IS NULL;

ALTER TABLE inspection_templates ENABLE ROW LEVEL SECURITY; ALTER TABLE inspection_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_template_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE inspection_template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_sections ENABLE ROW LEVEL SECURITY; ALTER TABLE inspection_sections FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_questions ENABLE ROW LEVEL SECURITY; ALTER TABLE inspection_questions FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_question_options ENABLE ROW LEVEL SECURITY; ALTER TABLE inspection_question_options FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_template_category_applicabilities ENABLE ROW LEVEL SECURITY; ALTER TABLE inspection_template_category_applicabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_template_vehicle_applicabilities ENABLE ROW LEVEL SECURITY; ALTER TABLE inspection_template_vehicle_applicabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_submissions ENABLE ROW LEVEL SECURITY; ALTER TABLE inspection_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_responses ENABLE ROW LEVEL SECURITY; ALTER TABLE inspection_responses FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_response_options ENABLE ROW LEVEL SECURITY; ALTER TABLE inspection_response_options FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_response_files ENABLE ROW LEVEL SECURITY; ALTER TABLE inspection_response_files FORCE ROW LEVEL SECURITY;

CREATE POLICY inspection_templates_tenant ON inspection_templates USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY inspection_template_versions_tenant ON inspection_template_versions USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY inspection_sections_tenant ON inspection_sections USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY inspection_questions_tenant ON inspection_questions USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY inspection_question_options_tenant ON inspection_question_options USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY inspection_template_category_applicabilities_tenant ON inspection_template_category_applicabilities USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY inspection_template_vehicle_applicabilities_tenant ON inspection_template_vehicle_applicabilities USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY inspection_submissions_tenant ON inspection_submissions USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY inspection_responses_tenant ON inspection_responses USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY inspection_response_options_tenant ON inspection_response_options USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY inspection_response_files_tenant ON inspection_response_files USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
