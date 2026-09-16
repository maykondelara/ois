import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { categoryDto, licenceDto } from "@/lib/http/dto";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Phase 4A.1 operational HTTP and UI contract", () => {
  it("provides the company shell and operational routes", () => {
    for (const file of [
      "src/app/companies/[companyId]/layout.tsx",
      "src/app/companies/[companyId]/page.tsx",
      "src/app/companies/[companyId]/drivers/page.tsx",
      "src/app/companies/[companyId]/vehicles/page.tsx",
      "src/app/companies/[companyId]/compliance/page.tsx",
      "src/app/api/companies/[companyId]/vehicles/[vehicleId]/status-history/route.ts",
    ])
      expect(fs.existsSync(path.join(root, file)), file).toBe(true);
    const navigation = source("src/app/companies/[companyId]/navigation.tsx");
    for (const label of ["Overview", "Drivers", "Vehicles", "Compliance", "Inspections", "Issues"])
      expect(navigation).toContain(`"${label}"`);
  });

  it("never exposes protected licence material in the public DTO", () => {
    const dto = licenceDto({
      id: "licence-id",
      driverId: "driver-id",
      licenceType: "DRIVER_LICENCE",
      issuingJurisdiction: "WA",
      licenceNumberLast4: "1234",
      issuedOn: null,
      expiresOn: new Date("2030-01-01T00:00:00.000Z"),
    });
    expect(dto).toMatchObject({ licenceNumberLast4: "1234" });
    expect(JSON.stringify(dto)).not.toMatch(/cipher|hash|encrypt|licenceNumber(?!Last4)/i);
  });

  it("exposes the accepted licence requirement for operational category selection", () => {
    const dto = categoryDto({
      id: "category-id",
      companyId: "company-id",
      code: "HR_TRUCK",
      name: "Heavy rigid truck",
      requiredLicenceClass: "HR",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(dto.requiredLicenceClass).toBe("HR");
  });
});
