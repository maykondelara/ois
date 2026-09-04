/**
 * Loads the exact alias-dependent application graph used by migration-runner.
 * It does not create a Prisma client, read environment variables, or connect to a database.
 */
import "../src/db/tenant-transaction";
import "../src/modules/activities/audit.service";
import "../src/modules/companies/location.repository";
import "../src/modules/identity/tenant-context.service";

console.log("application_import_smoke: PASS");
