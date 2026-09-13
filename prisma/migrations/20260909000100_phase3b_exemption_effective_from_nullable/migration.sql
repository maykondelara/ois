-- Phase 3B.2 corrective migration: NULL means no known lower interval bound.
-- The Phase 3B.1 migration remains immutable.
ALTER TABLE compliance_requirement_exemptions
  ALTER COLUMN effective_from DROP NOT NULL;

ALTER TABLE compliance_requirement_exemptions
  DROP CONSTRAINT compliance_requirement_exemptions_check1;

ALTER TABLE compliance_requirement_exemptions
  ADD CONSTRAINT compliance_requirement_exemptions_effective_date_range_check
  CHECK (effective_from IS NULL OR expires_on IS NULL OR effective_from <= expires_on);
