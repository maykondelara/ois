import { randomBytes } from "node:crypto";

// Local smoke-only configuration. It proves tsx can load the route graph without a database call.
process.env.AUTH_SECRET ??= randomBytes(32).toString("base64url");
process.env.APP_URL ??= "https://ois-import-smoke.test";

async function main() {
  await Promise.all([
    import("../src/app/api/companies/[companyId]/drivers/route"),
    import("../src/app/api/companies/[companyId]/drivers/[driverId]/route"),
    import("../src/app/api/companies/[companyId]/drivers/[driverId]/status/route"),
    import("../src/app/api/companies/[companyId]/drivers/[driverId]/user-link/route"),
    import("../src/app/api/companies/[companyId]/drivers/[driverId]/availability/route"),
    import("../src/app/api/companies/[companyId]/drivers/[driverId]/vehicle-capabilities/route"),
    import("../src/app/api/companies/[companyId]/drivers/[driverId]/vehicle-capabilities/[categoryId]/route"),
    import("../src/app/api/companies/[companyId]/drivers/[driverId]/licences/route"),
    import("../src/app/api/companies/[companyId]/drivers/[driverId]/licences/[licenceId]/route"),
    import("../src/app/api/companies/[companyId]/operational-settings/route"),
    import("../src/app/api/companies/[companyId]/operational-settings/initialize/route"),
    import("../src/app/api/companies/[companyId]/vehicle-categories/route"),
    import("../src/app/api/companies/[companyId]/vehicle-categories/[categoryId]/route"),
    import("../src/app/api/companies/[companyId]/vehicles/route"),
    import("../src/app/api/companies/[companyId]/vehicles/resolve-registration/route"),
    import("../src/app/api/companies/[companyId]/vehicles/[vehicleId]/route"),
    import("../src/app/api/companies/[companyId]/vehicles/[vehicleId]/status/route"),
    import("../src/app/api/companies/[companyId]/vehicles/[vehicleId]/next-service-odometer/route"),
    import("../src/app/api/companies/[companyId]/vehicles/[vehicleId]/odometer/route"),
    import("../src/app/api/companies/[companyId]/vehicles/[vehicleId]/odometer-readings/route"),
    import("../src/app/api/companies/[companyId]/vehicles/[vehicleId]/odometer-readings/[readingId]/review/route"),
  ]);

  console.log("phase3a3_api_route_import_smoke: PASS");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "API route import smoke failed");
  process.exitCode = 1;
});
