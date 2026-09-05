-- Correct the prior tenant-read SELECT policy so its Stage 1 and Stage 2
-- branches are mutually exclusive. When a current company has been set by an
-- authorized TenantContext, membership visibility is limited to that company.
-- Membership write policies are intentionally unchanged.

DROP POLICY memberships_select_bootstrap_or_tenant ON company_memberships;

CREATE POLICY memberships_select_bootstrap_or_tenant ON company_memberships
  FOR SELECT
  USING (
    CASE
      -- Stage 1: no tenant has been established, so only self-memberships are
      -- available for bootstrap validation.
      WHEN NULLIF(current_setting('app.current_company_id', true), '') IS NULL
        THEN user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      -- Stage 2: both settings are required and visibility is tenant-scoped.
      ELSE
        NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
        AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    END
  );
