import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = new URL(
  "../../prisma/migrations/20260913000200_phase3c2_draft_configuration_soft_removal/migration.sql",
  import.meta.url,
);

describe("Phase 3C.2 draft configuration soft removal", () => {
  it("adds lifecycle flags and active-only ordering without weakening tenant security", async () => {
    const sql = await readFile(migration, "utf8");
    for (const table of [
      "inspection_sections",
      "inspection_questions",
      "inspection_question_options",
    ]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table}\\s+ADD COLUMN is_active`));
    }
    expect(sql.match(/CREATE UNIQUE INDEX/g)).toHaveLength(3);
    expect(sql.match(/WHERE is_active/g)).toHaveLength(3);
    expect(sql).not.toMatch(/DROP TABLE|DROP POLICY|DISABLE ROW LEVEL SECURITY|DELETE FROM/i);
    expect(sql).not.toMatch(/GRANT|REVOKE/i);
  });
});
