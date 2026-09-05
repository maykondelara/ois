-- Phase 3A.2 prerequisite: preserve Stage 1 self-membership bootstrap while
-- allowing an already-authorized Stage 2 tenant transaction to inspect
-- memberships in its selected tenant. This migration intentionally changes
-- SELECT only; writes retain the existing self-scoped checks.

DROP POLICY memberships_user_bootstrap ON company_memberships;

-- Stage 1: an authenticated user can discover only their own memberships.
-- Stage 2: after application-level membership validation has established both
-- transaction-local settings, membership administration may inspect members
-- of the authorized current company. A company setting alone never grants
-- visibility because the authenticated-user setting is also required.
CREATE POLICY memberships_select_bootstrap_or_tenant ON company_memberships
  FOR SELECT
  USING (
    user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR (
      NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
      AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    )
  );

-- Preserve the original FOR ALL policy's write behavior without allowing the
-- permissive SELECT policy to broaden INSERT, UPDATE, or DELETE.
CREATE POLICY memberships_insert_self ON company_memberships
  FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY memberships_update_self ON company_memberships
  FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY memberships_delete_self ON company_memberships
  FOR DELETE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
