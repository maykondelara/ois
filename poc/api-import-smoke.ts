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
    import("../src/app/api/companies/[companyId]/drivers/[driverId]/licences/[licenceId]/files/route"),
    import("../src/app/api/companies/[companyId]/drivers/[driverId]/licences/[licenceId]/files/[licenceFileId]/route"),
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
    import("../src/app/api/companies/[companyId]/document-types/route"),
    import("../src/app/api/companies/[companyId]/document-types/[documentTypeId]/route"),
    import("../src/app/api/companies/[companyId]/compliance/requirements/route"),
    import("../src/app/api/companies/[companyId]/compliance/requirements/[requirementId]/route"),
    import("../src/app/api/companies/[companyId]/compliance/requirements/[requirementId]/change-applicability/route"),
    import("../src/app/api/companies/[companyId]/compliance/requirements/[requirementId]/assignments/route"),
    import("../src/app/api/companies/[companyId]/compliance/requirements/[requirementId]/assignments/[assignmentId]/route"),
    import("../src/app/api/companies/[companyId]/compliance/requirements/[requirementId]/exemptions/route"),
    import("../src/app/api/companies/[companyId]/compliance/requirements/[requirementId]/exemptions/[exemptionId]/revoke/route"),
    import("../src/app/api/companies/[companyId]/documents/route"),
    import("../src/app/api/companies/[companyId]/documents/[documentId]/route"),
    import("../src/app/api/companies/[companyId]/documents/[documentId]/approve/route"),
    import("../src/app/api/companies/[companyId]/documents/[documentId]/reject/route"),
    import("../src/app/api/companies/[companyId]/documents/[documentId]/archive/route"),
    import("../src/app/api/companies/[companyId]/documents/[documentId]/revoke/route"),
    import("../src/app/api/companies/[companyId]/documents/[documentId]/files/route"),
    import("../src/app/api/companies/[companyId]/documents/[documentId]/files/[documentFileId]/route"),
    import("../src/app/api/companies/[companyId]/compliance/drivers/[driverId]/route"),
    import("../src/app/api/companies/[companyId]/compliance/vehicles/[vehicleId]/route"),
    import("../src/app/api/companies/[companyId]/compliance/company/route"),
    import("../src/app/api/companies/[companyId]/compliance/summary/route"),
  ]);

  console.log("phase3a3_api_route_import_smoke: PASS");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "API route import smoke failed");
  process.exitCode = 1;
});
