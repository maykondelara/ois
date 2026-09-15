import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { permissionCodes, rolePermissionMatrix } from "@/modules/identity/permissions";

const migration = new URL(
  "../../prisma/migrations/20260915000100_phase3d1_issues_resolution_vehicle_release/migration.sql",
  import.meta.url,
);
const grants = new URL(
  "../../prisma/role-provisioning/phase3a-runtime-grants.sql",
  import.meta.url,
);
const templateService = new URL(
  "../modules/inspections/inspection-template.service.ts",
  import.meta.url,
);

describe("Phase 3D.1 issue foundation", () => {
  it("defines tenant-safe issue history, actions and defect holds", async () => {
    const sql = await readFile(migration, "utf8");
    for (const table of [
      "issues",
      "issue_status_history",
      "issue_actions",
      "vehicle_defect_holds",
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY ${table}_tenant`);
    }
    expect(sql).toContain("UNIQUE(company_id, inspection_response_id)");
    expect(sql).toContain(
      "REFERENCES inspection_responses(company_id, id, template_version_id, question_id)",
    );
    expect(sql).not.toMatch(/SECURITY DEFINER|ON DELETE CASCADE/i);
  });

  it("grants no runtime DELETE and assigns minimal capabilities", async () => {
    const sql = await readFile(grants, "utf8");
    for (const table of ["issues", "issue_status_history", "issue_actions", "vehicle_defect_holds"])
      expect(sql).toMatch(new RegExp(`GRANT SELECT, (?:INSERT(?:, UPDATE)?) ON ${table}`));
    expect(sql).not.toMatch(/GRANT[^;]*DELETE/i);
    for (const permission of ["issues.read", "issues.manage", "issues.resolve", "vehicles.release"])
      expect(permissionCodes).toContain(permission);
    expect(rolePermissionMatrix.DRIVER).toContain("issues.read");
    expect(rolePermissionMatrix.DRIVER).not.toContain("issues.manage");
    expect(rolePermissionMatrix.DRIVER).not.toContain("issues.resolve");
    expect(rolePermissionMatrix.DRIVER).not.toContain("vehicles.release");
  });

  it("keeps operational impact draft-editable and clone-preserved", async () => {
    const source = await readFile(templateService, "utf8");
    expect(source).toContain("await activeDraftQuestion(tx, context, questionId)");
    expect(source).toContain('operationalImpact: input.operationalImpact ?? "NON_BLOCKING"');
    expect(source).toContain("operationalImpact: question.operationalImpact");
  });
});
