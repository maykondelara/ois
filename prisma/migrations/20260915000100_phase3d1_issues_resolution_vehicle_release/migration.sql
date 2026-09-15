-- Phase 3D.1: inspection-generated issues, append-only operational history,
-- explicit resolution, and conservative defect-hold vehicle release.

CREATE TYPE "InspectionOperationalImpact" AS ENUM ('NON_BLOCKING', 'VEHICLE_BLOCKING');
CREATE TYPE "IssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "IssueActionType" AS ENUM ('INSPECTION', 'REPAIR', 'OTHER');

ALTER TABLE inspection_questions
  ADD COLUMN operational_impact "InspectionOperationalImpact" NOT NULL DEFAULT 'NON_BLOCKING';

ALTER TABLE inspection_submissions
  ADD CONSTRAINT inspection_submissions_company_id_version_vehicle_id_key
  UNIQUE(company_id, id, template_version_id, vehicle_id);
ALTER TABLE vehicle_status_history
  ADD CONSTRAINT vehicle_status_history_company_vehicle_id_key
  UNIQUE(company_id, vehicle_id, id);

CREATE TABLE issues (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  inspection_submission_id uuid NOT NULL,
  inspection_response_id uuid NOT NULL,
  inspection_template_version_id uuid NOT NULL,
  inspection_question_id uuid NOT NULL,
  operational_impact "InspectionOperationalImpact" NOT NULL,
  severity "IssueSeverity" NOT NULL,
  status "IssueStatus" NOT NULL DEFAULT 'OPEN',
  vehicle_registration_snapshot text,
  template_name_snapshot text,
  question_label_snapshot text NOT NULL CHECK (length(btrim(question_label_snapshot)) > 0),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  resolution_notes text,
  closed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  UNIQUE(company_id, inspection_response_id),
  UNIQUE(company_id, vehicle_id, id),
  FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, inspection_submission_id, inspection_template_version_id, vehicle_id)
    REFERENCES inspection_submissions(company_id, id, template_version_id, vehicle_id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, inspection_response_id, inspection_template_version_id, inspection_question_id)
    REFERENCES inspection_responses(company_id, id, template_version_id, question_id) ON DELETE RESTRICT,
  CHECK (
    (status IN ('OPEN', 'IN_PROGRESS') AND resolved_by_user_id IS NULL AND resolved_at IS NULL AND resolution_notes IS NULL AND closed_by_user_id IS NULL AND closed_at IS NULL)
    OR (status = 'RESOLVED' AND resolved_by_user_id IS NOT NULL AND resolved_at IS NOT NULL AND length(btrim(COALESCE(resolution_notes, ''))) > 0 AND closed_by_user_id IS NULL AND closed_at IS NULL)
    OR (status = 'CLOSED' AND resolved_by_user_id IS NOT NULL AND resolved_at IS NOT NULL AND length(btrim(COALESCE(resolution_notes, ''))) > 0 AND closed_by_user_id IS NOT NULL AND closed_at IS NOT NULL)
  )
);

CREATE TABLE issue_status_history (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  from_status "IssueStatus",
  to_status "IssueStatus" NOT NULL,
  reason text,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  FOREIGN KEY (company_id, issue_id) REFERENCES issues(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE issue_actions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  action_type "IssueActionType" NOT NULL,
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  notes text,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, id),
  FOREIGN KEY (company_id, issue_id) REFERENCES issues(company_id, id) ON DELETE RESTRICT
);

CREATE TABLE vehicle_defect_holds (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  applied_status_history_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  release_status_history_id uuid,
  UNIQUE(company_id, id),
  UNIQUE(company_id, issue_id),
  FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, vehicle_id, issue_id) REFERENCES issues(company_id, vehicle_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, vehicle_id, applied_status_history_id) REFERENCES vehicle_status_history(company_id, vehicle_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, vehicle_id, release_status_history_id) REFERENCES vehicle_status_history(company_id, vehicle_id, id) ON DELETE RESTRICT,
  CHECK (
    (released_at IS NULL AND released_by_user_id IS NULL AND release_status_history_id IS NULL)
    OR (released_at IS NOT NULL AND released_by_user_id IS NOT NULL AND release_status_history_id IS NOT NULL)
  )
);

CREATE INDEX issues_company_vehicle_status_idx ON issues(company_id, vehicle_id, status);
CREATE INDEX issues_company_submission_idx ON issues(company_id, inspection_submission_id);
CREATE INDEX issue_status_history_company_issue_occurred_idx ON issue_status_history(company_id, issue_id, occurred_at);
CREATE INDEX issue_actions_company_issue_occurred_idx ON issue_actions(company_id, issue_id, occurred_at);
CREATE INDEX vehicle_defect_holds_company_vehicle_active_idx ON vehicle_defect_holds(company_id, vehicle_id) WHERE released_at IS NULL;

ALTER TABLE issues ENABLE ROW LEVEL SECURITY; ALTER TABLE issues FORCE ROW LEVEL SECURITY;
ALTER TABLE issue_status_history ENABLE ROW LEVEL SECURITY; ALTER TABLE issue_status_history FORCE ROW LEVEL SECURITY;
ALTER TABLE issue_actions ENABLE ROW LEVEL SECURITY; ALTER TABLE issue_actions FORCE ROW LEVEL SECURITY;
ALTER TABLE vehicle_defect_holds ENABLE ROW LEVEL SECURITY; ALTER TABLE vehicle_defect_holds FORCE ROW LEVEL SECURITY;

CREATE POLICY issues_tenant ON issues USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY issue_status_history_tenant ON issue_status_history USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY issue_actions_tenant ON issue_actions USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE POLICY vehicle_defect_holds_tenant ON vehicle_defect_holds USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
