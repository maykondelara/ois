/**
 * Loads the exact alias-dependent application graph used by migration-runner.
 * It does not create a Prisma client, read environment variables, or connect to a database.
 */
import "../src/db/tenant-transaction";
import "../src/modules/activities/audit.service";
import "../src/modules/companies/location.repository";
import "../src/modules/companies/operational-settings.service";
import "../src/modules/drivers/driver-licence.service";
import "../src/modules/drivers/driver.service";
import "../src/modules/identity/tenant-context.service";
import "../src/modules/vehicles/odometer.service";
import "../src/modules/vehicles/vehicle-category.service";
import "../src/modules/vehicles/vehicle.service";

console.log("application_import_smoke: PASS");
