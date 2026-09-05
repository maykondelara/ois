import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath =
  "prisma/migrations/20260906000100_company_membership_tenant_read_rls_hardening/migration.sql";

describe("company membership tenant-read RLS hardening migration", () => {
  it("splits the historical FOR ALL policy into SELECT and self-scoped write policies", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("DROP POLICY memberships_user_bootstrap ON company_memberships");
    expect(sql).toContain("CREATE POLICY memberships_select_bootstrap_or_tenant");
    expect(sql).toContain("FOR SELECT");
    expect(sql).toContain("app.current_user_id");
    expect(sql).toContain("app.current_company_id");
    expect(sql).toContain("CREATE POLICY memberships_insert_self");
    expect(sql).toContain("CREATE POLICY memberships_update_self");
    expect(sql).toContain("CREATE POLICY memberships_delete_self");
    expect(sql).not.toMatch(/CREATE POLICY memberships_[^\n]+\n\s+FOR ALL/);
  });
});
