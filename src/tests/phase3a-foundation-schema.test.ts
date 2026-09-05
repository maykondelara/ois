import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const phase3Tables = [
  "company_operational_settings",
  "vehicle_categories",
  "drivers",
  "driver_regular_availability",
  "driver_licences",
  "driver_vehicle_capabilities",
  "vehicles",
  "vehicle_status_history",
  "vehicle_odometer_readings",
];

describe("Phase 3A.1 schema migration", () => {
  it("contains only approved Phase 3A foundation tables and tenant RLS protections", async () => {
    const migration = await readFile(
      "prisma/migrations/20260905000100_phase3a_drivers_vehicles_foundation/migration.sql",
      "utf8",
    );
    for (const table of phase3Tables) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("vehicle_odometer_readings_one_review_required_per_vehicle_idx");
    expect(migration).toContain("enforce_odometer_review_gate");
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).not.toContain("SECURITY DEFINER");
    expect(migration).not.toContain("current_odometer");
  });

  it("preserves composite tenant-safe references and excludes deferred modules", async () => {
    const migration = await readFile(
      "prisma/migrations/20260905000100_phase3a_drivers_vehicles_foundation/migration.sql",
      "utf8",
    );
    expect(migration).toContain("REFERENCES locations(company_id, id)");
    expect(migration).toContain("REFERENCES vehicle_categories(company_id, id)");
    expect(migration).toContain("REFERENCES drivers(company_id, id)");
    expect(migration).toContain("REFERENCES vehicles(company_id, id)");
    expect(migration).not.toContain("CREATE TABLE inspections");
    expect(migration).not.toContain("CREATE TABLE defects");
    expect(migration).not.toContain("CREATE TABLE document_files");
  });
});
