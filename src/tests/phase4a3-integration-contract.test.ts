import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("Phase 4A.3 operational navigation continuity", () => {
  it("carries a vehicle-scoped issue link through the page and API query", () => {
    const page = source("src/app/companies/[companyId]/issues/page.tsx");
    const workspace = source("src/app/companies/[companyId]/issues/workspace.tsx");
    expect(page).toContain("initialVehicleId={vehicleId");
    expect(workspace).toContain('query.set("vehicleId", vehicleId)');
    expect(workspace).toContain("Clear vehicle filter");
  });

  it("offers generated issues immediately after a failed inspection", () => {
    const workspace = source("src/app/companies/[companyId]/inspections/workspace.tsx");
    expect(workspace).toContain('result.data.outcome === "FAIL"');
    expect(workspace).toContain("View generated issues");
    expect(workspace).toContain("/issues?vehicleId=${failedVehicleId}");
  });

  it("keeps anomalous odometer confirmation inside the inspection flow", () => {
    const workspace = source("src/app/companies/[companyId]/inspections/workspace.tsx");
    expect(workspace).toContain("result.data.result?.confirmationToken");
    expect(workspace).toContain("Confirm odometer and submit");
    expect(workspace).toContain("confirmationToken ? { confirmationToken } : {}");
  });
});
