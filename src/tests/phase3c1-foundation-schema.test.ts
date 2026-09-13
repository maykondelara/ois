import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = new URL(
  "../../prisma/migrations/20260913000100_phase3c_inspection_engine_foundation/migration.sql",
  import.meta.url,
);

describe("Phase 3C.1 inspection foundation migration", () => {
  it("defines versioned tenant tables, RLS and the odometer inspection FK", async () => {
    const sql = await readFile(migration, "utf8");
    for (const table of [
      "inspection_templates",
      "inspection_template_versions",
      "inspection_sections",
      "inspection_questions",
      "inspection_question_options",
      "inspection_template_category_applicabilities",
      "inspection_template_vehicle_applicabilities",
      "inspection_submissions",
      "inspection_responses",
      "inspection_response_options",
      "inspection_response_files",
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY ${table}_tenant`);
    }
    expect(sql).toContain("vehicle_odometer_readings_source_inspection_fk");
    expect(sql).toContain("FOREIGN KEY (company_id, source_inspection_id)");
    expect(sql).toContain("UNIQUE(company_id, template_id, version)");
  });
});
