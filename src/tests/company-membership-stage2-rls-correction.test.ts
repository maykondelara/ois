import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath =
  "prisma/migrations/20260906000200_company_membership_stage2_read_scope_correction/migration.sql";

describe("company membership Stage 2 read-scope correction", () => {
  it("makes bootstrap self scope and tenant scope mutually exclusive without changing writes", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("DROP POLICY memberships_select_bootstrap_or_tenant");
    expect(sql).toContain("CREATE POLICY memberships_select_bootstrap_or_tenant");
    expect(sql).toContain("FOR SELECT");
    expect(sql).toContain("CASE");
    expect(sql).toContain(
      "WHEN NULLIF(current_setting('app.current_company_id', true), '') IS NULL",
    );
    expect(sql).toContain(
      "user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid",
    );
    expect(sql).toContain(
      "company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid",
    );
    expect(sql).not.toContain("FOR INSERT");
    expect(sql).not.toContain("FOR UPDATE");
    expect(sql).not.toContain("FOR DELETE");
  });
});
