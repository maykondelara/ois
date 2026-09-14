-- Phase 3C.2: draft-only inspection configuration removal is lifecycle based.
-- Published versions remain immutable through the application service guards.

ALTER TABLE inspection_sections
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE inspection_questions
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE inspection_question_options
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;

ALTER TABLE inspection_sections
  DROP CONSTRAINT IF EXISTS inspection_sections_company_id_template_version_id_sort_order_key;
ALTER TABLE inspection_questions
  DROP CONSTRAINT IF EXISTS inspection_questions_company_id_template_version_id_section_id_sort_order_key;
ALTER TABLE inspection_question_options
  DROP CONSTRAINT IF EXISTS inspection_question_options_company_id_question_id_sort_order_key;

CREATE UNIQUE INDEX inspection_sections_active_order_key
  ON inspection_sections(company_id, template_version_id, sort_order)
  WHERE is_active;
CREATE UNIQUE INDEX inspection_questions_active_order_key
  ON inspection_questions(company_id, template_version_id, section_id, sort_order)
  WHERE is_active;
CREATE UNIQUE INDEX inspection_question_options_active_order_key
  ON inspection_question_options(company_id, question_id, sort_order)
  WHERE is_active;
