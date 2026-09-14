/* eslint-disable no-unused-vars */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "../src/db/tenant-transaction";
import {
  changeDriverOperationalStatus,
  createDriver,
  getDriver,
  grantDriverVehicleCapability,
  linkDriverToUser,
  listDrivers,
  replaceDriverRegularAvailability,
  revokeDriverVehicleCapability,
  updateDriver,
} from "../src/modules/drivers/driver.service";
import {
  addDriverLicence,
  updateDriverLicence,
} from "../src/modules/drivers/driver-licence.service";
import { LicenceCrypto } from "../src/modules/drivers/licence-crypto";
import {
  getOperationalSettings,
  initializeOperationalDefaults,
  updateOperationalSettings,
} from "../src/modules/companies/operational-settings.service";
import {
  createVehicleCategory,
  listVehicleCategories,
  updateVehicleCategory,
} from "../src/modules/vehicles/vehicle-category.service";
import {
  changeManualVehicleStatus,
  createVehicle,
  getVehicle,
  listVehicles,
  resolveVehicleRegistration,
  updateNextServiceOdometer,
  updateVehicle,
} from "../src/modules/vehicles/vehicle.service";
import {
  getVehicleOperationalSnapshot,
  reviewOdometerReading,
  submitManualOdometerReading,
} from "../src/modules/vehicles/odometer.service";
import { OdometerConfirmationTokenService } from "../src/modules/vehicles/odometer-confirmation";
import {
  consumePasswordReset,
  issuePasswordReset,
} from "../src/modules/identity/password-reset.service";
import { createPasswordResetToken } from "../src/modules/identity/password.service";
import { locationRepository } from "../src/modules/companies/location.repository";
import { seedFoundation } from "../src/modules/identity/seed.service";
import { resolveTenantContext } from "../src/modules/identity/tenant-context.service";
import { runPhase3a3ApiAcceptance } from "./api-acceptance-runner";
import { runPhase3b3ApiAcceptance } from "./phase3b3-api-acceptance-runner";
import { runPhase3b4ApiAcceptance } from "./phase3b4-api-acceptance-runner";
import { runPhase3b2PostgresAcceptance } from "./phase3b2-postgres-acceptance";

const url = process.env.DATABASE_URL ?? "";
const migrator = "ois_validation_migrator";
const runtime = "ois_validation_runtime";
const phase2Tables = [
  "companies",
  "users",
  "roles",
  "permissions",
  "role_permissions",
  "company_memberships",
  "locations",
  "activities",
  "accounts",
  "sessions",
  "verification_tokens",
  "password_reset_tokens",
];
const phase3aTables = [
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
const phase3bTables = [
  "document_types",
  "compliance_requirements",
  "compliance_requirement_assignments",
  "compliance_requirement_exemptions",
  "documents",
  "stored_files",
  "document_files",
  "driver_licence_files",
  "document_review_history",
];
const phase3cTables = [
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
];

const phase3aDeferredTables = [
  "driver_documents",
  "vehicle_documents",
  "inspection_template_items",
  "inspections",
  "inspection_items",
  "defects",
  "maintenance_records",
  "tasks",
  "notifications",
  "integrations",
  "integration_sync_runs",
  "external_entity_mappings",
  "ai_insights",
  "outbox_events",
];
const membershipTenantReadMigration =
  "prisma/migrations/20260906000100_company_membership_tenant_read_rls_hardening/migration.sql";
const membershipStage2ScopeCorrectionMigration =
  "prisma/migrations/20260906000200_company_membership_stage2_read_scope_correction/migration.sql";
const phase3bFoundationMigration =
  "prisma/migrations/20260906000300_phase3b_documents_compliance_foundation/migration.sql";
const phase3bExemptionEffectiveFromNullableMigration =
  "prisma/migrations/20260909000100_phase3b_exemption_effective_from_nullable/migration.sql";
const phase3cFoundationMigration =
  "prisma/migrations/20260913000100_phase3c_inspection_engine_foundation/migration.sql";
const phase3cSoftRemovalMigration =
  "prisma/migrations/20260913000200_phase3c2_draft_configuration_soft_removal/migration.sql";
const hardenedMembershipPolicies = [
  "memberships_select_bootstrap_or_tenant",
  "memberships_insert_self",
  "memberships_update_self",
  "memberships_delete_self",
];
const password = randomBytes(32).toString("hex");
const admin = new Client({ connectionString: url });
const quoteIdentifier = (s: string) => `"${s.replaceAll('"', '""')}"`;
const db = url ? new URL(url).pathname.slice(1) : "";
const runtimeUrl = () => {
  const u = new URL(url);
  u.username = runtime;
  u.password = password;
  u.searchParams.set("connection_limit", "1");
  return u.toString();
};

async function isDenied(operation: () => Promise<unknown>) {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}

/** Expected PostgreSQL authorization failures must roll back before the runner continues. */
async function isExpectedPermissionDenied(operation: () => Promise<unknown>) {
  try {
    await operation();
    return false;
  } catch (error) {
    if ((error as { code?: string }).code !== "42501") throw error;
    return true;
  }
}

async function isDomainError(
  operation: () => Promise<unknown>,
  expectedCode: string,
): Promise<boolean> {
  try {
    await operation();
    return false;
  } catch (error) {
    if ((error as { code?: string }).code === expectedCode) return true;
    throw error;
  }
}

function checkpoint(name: string, passed: boolean) {
  console.log(`${name}: ${passed ? "PASS" : "FAIL"}`);
  if (!passed) throw new Error(`${name} failed`);
}

async function withinTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = 15_000,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function main() {
  if (!url) throw new Error("DATABASE_URL missing inside Railway validation service");
  await admin.connect();
  console.log("validation_role_reconciliation: START");
  for (const role of [migrator, runtime]) {
    const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]);
    if (exists.rowCount === 0)
      await admin.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    else await admin.query(`ALTER ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
  }
  await admin.query(`GRANT CONNECT, CREATE ON DATABASE ${quoteIdentifier(db)} TO ${migrator}`);
  await admin.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(db)} TO ${runtime}`);
  await admin.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${migrator}`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${runtime}`);
  await admin.query(`REVOKE CREATE ON SCHEMA public FROM ${runtime}`);
  console.log("validation_role_reconciliation: PASS");
  const m = new Client({
    connectionString: (() => {
      const u = new URL(url);
      u.username = migrator;
      u.password = password;
      return u.toString();
    })(),
  });
  await m.connect();
  await m.query("SET search_path TO public");
  const tables = await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  const present = new Set(tables.rows.map((x) => x.tablename));
  if (phase2Tables.every((name) => present.has(name)))
    console.log("migration_apply: PASS (already applied)");
  else if (phase2Tables.some((name) => present.has(name)))
    throw new Error(
      "migration_apply: FAIL partial validation schema detected; manual review required before retry",
    );
  else {
    console.log("migration_apply: START");
    await m.query(
      await readFile("prisma/migrations/20260902000100_lean_phase2_initial/migration.sql", "utf8"),
    );
    console.log("migration_apply: PASS");
  }
  const phase3aPresent = new Set(
    (await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(
      (x) => x.tablename,
    ),
  );
  if (phase3aTables.every((name) => phase3aPresent.has(name))) {
    console.log("phase3a_migration_apply: PASS (already applied)");
  } else if (phase3aTables.some((name) => phase3aPresent.has(name))) {
    throw new Error(
      "phase3a_migration_apply: FAIL partial Phase 3A validation schema detected; manual review required before retry",
    );
  } else {
    console.log("phase3a_migration_apply: START");
    await m.query(
      await readFile(
        "prisma/migrations/20260905000100_phase3a_drivers_vehicles_foundation/migration.sql",
        "utf8",
      ),
    );
    console.log("phase3a_migration_apply: PASS");
  }
  const phase3bPresent = new Set(
    (await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(
      (x) => x.tablename,
    ),
  );
  if (phase3bTables.every((name) => phase3bPresent.has(name))) {
    console.log("phase3b_migration_apply: PASS (already applied)");
  } else if (phase3bTables.some((name) => phase3bPresent.has(name))) {
    throw new Error(
      "phase3b_migration_apply: FAIL partial Phase 3B validation schema detected; manual review required before retry",
    );
  } else {
    console.log("phase3b_migration_apply: START");
    await m.query("BEGIN");
    try {
      await m.query(await readFile(phase3bFoundationMigration, "utf8"));
      await m.query("COMMIT");
    } catch (error) {
      await m.query("ROLLBACK");
      throw error;
    }
    console.log("phase3b_migration_apply: PASS");
  }
  const exemptionEffectiveFrom = await admin.query(
    "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='compliance_requirement_exemptions' AND column_name='effective_from'",
  );
  if (exemptionEffectiveFrom.rows[0]?.is_nullable === "YES") {
    console.log(
      "phase3b_exemption_effective_from_nullable_migration_apply: PASS (already applied)",
    );
  } else if (exemptionEffectiveFrom.rows[0]?.is_nullable === "NO") {
    console.log("phase3b_exemption_effective_from_nullable_migration_apply: START");
    await m.query(await readFile(phase3bExemptionEffectiveFromNullableMigration, "utf8"));
    console.log("phase3b_exemption_effective_from_nullable_migration_apply: PASS");
  } else {
    throw new Error(
      "phase3b_exemption_effective_from_nullable_migration_apply: FAIL expected exemption effective_from column is missing",
    );
  }
  const phase3cPresent = new Set(
    (await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(
      (x) => x.tablename,
    ),
  );

  if (phase3cTables.every((name) => phase3cPresent.has(name))) {
    console.log("phase3c_migration_apply: PASS (already applied)");
  } else if (phase3cTables.some((name) => phase3cPresent.has(name))) {
    throw new Error(
      "phase3c_migration_apply: FAIL partial Phase 3C validation schema detected; manual review required before retry",
    );
  } else {
    console.log("phase3c_migration_apply: START");
    await m.query("BEGIN");
    try {
      await m.query(await readFile(phase3cFoundationMigration, "utf8"));
      await m.query("COMMIT");
    } catch (error) {
      await m.query("ROLLBACK");
      throw error;
    }
    console.log("phase3c_migration_apply: PASS");
  }

  const phase3cSoftRemovalColumns = await admin.query(
    "SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='is_active' AND table_name = ANY($1::text[])",
    [["inspection_sections", "inspection_questions", "inspection_question_options"]],
  );
  const phase3cSoftRemovalTables = new Set(
    phase3cSoftRemovalColumns.rows.map((row) => row.table_name),
  );

  if (phase3cSoftRemovalTables.size === 3) {
    console.log("phase3c_soft_removal_migration_apply: PASS (already applied)");
  } else if (phase3cSoftRemovalTables.size === 0) {
    console.log("phase3c_soft_removal_migration_apply: START");
    await m.query(await readFile(phase3cSoftRemovalMigration, "utf8"));
    console.log("phase3c_soft_removal_migration_apply: PASS");
  } else {
    throw new Error(
      "phase3c_soft_removal_migration_apply: FAIL partial Phase 3C.2 migration state detected; manual review required before retry",
    );
  }

  const membershipPolicies = await admin.query(
    "SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='company_memberships'",
  );
  const membershipPolicyNames = new Set(membershipPolicies.rows.map((row) => row.policyname));
  if (hardenedMembershipPolicies.every((name) => membershipPolicyNames.has(name))) {
    console.log("membership_tenant_read_rls_migration_apply: PASS (already applied)");
  } else if (membershipPolicyNames.has("memberships_user_bootstrap")) {
    console.log("membership_tenant_read_rls_migration_apply: START");
    await m.query(await readFile(membershipTenantReadMigration, "utf8"));
    console.log("membership_tenant_read_rls_migration_apply: PASS");
  } else {
    throw new Error(
      "membership_tenant_read_rls_migration_apply: FAIL partial membership policy state detected; manual review required before retry",
    );
  }
  const membershipSelectExpression = await admin.query(
    "SELECT pg_get_expr(policy.polqual, policy.polrelid) AS expression FROM pg_policy policy JOIN pg_class relation ON relation.oid=policy.polrelid WHERE relation.relname='company_memberships' AND policy.polname='memberships_select_bootstrap_or_tenant'",
  );
  if (String(membershipSelectExpression.rows[0]?.expression).includes("CASE")) {
    console.log("membership_stage2_scope_correction_migration_apply: PASS (already applied)");
  } else if (membershipSelectExpression.rowCount === 1) {
    console.log("membership_stage2_scope_correction_migration_apply: START");
    await m.query(await readFile(membershipStage2ScopeCorrectionMigration, "utf8"));
    console.log("membership_stage2_scope_correction_migration_apply: PASS");
  } else {
    throw new Error(
      "membership_stage2_scope_correction_migration_apply: FAIL expected SELECT policy is missing; manual review required before retry",
    );
  }
  await m.query(
    `GRANT USAGE ON SCHEMA public TO ${runtime}; GRANT SELECT,UPDATE ON users TO ${runtime}; GRANT SELECT ON roles,permissions,role_permissions TO ${runtime}; GRANT SELECT,INSERT,UPDATE ON companies,company_memberships,locations,activities,password_reset_tokens TO ${runtime}; GRANT SELECT,INSERT,DELETE ON sessions TO ${runtime}`,
  );
  await m.query(
    (await readFile("prisma/role-provisioning/phase3a-runtime-grants.sql", "utf8")).replaceAll(
      ':"runtime_role"',
      quoteIdentifier(runtime),
    ),
  );
  await m.end();
  const r = new Client({ connectionString: runtimeUrl() });
  await r.connect();
  const runtimeRoleCheck = await admin.query("SELECT rolbypassrls FROM pg_roles WHERE rolname=$1", [
    runtime,
  ]);
  const flags = await admin.query(
    "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('companies','company_memberships','locations','activities')",
  );
  const phase3aRlsFlags = await admin.query(
    "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[])",
    [phase3aTables],
  );
  const phase3bRlsFlags = await admin.query(
    "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[])",
    [phase3bTables],
  );
  const migratedTables = await admin.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  checkpoint(
    "schema_validation",
    phase2Tables.every((name) => migratedTables.rows.some((x) => x.tablename === name)),
  );
  checkpoint(
    "phase3a_schema_validation",
    phase3aTables.every((name) => migratedTables.rows.some((x) => x.tablename === name)) &&
      phase3aDeferredTables.every((name) => !migratedTables.rows.some((x) => x.tablename === name)),
  );
  checkpoint("runtime_nobypassrls", runtimeRoleCheck.rows[0]?.rolbypassrls === false);
  checkpoint(
    "rls_validation",
    flags.rows.every((x) => x.relrowsecurity && x.relforcerowsecurity),
  );
  checkpoint(
    "phase3a_rls_validation",
    phase3aRlsFlags.rows.length === phase3aTables.length &&
      phase3aRlsFlags.rows.every((x) => x.relrowsecurity && x.relforcerowsecurity),
  );
  checkpoint(
    "phase3b_schema_validation",
    phase3bTables.every((name) => migratedTables.rows.some((x) => x.tablename === name)),
  );
  checkpoint(
    "phase3b_rls_validation",
    phase3bRlsFlags.rows.length === phase3bTables.length &&
      phase3bRlsFlags.rows.every((x) => x.relrowsecurity && x.relforcerowsecurity),
  );
  const phase3bUuidDefaults = await admin.query(
    "SELECT c.relname, pg_get_expr(d.adbin, d.adrelid) AS expression FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum JOIN pg_class c ON c.oid=d.adrelid WHERE c.relname = ANY($1::text[]) AND a.attname='id'",
    [phase3bTables],
  );
  const phase3bConstraintRows = await admin.query(
    "SELECT pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE c.relname = ANY($1::text[])",
    [[...phase3bTables, "driver_licences", "vehicle_categories"]],
  );
  const phase3bConstraintDefinitions = phase3bConstraintRows.rows
    .map((row) => String(row.definition))
    .join("\n");
  const phase3bIndexes = await admin.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename = ANY($1::text[])",
    [[...phase3bTables, "driver_licences"]],
  );
  const phase3bIndexNames = new Set(phase3bIndexes.rows.map((row) => row.indexname));
  checkpoint(
    "phase3b_uuidv7_defaults",
    phase3bUuidDefaults.rows.length === phase3bTables.length &&
      phase3bUuidDefaults.rows.every((row) => String(row.expression).includes("uuidv7()")),
  );
  checkpoint(
    "phase3b_tenant_safe_constraints",
    phase3bConstraintDefinitions.includes(
      "FOREIGN KEY (company_id, document_type_id, subject_type) REFERENCES document_types(company_id, id, subject_type)",
    ) &&
      phase3bConstraintDefinitions.includes(
        "FOREIGN KEY (company_id, requirement_id, subject_type) REFERENCES compliance_requirements(company_id, id, subject_type)",
      ) &&
      phase3bConstraintDefinitions.includes(
        "FOREIGN KEY (company_id, driver_id) REFERENCES drivers(company_id, id)",
      ) &&
      phase3bConstraintDefinitions.includes(
        "FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles(company_id, id)",
      ) &&
      phase3bConstraintDefinitions.includes(
        "FOREIGN KEY (company_id, driver_id, replaces_licence_id) REFERENCES driver_licences(company_id, driver_id, id)",
      ),
  );
  checkpoint(
    "phase3b_indexes_validation",
    phase3bIndexNames.has("document_types_one_active_driver_licence_source_idx") &&
      phase3bIndexNames.has("compliance_requirements_one_active_document_type_idx") &&
      phase3bIndexNames.has("compliance_requirement_assignments_one_active_driver_idx") &&
      phase3bIndexNames.has("compliance_requirement_assignments_one_active_vehicle_idx") &&
      phase3bIndexNames.has("driver_licence_files_one_active_role_idx") &&
      phase3bIndexNames.has("driver_licences_one_direct_successor_idx"),
  );
  const phase3bRuntimePrivileges = await admin.query(
    "SELECT has_table_privilege($1, 'documents', 'SELECT,INSERT,UPDATE') AS documents, has_table_privilege($1, 'document_review_history', 'SELECT,INSERT') AS review_history, has_table_privilege($1, 'document_review_history', 'UPDATE') AS review_history_update, has_table_privilege($1, 'document_review_history', 'DELETE') AS review_history_delete, has_table_privilege($1, 'stored_files', 'DELETE') AS stored_files_delete",
    [runtime],
  );
  checkpoint(
    "phase3b_runtime_grants",
    phase3bRuntimePrivileges.rows[0]?.documents === true &&
      phase3bRuntimePrivileges.rows[0]?.review_history === true &&
      phase3bRuntimePrivileges.rows[0]?.review_history_update === false &&
      phase3bRuntimePrivileges.rows[0]?.review_history_delete === false &&
      phase3bRuntimePrivileges.rows[0]?.stored_files_delete === false,
  );
  console.log(JSON.stringify({ tables: migratedTables.rows.map((x) => x.tablename) }));
  console.log("bootstrap_rls_matrix: START");
  await admin.query(
    "TRUNCATE activities, inspection_response_files, inspection_response_options, inspection_responses, inspection_submissions, inspection_template_vehicle_applicabilities, inspection_template_category_applicabilities, inspection_question_options, inspection_questions, inspection_sections, inspection_template_versions, inspection_templates, document_review_history, document_files, driver_licence_files, documents, stored_files, compliance_requirement_assignments, compliance_requirement_exemptions, compliance_requirements, document_types, vehicle_status_history, vehicle_odometer_readings, driver_vehicle_capabilities, driver_licences, driver_regular_availability, drivers, vehicles, vehicle_categories, company_operational_settings, locations, company_memberships, accounts, sessions, password_reset_tokens, verification_tokens, companies, users",
  );
  // Seed only capability/role definitions before creating isolated acceptance fixtures.
  const permissionSeedPrisma = new PrismaClient({ datasources: { db: { url } } });
  await seedFoundation(permissionSeedPrisma);
  await permissionSeedPrisma.$disconnect();
  const seeded = await admin.query(
    "INSERT INTO users(email,account_status,updated_at) VALUES ('a@validation.test','ACTIVE',now()),('b@validation.test','ACTIVE',now()),('inactive@validation.test','ACTIVE',now()),('driver@validation.test','ACTIVE',now()) RETURNING id,email",
  );
  const a = seeded.rows.find((x) => x.email === "a@validation.test").id;
  const b = seeded.rows.find((x) => x.email === "b@validation.test").id;
  const inactiveUser = seeded.rows.find((x) => x.email === "inactive@validation.test").id;
  const driverUser = seeded.rows.find((x) => x.email === "driver@validation.test").id;
  const rs = await admin.query(
    "INSERT INTO roles(code,name) VALUES ('OWNER','Owner') ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name RETURNING id",
  );
  const seedRoleId = rs.rows[0].id;
  const driverRole = await admin.query(
    "INSERT INTO roles(code,name) VALUES ('DRIVER','Driver') ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name RETURNING id",
  );
  const driverRoleId = driverRole.rows[0].id;
  const companies = await admin.query(
    "INSERT INTO companies(name,slug,updated_at) VALUES ('A','validation-a',now()),('B','validation-b',now()),('I','validation-i',now()) RETURNING id,slug",
  );
  const ca = companies.rows.find((x) => x.slug === "validation-a").id,
    cb = companies.rows.find((x) => x.slug === "validation-b").id,
    ci = companies.rows.find((x) => x.slug === "validation-i").id;
  await admin.query(
    "INSERT INTO company_memberships(company_id,user_id,role_id,status,updated_at) VALUES ($1,$2,$5,'ACTIVE',now()),($3,$4,$5,'ACTIVE',now()),($1,$6,$5,'INACTIVE',now()),($1,$7,$8,'ACTIVE',now()),($9,$2,$5,'INACTIVE',now())",
    [ca, a, cb, b, seedRoleId, inactiveUser, driverUser, driverRoleId, ci],
  );
  const companyRead = await admin.query(
    "INSERT INTO permissions(code,description) VALUES ('company.read','Validation permission') ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description RETURNING id",
  );
  await admin.query(
    "INSERT INTO role_permissions(role_id,permission_id) VALUES ($1,$2) ON CONFLICT(role_id,permission_id) DO NOTHING",
    [seedRoleId, companyRead.rows[0].id],
  );
  const driversManage = await admin.query(
    "INSERT INTO permissions(code,description) VALUES ('drivers.manage','Validation permission') ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description RETURNING id",
  );
  await admin.query(
    "INSERT INTO role_permissions(role_id,permission_id) VALUES ($1,$2) ON CONFLICT(role_id,permission_id) DO NOTHING",
    [seedRoleId, driversManage.rows[0].id],
  );
  const tx = async (user: string, company?: string) => {
    await r.query("BEGIN");
    await r.query("SELECT set_config('app.current_user_id',$1,true)", [user]);
    if (company) await r.query("SELECT set_config('app.current_company_id',$1,true)", [company]);
    return r;
  };
  const inRuntimeTenant = async <T>(
    userId: string,
    companyId: string | undefined,
    operation: (client: Client) => Promise<T>,
  ) => {
    const client = await tx(userId, companyId);
    try {
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  };
  const noCompanyDocumentTypes = await r.query("SELECT id FROM document_types");
  const documentTypeA = await inRuntimeTenant(a, ca, async (client) => {
    const result = await client.query(
      "INSERT INTO document_types(company_id,code,name,subject_type,evidence_source_type) VALUES ($1,'RLS_DRIVER','RLS driver evidence','DRIVER','DOCUMENT') RETURNING id",
      [ca],
    );
    return result.rows[0].id as string;
  });
  const documentTypeB = await inRuntimeTenant(b, cb, async (client) => {
    const result = await client.query(
      "INSERT INTO document_types(company_id,code,name,subject_type,evidence_source_type) VALUES ($1,'RLS_DRIVER','RLS driver evidence','DRIVER','DOCUMENT') RETURNING id",
      [cb],
    );
    return result.rows[0].id as string;
  });
  const ownCompanyDocumentTypes = await inRuntimeTenant(a, ca, (client) =>
    client.query("SELECT id FROM document_types WHERE id=$1", [documentTypeA]),
  );
  const foreignDocumentTypes = await inRuntimeTenant(a, ca, (client) =>
    client.query("SELECT id FROM document_types WHERE id=$1", [documentTypeB]),
  );
  const foreignDocumentTypeWrite = await inRuntimeTenant(a, ca, (client) =>
    client.query("UPDATE document_types SET name='blocked' WHERE id=$1", [documentTypeB]),
  );
  checkpoint(
    "phase3b_runtime_rls_isolation",
    noCompanyDocumentTypes.rowCount === 0 &&
      ownCompanyDocumentTypes.rowCount === 1 &&
      foreignDocumentTypes.rowCount === 0 &&
      foreignDocumentTypeWrite.rowCount === 0,
  );
  const noMembershipContext = await r.query(
    "SELECT company_id::text, user_id::text FROM company_memberships",
  );
  const stage1Memberships = await inRuntimeTenant(a, undefined, (client) =>
    client.query(
      "SELECT company_id::text, user_id::text FROM company_memberships ORDER BY company_id",
    ),
  );
  const stage1OtherUser = await inRuntimeTenant(a, undefined, (client) =>
    client.query("SELECT id FROM company_memberships WHERE user_id=$1", [inactiveUser]),
  );
  const stage1OtherCompany = await inRuntimeTenant(a, undefined, (client) =>
    client.query("SELECT id FROM company_memberships WHERE company_id=$1", [cb]),
  );
  checkpoint("membership_no_context_denied", noMembershipContext.rowCount === 0);
  checkpoint(
    "membership_stage1_self_scope",
    stage1Memberships.rowCount === 2 &&
      stage1Memberships.rows.every((row) => row.user_id === a) &&
      stage1OtherUser.rowCount === 0 &&
      stage1OtherCompany.rowCount === 0,
  );
  const stage2ContextSettings = await inRuntimeTenant(a, ca, (client) =>
    client.query(
      "SELECT current_setting('app.current_user_id', true) AS current_user_id, current_setting('app.current_company_id', true) AS current_company_id",
    ),
  );
  checkpoint(
    "membership_stage2_transaction_context",
    stage2ContextSettings.rows[0]?.current_user_id === a &&
      stage2ContextSettings.rows[0]?.current_company_id === ca,
  );
  const stage2Memberships = await inRuntimeTenant(a, ca, (client) =>
    client.query(
      "SELECT company_id::text, user_id::text, status FROM company_memberships ORDER BY user_id",
    ),
  );
  const stage2OtherCompany = await inRuntimeTenant(a, ca, (client) =>
    client.query("SELECT id FROM company_memberships WHERE company_id=$1", [cb]),
  );
  checkpoint(
    "membership_stage2_tenant_scope",
    stage2Memberships.rowCount === 3 &&
      stage2Memberships.rows.every((row) => row.company_id === ca) &&
      stage2Memberships.rows.some(
        (row) => row.user_id === inactiveUser && row.status === "INACTIVE",
      ) &&
      stage2Memberships.rows.some((row) => row.user_id === driverUser && row.status === "ACTIVE") &&
      stage2OtherCompany.rowCount === 0,
  );
  const membershipPrivileges = await admin.query(
    "SELECT has_table_privilege($1, 'company_memberships', 'INSERT') AS can_insert, has_table_privilege($1, 'company_memberships', 'UPDATE') AS can_update, has_table_privilege($1, 'company_memberships', 'DELETE') AS can_delete",
    [runtime],
  );
  checkpoint(
    "membership_runtime_grant_profile",
    membershipPrivileges.rows[0]?.can_insert === true &&
      membershipPrivileges.rows[0]?.can_update === true &&
      membershipPrivileges.rows[0]?.can_delete === false,
  );
  const membershipInsertDeniedByRls = await isExpectedPermissionDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO company_memberships(company_id,user_id,role_id,status,updated_at) VALUES ($1,$2,$3,'ACTIVE',now())",
        [ca, b, seedRoleId],
      ),
    ),
  );
  const membershipUpdate = await inRuntimeTenant(a, ca, (client) =>
    client.query(
      "UPDATE company_memberships SET status='INACTIVE' WHERE company_id=$1 AND user_id=$2",
      [ca, inactiveUser],
    ),
  );
  const membershipDeleteDeniedByTablePrivilege = await isExpectedPermissionDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query("DELETE FROM company_memberships WHERE company_id=$1 AND user_id=$2", [
        ca,
        inactiveUser,
      ]),
    ),
  );
  checkpoint(
    "membership_write_regression",
    membershipInsertDeniedByRls &&
      membershipUpdate.rowCount === 0 &&
      membershipDeleteDeniedByTablePrivilege,
  );
  const uuidDefaults = await admin.query(
    "SELECT c.relname, pg_get_expr(d.adbin, d.adrelid) AS expression FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum JOIN pg_class c ON c.oid=d.adrelid WHERE c.relname = ANY($1::text[]) AND a.attname='id'",
    [phase3aTables.filter((table) => table !== "company_operational_settings")],
  );
  checkpoint(
    "phase3a_uuidv7_defaults",
    uuidDefaults.rows.length === phase3aTables.length - 1 &&
      uuidDefaults.rows.every((row) => String(row.expression).includes("uuidv7()")),
  );
  const phase3aConstraints = await admin.query(
    "SELECT pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE c.relname = ANY($1::text[])",
    [phase3aTables],
  );
  const constraintDefinitions = phase3aConstraints.rows
    .map((row) => String(row.definition))
    .join("\n");
  checkpoint(
    "phase3a_tenant_safe_constraints",
    constraintDefinitions.includes(
      "FOREIGN KEY (company_id, user_id) REFERENCES company_memberships(company_id, user_id)",
    ) &&
      constraintDefinitions.includes(
        "FOREIGN KEY (company_id, vehicle_category_id) REFERENCES vehicle_categories(company_id, id)",
      ) &&
      constraintDefinitions.includes(
        "FOREIGN KEY (company_id, vehicle_id) REFERENCES vehicles(company_id, id)",
      ),
  );
  const phase3aIndexes = await admin.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename = ANY($1::text[])",
    [phase3aTables],
  );
  const indexNames = new Set(phase3aIndexes.rows.map((row) => row.indexname));
  checkpoint(
    "phase3a_indexes_validation",
    indexNames.has("vehicle_odometer_readings_one_review_required_per_vehicle_idx") &&
      phase3aIndexes.rows.some(
        (row) =>
          String(row.indexdef).includes("registration_normalized") &&
          String(row.indexdef).includes("UNIQUE"),
      ),
  );
  const runtimePhase3aPrivileges = await admin.query(
    "SELECT has_table_privilege($1, 'vehicles', 'SELECT,INSERT,UPDATE') AS vehicles, has_table_privilege($1, 'vehicle_status_history', 'SELECT,INSERT') AS status_history, has_table_privilege($1, 'vehicle_odometer_readings', 'SELECT,INSERT,UPDATE') AS odometer",
    [runtime],
  );
  checkpoint(
    "phase3a_runtime_grants",
    Object.values(runtimePhase3aPrivileges.rows[0] ?? {}).every((value) => value === true),
  );
  await admin.query("INSERT INTO company_operational_settings(company_id) VALUES ($1),($2)", [
    ca,
    cb,
  ]);
  const categories = await admin.query(
    "INSERT INTO vehicle_categories(company_id,code,name,required_licence_class) VALUES ($1,'VAN','VAN','C'),($2,'VAN','VAN','C') RETURNING id,company_id",
    [ca, cb],
  );
  const categoryA = categories.rows.find((row) => row.company_id === ca).id;
  const categoryB = categories.rows.find((row) => row.company_id === cb).id;
  const vehicleA = await inRuntimeTenant(a, ca, async (client) => {
    const result = await client.query(
      "INSERT INTO vehicles(company_id,registration_display,registration_normalized,vehicle_category_id,updated_at) VALUES ($1,'A 100','A100',$2,now()) RETURNING id",
      [ca, categoryA],
    );
    return result.rows[0].id as string;
  });
  const vehicleB = await inRuntimeTenant(b, cb, async (client) => {
    const result = await client.query(
      "INSERT INTO vehicles(company_id,registration_display,registration_normalized,vehicle_category_id,updated_at) VALUES ($1,'A 100','A100',$2,now()) RETURNING id",
      [cb, categoryB],
    );
    return result.rows[0].id as string;
  });
  const duplicateCompanyRegistrationDenied = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO vehicles(company_id,registration_display,registration_normalized,vehicle_category_id,updated_at) VALUES ($1,'A-100','A100',$2,now())",
        [ca, categoryA],
      ),
    ),
  );
  checkpoint(
    "phase3a_registration_tenant_uniqueness",
    Boolean(vehicleB) && duplicateCompanyRegistrationDenied,
  );
  const outOfServiceWithoutReasonDenied = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO vehicle_status_history(company_id,vehicle_id,to_status,source,actor_user_id) VALUES ($1,$2,'OUT_OF_SERVICE','MANUAL',$3)",
        [ca, vehicleA, a],
      ),
    ),
  );
  const validOutOfServiceHistory = await inRuntimeTenant(a, ca, (client) =>
    client.query(
      "INSERT INTO vehicle_status_history(company_id,vehicle_id,to_status,reason,source,actor_user_id) VALUES ($1,$2,'OUT_OF_SERVICE','Validation safety hold','MANUAL',$3) RETURNING id",
      [ca, vehicleA, a],
    ),
  );
  checkpoint(
    "phase3a_out_of_service_history",
    outOfServiceWithoutReasonDenied && validOutOfServiceHistory.rowCount === 1,
  );
  const missingCompanyRows = await inRuntimeTenant(a, undefined, (client) =>
    client.query("SELECT id FROM vehicles"),
  );
  const missingCompanyInsertDenied = await isDenied(() =>
    inRuntimeTenant(a, undefined, (client) =>
      client.query(
        "INSERT INTO vehicles(company_id,registration_display,registration_normalized,vehicle_category_id,updated_at) VALUES ($1,'A 101','A101',$2,now())",
        [ca, categoryA],
      ),
    ),
  );
  const crossTenantVehicleRows = await inRuntimeTenant(a, ca, (client) =>
    client.query("SELECT id FROM vehicles WHERE id=$1", [vehicleB]),
  );
  const crossTenantVehicleWrite = await inRuntimeTenant(a, ca, (client) =>
    client.query("UPDATE vehicles SET registration_display='blocked' WHERE id=$1", [vehicleB]),
  );
  checkpoint(
    "phase3a_tenant_rls_isolation",
    missingCompanyRows.rows.length === 0 &&
      missingCompanyInsertDenied &&
      crossTenantVehicleRows.rows.length === 0 &&
      crossTenantVehicleWrite.rowCount === 0,
  );
  const crossTenantCompositeFkDenied = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO drivers(company_id,user_id,display_name,updated_at) VALUES ($1,$2,'Invalid tenant relationship',now())",
        [ca, b],
      ),
    ),
  );
  checkpoint("phase3a_cross_tenant_fk_rejected", crossTenantCompositeFkDenied);
  await inRuntimeTenant(a, ca, async (client) => {
    await client.query(
      "INSERT INTO vehicle_odometer_readings(company_id,vehicle_id,reading_km,source,status,reported_at,accepted_at,actor_user_id) VALUES ($1,$2,100000,'INITIAL_ENTRY','ACCEPTED',now(),now(),$3)",
      [ca, vehicleA, a],
    );
    await client.query(
      "INSERT INTO vehicle_odometer_readings(company_id,vehicle_id,reading_km,source,status,reported_at,actor_user_id,previous_accepted_reading_id,previous_accepted_odometer_km,threshold_km_snapshot,difference_km) SELECT $1,$2,110500,'MANUAL_ENTRY','REVIEW_REQUIRED',now(),$3,id,reading_km,1000,10500 FROM vehicle_odometer_readings WHERE company_id=$1 AND vehicle_id=$2 AND status='ACCEPTED'",
      [ca, vehicleA, a],
    );
  });
  const duplicateReviewDenied = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO vehicle_odometer_readings(company_id,vehicle_id,reading_km,source,status,reported_at,actor_user_id,previous_accepted_reading_id,previous_accepted_odometer_km,threshold_km_snapshot,difference_km) SELECT $1,$2,111000,'MANUAL_ENTRY','REVIEW_REQUIRED',now(),$3,id,reading_km,1000,11000 FROM vehicle_odometer_readings WHERE company_id=$1 AND vehicle_id=$2 AND status='ACCEPTED'",
        [ca, vehicleA, a],
      ),
    ),
  );
  const acceptedWhileReviewPendingDenied = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO vehicle_odometer_readings(company_id,vehicle_id,reading_km,source,status,reported_at,accepted_at,actor_user_id,previous_accepted_reading_id,previous_accepted_odometer_km,threshold_km_snapshot,difference_km) SELECT $1,$2,100100,'MANUAL_ENTRY','ACCEPTED',now(),now(),$3,id,reading_km,1000,100 FROM vehicle_odometer_readings WHERE company_id=$1 AND vehicle_id=$2 AND status='ACCEPTED'",
        [ca, vehicleA, a],
      ),
    ),
  );
  checkpoint(
    "phase3a_odometer_pending_review_invariants",
    duplicateReviewDenied && acceptedWhileReviewPendingDenied,
  );
  const odometerGateSecurity = await admin.query(
    "SELECT prosecdef FROM pg_proc WHERE proname='enforce_odometer_review_gate'",
  );
  checkpoint(
    "phase3a_odometer_gate_security_invoker",
    odometerGateSecurity.rows.length === 1 && odometerGateSecurity.rows[0]?.prosecdef === false,
  );
  let runtimeTransaction = await tx(a);
  const own = await runtimeTransaction.query("SELECT company_id FROM company_memberships");
  await runtimeTransaction.query("COMMIT");
  const none = await r.query("SELECT company_id FROM company_memberships");
  console.log(
    `bootstrap_user_scope: ${own.rows.length === 2 && none.rows.length === 0 ? "PASS" : "FAIL"}`,
  );
  runtimeTransaction = await tx(a, ca);
  const companyRows = await runtimeTransaction.query("SELECT id FROM companies");
  await runtimeTransaction.query("COMMIT");
  console.log(`companies_bootstrap_policy: ${companyRows.rows.length === 1 ? "PASS" : "FAIL"}`);
  runtimeTransaction = await tx(a, ca);
  const inserted = await runtimeTransaction.query(
    "INSERT INTO locations(company_id,name,updated_at) VALUES ($1,'A location',now()) RETURNING id",
    [ca],
  );
  await runtimeTransaction.query("COMMIT");
  runtimeTransaction = await tx(a, ca);
  const foreign = await runtimeTransaction.query("SELECT id FROM locations WHERE company_id=$1", [
    cb,
  ]);
  await runtimeTransaction.query("COMMIT");
  console.log(
    `tenant_cross_company_isolation: ${inserted.rowCount === 1 && foreign.rows.length === 0 ? "PASS" : "FAIL"}`,
  );
  const prisma = new PrismaClient({ datasources: { db: { url: runtimeUrl() } } });
  await prisma.$connect();
  let pooled = true;
  for (let i = 0; i < 100; i++) {
    const u = i % 2 ? a : b,
      c = i % 2 ? ca : cb;
    const rows = await prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.current_user_id', ${u}, true)`;
      await db.$executeRaw`SELECT set_config('app.current_company_id', ${c}, true)`;
      return db.$queryRaw<Array<{ company_id: string }>>`SELECT company_id::text FROM locations`;
    });
    if (rows.some((x) => x.company_id !== c)) pooled = false;
  }
  await prisma.$disconnect();
  console.log(`prisma_pool_context_isolation: ${pooled ? "PASS" : "FAIL"}`);
  const applicationPrisma = new PrismaClient({ datasources: { db: { url: runtimeUrl() } } });
  checkpoint(
    "membership_no_membership_denied",
    await isDenied(() => resolveTenantContext(applicationPrisma, { userId: a }, cb)),
  );
  checkpoint(
    "membership_inactive_denied",
    await isDenied(() => resolveTenantContext(applicationPrisma, { userId: a }, ci)),
  );
  checkpoint(
    "membership_unauthorized_company_denied",
    await isDenied(() => resolveTenantContext(applicationPrisma, { userId: b }, ca)),
  );
  const applicationContext = await resolveTenantContext(applicationPrisma, { userId: a }, ca);
  checkpoint("membership_active_allowed", applicationContext.companyId === ca);
  const applicationRows = await withTenantTransaction(
    applicationPrisma,
    applicationContext,
    async (tx) => locationRepository.list(tx, applicationContext),
  );
  const applicationContextB = await resolveTenantContext(applicationPrisma, { userId: b }, cb);
  const linkedDriver = await createDriver(applicationPrisma, applicationContext, {
    displayName: "Linked validation driver",
    userId: driverUser,
  });
  const inactiveDriverLinkDenied = await isDomainError(
    () =>
      linkDriverToUser(applicationPrisma, applicationContext, linkedDriver.id, {
        userId: inactiveUser,
      }),
    "INVALID_DRIVER_USER_LINK",
  );
  const crossCompanyDriverLinkDenied = await isDomainError(
    () => linkDriverToUser(applicationPrisma, applicationContext, linkedDriver.id, { userId: b }),
    "INVALID_DRIVER_USER_LINK",
  );
  const driverContext = await resolveTenantContext(applicationPrisma, { userId: driverUser }, ca);
  const ordinaryDriverCannotManage = await isDenied(() =>
    createDriver(applicationPrisma, driverContext, { displayName: "Forbidden validation driver" }),
  );
  const linkedDriverVisible = await withTenantTransaction(
    applicationPrisma,
    applicationContext,
    (tx) =>
      tx.driver.findUnique({ where: { companyId_id: { companyId: ca, id: linkedDriver.id } } }),
  );
  checkpoint(
    "application_driver_active_membership_link",
    linkedDriver.userId === driverUser && linkedDriverVisible?.userId === driverUser,
  );
  checkpoint(
    "application_driver_invalid_membership_link_denied",
    inactiveDriverLinkDenied && crossCompanyDriverLinkDenied,
  );
  checkpoint("application_driver_manage_authorization", ordinaryDriverCannotManage);
  const availability = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isAvailable: dayOfWeek < 5,
  }));
  const updatedDriver = await updateDriver(applicationPrisma, applicationContext, linkedDriver.id, {
    displayName: "Updated validation driver",
  });
  const suspendedDriver = await changeDriverOperationalStatus(
    applicationPrisma,
    applicationContext,
    linkedDriver.id,
    { status: "SUSPENDED" },
  );
  await replaceDriverRegularAvailability(
    applicationPrisma,
    applicationContext,
    linkedDriver.id,
    availability,
  );
  const invalidAvailabilityDenied = await isDenied(() =>
    replaceDriverRegularAvailability(applicationPrisma, applicationContext, linkedDriver.id, [
      ...availability.slice(0, 6),
      { dayOfWeek: 5, isAvailable: true },
    ]),
  );
  const selfDriver = await getDriver(applicationPrisma, driverContext, linkedDriver.id);
  const otherDriver = await createDriver(applicationPrisma, applicationContext, {
    displayName: "Other validation driver",
  });
  const otherDriverDenied = await isDenied(() =>
    getDriver(applicationPrisma, driverContext, otherDriver.id),
  );
  const driverList = await listDrivers(applicationPrisma, driverContext);
  const persistedAvailability = await withTenantTransaction(
    applicationPrisma,
    applicationContext,
    (tx) =>
      tx.driverRegularAvailability.findMany({
        where: { companyId: ca, driverId: linkedDriver.id },
        orderBy: { dayOfWeek: "asc" },
      }),
  );
  checkpoint(
    "phase3a2_driver_lifecycle",
    updatedDriver.displayName === "Updated validation driver" &&
      suspendedDriver.operationalStatus === "SUSPENDED",
  );
  checkpoint(
    "phase3a2_driver_self_read_authorization",
    selfDriver.id === linkedDriver.id &&
      otherDriverDenied &&
      driverList.length === 1 &&
      driverList[0]?.id === linkedDriver.id,
  );
  checkpoint(
    "phase3a2_driver_availability",
    invalidAvailabilityDenied &&
      persistedAvailability.length === 7 &&
      persistedAvailability.every((entry, index) => entry.dayOfWeek === index),
  );
  await initializeOperationalDefaults(applicationPrisma, applicationContext);
  const defaultCategories = await listVehicleCategories(
    applicationPrisma,
    applicationContext,
    true,
  );
  checkpoint(
    "phase3b_vehicle_category_licence_classes",
    [
      ["VAN", "C"],
      ["LR", "LR"],
      ["MR", "MR"],
      ["HR", "HR"],
      ["HC", "HC"],
      ["MC", "MC"],
    ].every(([code, licenceClass]) =>
      defaultCategories.some(
        (category) => category.code === code && category.requiredLicenceClass === licenceClass,
      ),
    ),
  );
  const van = defaultCategories.find((category) => category.code === "VAN");
  if (!van) throw new Error("phase3a2 validation category fixture missing");
  const capability = await grantDriverVehicleCapability(
    applicationPrisma,
    applicationContext,
    linkedDriver.id,
    { vehicleCategoryId: van.id },
  );
  await revokeDriverVehicleCapability(
    applicationPrisma,
    applicationContext,
    linkedDriver.id,
    van.id,
  );
  const customCategory = await createVehicleCategory(applicationPrisma, applicationContext, {
    code: "ACCEPTANCE",
    name: "Acceptance category",
  });
  const renamedCategory = await updateVehicleCategory(
    applicationPrisma,
    applicationContext,
    customCategory.id,
    { name: "Renamed acceptance category" },
  );
  const inactiveCategory = await updateVehicleCategory(
    applicationPrisma,
    applicationContext,
    customCategory.id,
    { isActive: false },
  );
  const inactiveCapabilityDenied = await isDomainError(
    () =>
      grantDriverVehicleCapability(applicationPrisma, applicationContext, linkedDriver.id, {
        vehicleCategoryId: inactiveCategory.id,
      }),
    "INACTIVE_VEHICLE_CATEGORY",
  );
  const reactivatedCategory = await updateVehicleCategory(
    applicationPrisma,
    applicationContext,
    customCategory.id,
    { isActive: true },
  );
  checkpoint(
    "phase3a2_driver_category_capabilities",
    capability.isActive && inactiveCapabilityDenied && reactivatedCategory.isActive,
  );
  checkpoint(
    "phase3a2_vehicle_categories",
    ["VAN", "LR", "MR", "HR", "HC", "MC"].every((code) =>
      defaultCategories.some((category) => category.code === code),
    ) &&
      renamedCategory.code === "ACCEPTANCE" &&
      reactivatedCategory.name === "Renamed acceptance category",
  );
  const crypto = new LicenceCrypto({ rootKey: randomBytes(32), keyVersion: "acceptance-v1" });
  const licence = await addDriverLicence(
    applicationPrisma,
    applicationContext,
    crypto,
    linkedDriver.id,
    {
      licenceNumber: "A C C 1 2 3 4",
      expiresOn: new Date("2030-01-01"),
    },
  );
  const updatedLicence = await updateDriverLicence(
    applicationPrisma,
    applicationContext,
    crypto,
    linkedDriver.id,
    licence.id,
    { licenceNumber: "A C C 5 6 7 8", expiresOn: new Date("2031-01-01") },
  );
  const duplicateLicenceDenied = await isDomainError(
    () =>
      addDriverLicence(applicationPrisma, applicationContext, crypto, otherDriver.id, {
        licenceNumber: "ACC5678",
        expiresOn: new Date("2031-01-01"),
      }),
    "DUPLICATE_LICENCE",
  );
  const storedLicence = await withTenantTransaction(applicationPrisma, applicationContext, (tx) =>
    tx.driverLicence.findUniqueOrThrow({
      where: { companyId_id: { companyId: ca, id: licence.id } },
    }),
  );
  const licenceAuditRows = await withTenantTransaction(
    applicationPrisma,
    applicationContext,
    (tx) => tx.activity.findMany({ where: { entityId: licence.id }, select: { metadata: true } }),
  );
  const licenceMetadata = JSON.stringify(licenceAuditRows.map((row) => row.metadata));
  checkpoint(
    "phase3a2_driver_licence_privacy",
    updatedLicence.licenceNumberLast4 === "5678" &&
      !Object.hasOwn(updatedLicence, "licenceNumber") &&
      storedLicence.licenceNumberCiphertext !== "ACC5678" &&
      crypto.decrypt(ca, linkedDriver.id, {
        ciphertext: storedLicence.licenceNumberCiphertext,
        keyVersion: storedLicence.licenceNumberKeyVersion,
      }) === "ACC5678" &&
      duplicateLicenceDenied &&
      !licenceMetadata.includes("ACC5678") &&
      !licenceMetadata.includes(storedLicence.licenceNumberCiphertext),
  );
  const settings = await getOperationalSettings(applicationPrisma, applicationContext);
  const updatedSettings = await updateOperationalSettings(applicationPrisma, applicationContext, {
    odometerExpectedIncreaseThresholdKm: 1000,
    inspectionVehicleSelectionStrategy: "BOTH",
  });
  const driverCannotManageSettings = await isDenied(() =>
    updateOperationalSettings(applicationPrisma, driverContext, {
      odometerExpectedIncreaseThresholdKm: 1,
    }),
  );
  const invalidSettingsDenied = await isDenied(() =>
    updateOperationalSettings(applicationPrisma, applicationContext, {
      odometerExpectedIncreaseThresholdKm: 0,
    }),
  );
  checkpoint(
    "phase3a2_operational_settings",
    settings.companyId === ca &&
      updatedSettings.odometerExpectedIncreaseThresholdKm === 1000 &&
      driverCannotManageSettings &&
      invalidSettingsDenied,
  );
  const vehicleWithoutBaseline = await createVehicle(applicationPrisma, applicationContext, {
    registration: "ACCEPT 100",
    vehicleCategoryId: van.id,
  });
  const noBaselineDenied = await isDomainError(
    () =>
      submitManualOdometerReading(
        applicationPrisma,
        applicationContext,
        OdometerConfirmationTokenService.forTests(),
        vehicleWithoutBaseline.id,
        { readingKm: 1 },
      ),
    "ODOMETER_BASELINE_REQUIRED",
  );
  const serviceVehicle = await createVehicle(applicationPrisma, applicationContext, {
    registration: "ACCEPT 200",
    vehicleCategoryId: van.id,
    initialOdometerKm: 100000,
    nextServiceOdometerKm: 102000,
  });
  const initialSnapshot = await getVehicleOperationalSnapshot(
    applicationPrisma,
    applicationContext,
    serviceVehicle.id,
  );
  const normalConfirmations = OdometerConfirmationTokenService.forTests();
  const regressionDenied = await isDomainError(
    () =>
      submitManualOdometerReading(
        applicationPrisma,
        applicationContext,
        normalConfirmations,
        serviceVehicle.id,
        { readingKm: 99999 },
      ),
    "ODOMETER_REGRESSION",
  );
  const normalReading = await submitManualOdometerReading(
    applicationPrisma,
    applicationContext,
    normalConfirmations,
    serviceVehicle.id,
    { readingKm: 100500 },
  );
  const normalSnapshot = await getVehicleOperationalSnapshot(
    applicationPrisma,
    applicationContext,
    serviceVehicle.id,
  );
  checkpoint(
    "phase3a2_vehicle_initial_odometer",
    noBaselineDenied &&
      initialSnapshot.authoritativeOdometerKm === 100000 &&
      initialSnapshot.latestAcceptedReading?.source === "INITIAL_ENTRY",
  );
  checkpoint(
    "phase3a2_odometer_normal_submission",
    regressionDenied &&
      normalReading.kind === "ACCEPTED" &&
      normalSnapshot.authoritativeOdometerKm === 100500 &&
      normalSnapshot.kilometresRemaining === 1500,
  );
  const duplicateRegistrationDenied = await isDomainError(
    () =>
      createVehicle(applicationPrisma, applicationContext, {
        registration: "ACCEPT-200",
        vehicleCategoryId: van.id,
      }),
    "DUPLICATE_REGISTRATION",
  );
  const vehicleBService = await createVehicle(applicationPrisma, applicationContextB, {
    registration: "ACCEPT 200",
    vehicleCategoryId: categoryB,
  });
  const vehicleUpdate = await updateVehicle(
    applicationPrisma,
    applicationContext,
    serviceVehicle.id,
    {
      registration: "ACCEPT-201",
    },
  );
  const resolvedVehicle = await resolveVehicleRegistration(
    applicationPrisma,
    applicationContext,
    "accept 201",
  );
  const foreignVehicleDenied = await isDenied(() =>
    getVehicle(applicationPrisma, applicationContext, vehicleBService.id),
  );
  const nextServiceVehicle = await updateNextServiceOdometer(
    applicationPrisma,
    applicationContext,
    serviceVehicle.id,
    { nextServiceOdometerKm: 103000 },
  );
  const missingOutOfServiceReason = await isDenied(() =>
    changeManualVehicleStatus(applicationPrisma, applicationContext, serviceVehicle.id, {
      status: "OUT_OF_SERVICE",
    }),
  );
  const outOfServiceVehicle = await changeManualVehicleStatus(
    applicationPrisma,
    applicationContext,
    serviceVehicle.id,
    { status: "OUT_OF_SERVICE", reason: "Administrative validation hold" },
  );
  const missingClearanceReason = await isDenied(() =>
    changeManualVehicleStatus(applicationPrisma, applicationContext, serviceVehicle.id, {
      status: "ACTIVE",
    }),
  );
  const restoredVehicle = await changeManualVehicleStatus(
    applicationPrisma,
    applicationContext,
    serviceVehicle.id,
    { status: "ACTIVE", reason: "Administrative clearance" },
  );
  const statusHistory = await withTenantTransaction(applicationPrisma, applicationContext, (tx) =>
    tx.vehicleStatusHistory.findMany({ where: { companyId: ca, vehicleId: serviceVehicle.id } }),
  );
  checkpoint(
    "phase3a2_vehicle_lifecycle",
    duplicateRegistrationDenied &&
      vehicleUpdate.registrationNormalized === "ACCEPT201" &&
      resolvedVehicle?.id === serviceVehicle.id &&
      foreignVehicleDenied &&
      nextServiceVehicle.nextServiceOdometerKm === 103000,
  );
  checkpoint(
    "phase3a2_vehicle_status_transitions",
    missingOutOfServiceReason &&
      outOfServiceVehicle.operationalStatus === "OUT_OF_SERVICE" &&
      missingClearanceReason &&
      restoredVehicle.operationalStatus === "ACTIVE" &&
      statusHistory.some(
        (history) =>
          history.toStatus === "OUT_OF_SERVICE" &&
          history.reason === "Administrative validation hold" &&
          history.source === "MANUAL",
      ),
  );
  const previewReadingCount = await withTenantTransaction(
    applicationPrisma,
    applicationContext,
    (tx) =>
      tx.vehicleOdometerReading.count({ where: { companyId: ca, vehicleId: serviceVehicle.id } }),
  );
  const anomalyPreview = await submitManualOdometerReading(
    applicationPrisma,
    applicationContext,
    normalConfirmations,
    serviceVehicle.id,
    { readingKm: 102000 },
  );
  if (anomalyPreview.kind !== "ANOMALY_CONFIRMATION_REQUIRED")
    throw new Error("phase3a2 anomaly preview did not require confirmation");
  const previewReadingCountAfter = await withTenantTransaction(
    applicationPrisma,
    applicationContext,
    (tx) =>
      tx.vehicleOdometerReading.count({ where: { companyId: ca, vehicleId: serviceVehicle.id } }),
  );
  const tamperedTokenDenied = await isDenied(() =>
    submitManualOdometerReading(
      applicationPrisma,
      applicationContext,
      normalConfirmations,
      serviceVehicle.id,
      { readingKm: 102000, confirmationToken: `${anomalyPreview.confirmationToken}x` },
    ),
  );
  const wrongActorTokenDenied = await isDenied(() =>
    submitManualOdometerReading(
      applicationPrisma,
      driverContext,
      normalConfirmations,
      serviceVehicle.id,
      { readingKm: 102000, confirmationToken: anomalyPreview.confirmationToken },
    ),
  );
  const pendingReading = await submitManualOdometerReading(
    applicationPrisma,
    applicationContext,
    normalConfirmations,
    serviceVehicle.id,
    { readingKm: 102000, confirmationToken: anomalyPreview.confirmationToken },
  );
  if (pendingReading.kind !== "REVIEW_REQUIRED")
    throw new Error("phase3a2 confirmed anomaly did not create a pending review");
  const pendingSubmissionDenied = await isDomainError(
    () =>
      submitManualOdometerReading(
        applicationPrisma,
        applicationContext,
        normalConfirmations,
        serviceVehicle.id,
        { readingKm: 100600 },
      ),
    "UNRESOLVED_ODOMETER_REVIEW",
  );
  const driverReviewDenied = await isDenied(() =>
    reviewOdometerReading(
      applicationPrisma,
      driverContext,
      serviceVehicle.id,
      pendingReading.readingId,
      {
        decision: "ACCEPT",
        reviewNote: "Driver cannot approve",
      },
    ),
  );
  const emptyReviewDenied = await isDenied(() =>
    reviewOdometerReading(
      applicationPrisma,
      applicationContext,
      serviceVehicle.id,
      pendingReading.readingId,
      {
        decision: "ACCEPT",
        reviewNote: "",
      },
    ),
  );
  const acceptedReview = await reviewOdometerReading(
    applicationPrisma,
    applicationContext,
    serviceVehicle.id,
    pendingReading.readingId,
    { decision: "ACCEPT", reviewNote: "Administrative acceptance" },
  );
  const postReviewSnapshot = await getVehicleOperationalSnapshot(
    applicationPrisma,
    applicationContext,
    serviceVehicle.id,
  );
  checkpoint(
    "phase3a2_odometer_anomaly_preview",
    previewReadingCount === previewReadingCountAfter &&
      anomalyPreview.differenceKm > anomalyPreview.thresholdKm &&
      tamperedTokenDenied &&
      wrongActorTokenDenied,
  );
  checkpoint(
    "phase3a2_odometer_confirmation_security",
    pendingSubmissionDenied &&
      acceptedReview.status === "ACCEPTED" &&
      postReviewSnapshot.authoritativeOdometerKm === 102000,
  );
  checkpoint(
    "phase3a2_odometer_review",
    driverReviewDenied &&
      emptyReviewDenied &&
      acceptedReview.reviewNote === "Administrative acceptance",
  );
  const alreadyReviewedDenied = await isDomainError(
    () =>
      reviewOdometerReading(
        applicationPrisma,
        applicationContext,
        serviceVehicle.id,
        pendingReading.readingId,
        {
          decision: "REJECT",
          reviewNote: "Already resolved",
        },
      ),
    "ODOMETER_ALREADY_REVIEWED",
  );
  const rejectPreview = await submitManualOdometerReading(
    applicationPrisma,
    applicationContext,
    normalConfirmations,
    serviceVehicle.id,
    { readingKm: 104000 },
  );
  if (rejectPreview.kind !== "ANOMALY_CONFIRMATION_REQUIRED")
    throw new Error("phase3a2 rejection anomaly preview did not require confirmation");
  const rejectPending = await submitManualOdometerReading(
    applicationPrisma,
    applicationContext,
    normalConfirmations,
    serviceVehicle.id,
    { readingKm: 104000, confirmationToken: rejectPreview.confirmationToken },
  );
  if (rejectPending.kind !== "REVIEW_REQUIRED")
    throw new Error("phase3a2 rejection anomaly did not create a pending review");
  const rejectedReview = await reviewOdometerReading(
    applicationPrisma,
    applicationContext,
    serviceVehicle.id,
    rejectPending.readingId,
    { decision: "REJECT", reviewNote: "Administrative rejection" },
  );
  const afterRejectSubmission = await submitManualOdometerReading(
    applicationPrisma,
    applicationContext,
    normalConfirmations,
    serviceVehicle.id,
    { readingKm: 102500 },
  );
  checkpoint(
    "phase3a2_odometer_rejection",
    alreadyReviewedDenied &&
      rejectedReview.status === "REJECTED" &&
      afterRejectSubmission.kind === "ACCEPTED",
  );
  const stalePreview = await submitManualOdometerReading(
    applicationPrisma,
    applicationContext,
    normalConfirmations,
    serviceVehicle.id,
    { readingKm: 104500 },
  );
  if (stalePreview.kind !== "ANOMALY_CONFIRMATION_REQUIRED")
    throw new Error("phase3a2 stale confirmation preview did not require confirmation");
  await updateOperationalSettings(applicationPrisma, applicationContext, {
    odometerExpectedIncreaseThresholdKm: 1500,
  });
  const staleThresholdTokenDenied = await isDomainError(
    () =>
      submitManualOdometerReading(
        applicationPrisma,
        applicationContext,
        normalConfirmations,
        serviceVehicle.id,
        { readingKm: 104500, confirmationToken: stalePreview.confirmationToken },
      ),
    "STALE_ODOMETER_CONFIRMATION",
  );
  await updateOperationalSettings(applicationPrisma, applicationContext, {
    odometerExpectedIncreaseThresholdKm: 1000,
  });
  checkpoint("phase3a2_odometer_stale_confirmation", staleThresholdTokenDenied);
  const staleReviewPreview = await submitManualOdometerReading(
    applicationPrisma,
    applicationContext,
    normalConfirmations,
    serviceVehicle.id,
    { readingKm: 104500 },
  );
  if (staleReviewPreview.kind !== "ANOMALY_CONFIRMATION_REQUIRED")
    throw new Error("phase3a2 stale review preview did not require confirmation");
  const staleReviewPending = await submitManualOdometerReading(
    applicationPrisma,
    applicationContext,
    normalConfirmations,
    serviceVehicle.id,
    { readingKm: 104500, confirmationToken: staleReviewPreview.confirmationToken },
  );
  if (staleReviewPending.kind !== "REVIEW_REQUIRED")
    throw new Error("phase3a2 stale review fixture did not create a pending review");
  // A controlled migrator fixture creates an otherwise-unreachable stale state;
  // the runtime review service must still fail closed on ACCEPT and permit REJECT.
  await admin.query("UPDATE vehicle_odometer_readings SET reading_km=100000 WHERE id=$1", [
    staleReviewPending.readingId,
  ]);
  const staleAcceptDenied = await isDomainError(
    () =>
      reviewOdometerReading(
        applicationPrisma,
        applicationContext,
        serviceVehicle.id,
        staleReviewPending.readingId,
        { decision: "ACCEPT", reviewNote: "Must not accept stale review" },
      ),
    "STALE_ODOMETER_REVIEW",
  );
  const staleRejected = await reviewOdometerReading(
    applicationPrisma,
    applicationContext,
    serviceVehicle.id,
    staleReviewPending.readingId,
    { decision: "REJECT", reviewNote: "Reject stale review" },
  );
  checkpoint(
    "phase3a2_odometer_stale_review",
    staleAcceptDenied && staleRejected.status === "REJECTED",
  );
  checkpoint(
    "phase3a2_authorization_matrix",
    applicationContext.permissions.has("drivers.manage") &&
      applicationContext.permissions.has("vehicles.manage") &&
      applicationContext.permissions.has("vehicles.odometer.review") &&
      driverContext.permissions.has("vehicles.odometer.submit") &&
      !driverContext.permissions.has("drivers.manage") &&
      !driverContext.permissions.has("vehicles.manage") &&
      !driverContext.permissions.has("vehicles.odometer.review"),
  );
  const concurrencyVehicle = await createVehicle(applicationPrisma, applicationContext, {
    registration: "ACCEPT 300",
    vehicleCategoryId: van.id,
    initialOdometerKm: 200000,
  });
  const concurrentSubmissions = await withinTimeout(
    Promise.all([
      submitManualOdometerReading(
        applicationPrisma,
        applicationContext,
        normalConfirmations,
        concurrencyVehicle.id,
        { readingKm: 200500 },
      ),
      submitManualOdometerReading(
        applicationPrisma,
        applicationContext,
        normalConfirmations,
        concurrencyVehicle.id,
        { readingKm: 200500 },
      ),
    ]),
    "phase3a2 concurrent normal submissions",
  );
  const concurrentReadings = await withTenantTransaction(
    applicationPrisma,
    applicationContext,
    (tx) =>
      tx.vehicleOdometerReading.findMany({
        where: { companyId: ca, vehicleId: concurrencyVehicle.id, status: "ACCEPTED" },
        orderBy: [{ acceptedAt: "asc" }, { id: "asc" }],
      }),
  );
  const concurrentPreviewA = await submitManualOdometerReading(
    applicationPrisma,
    applicationContext,
    normalConfirmations,
    concurrencyVehicle.id,
    { readingKm: 202000 },
  );
  const concurrentPreviewB = await submitManualOdometerReading(
    applicationPrisma,
    applicationContext,
    normalConfirmations,
    concurrencyVehicle.id,
    { readingKm: 203000 },
  );
  if (
    concurrentPreviewA.kind !== "ANOMALY_CONFIRMATION_REQUIRED" ||
    concurrentPreviewB.kind !== "ANOMALY_CONFIRMATION_REQUIRED"
  )
    throw new Error("phase3a2 concurrent anomaly preview did not require confirmation");
  const concurrentAnomalies = await withinTimeout(
    Promise.allSettled([
      submitManualOdometerReading(
        applicationPrisma,
        applicationContext,
        normalConfirmations,
        concurrencyVehicle.id,
        { readingKm: 202000, confirmationToken: concurrentPreviewA.confirmationToken },
      ),
      submitManualOdometerReading(
        applicationPrisma,
        applicationContext,
        normalConfirmations,
        concurrencyVehicle.id,
        { readingKm: 203000, confirmationToken: concurrentPreviewB.confirmationToken },
      ),
    ]),
    "phase3a2 concurrent anomaly confirmations",
  );
  const concurrentPending = await withTenantTransaction(
    applicationPrisma,
    applicationContext,
    (tx) =>
      tx.vehicleOdometerReading.count({
        where: { companyId: ca, vehicleId: concurrencyVehicle.id, status: "REVIEW_REQUIRED" },
      }),
  );
  checkpoint(
    "phase3a2_odometer_pending_concurrency",
    concurrentSubmissions.every((result) => result.kind === "ACCEPTED") &&
      concurrentReadings.length === 3 &&
      concurrentReadings.slice(1).some((reading) => reading.previousAcceptedReadingId !== null) &&
      concurrentAnomalies.filter((result) => result.status === "fulfilled").length === 1 &&
      concurrentPending === 1,
  );
  const acceptanceAuditRows = await withTenantTransaction(
    applicationPrisma,
    applicationContext,
    (tx) =>
      tx.activity.findMany({
        where: {
          companyId: ca,
          action: {
            in: [
              "driver.created",
              "driver.licence_added",
              "vehicle.created",
              "vehicle.status_changed",
            ],
          },
        },
        select: { action: true, actorUserId: true, metadata: true },
      }),
  );
  const foreignAcceptanceAudits = await withTenantTransaction(
    applicationPrisma,
    applicationContextB,
    (tx) =>
      tx.activity.count({
        where: { action: { in: ["driver.licence_added", "vehicle.status_changed"] } },
      }),
  );
  checkpoint(
    "phase3a2_audit_integrity",
    acceptanceAuditRows.some((row) => row.action === "driver.created" && row.actorUserId === a) &&
      acceptanceAuditRows.some((row) => row.action === "vehicle.status_changed") &&
      foreignAcceptanceAudits === 0,
  );
  checkpoint(
    "phase3a2_tenant_isolation",
    foreignVehicleDenied &&
      (await listVehicles(applicationPrisma, applicationContextB)).every(
        (vehicle) => vehicle.companyId === cb,
      ),
  );
  // Phase 3B.1 is database-only: use the real runtime role for tenant-scoped
  // DDL invariant probes. Application services deliberately remain out of scope.
  const documentTypeCompany = await inRuntimeTenant(a, ca, async (client) => {
    const result = await client.query(
      "INSERT INTO document_types(company_id,code,name,subject_type,evidence_source_type) VALUES ($1,'RLS_COMPANY','RLS company evidence','COMPANY','DOCUMENT') RETURNING id",
      [ca],
    );
    return result.rows[0].id as string;
  });
  const documentTypeVehicle = await inRuntimeTenant(a, ca, async (client) => {
    const result = await client.query(
      "INSERT INTO document_types(company_id,code,name,subject_type,evidence_source_type) VALUES ($1,'RLS_VEHICLE','RLS vehicle evidence','VEHICLE','DOCUMENT') RETURNING id",
      [ca],
    );
    return result.rows[0].id as string;
  });
  const driverRequirement = await inRuntimeTenant(a, ca, async (client) => {
    const result = await client.query(
      "INSERT INTO compliance_requirements(company_id,document_type_id,subject_type,applicability,name) VALUES ($1,$2,'DRIVER','GLOBAL','RLS driver requirement') RETURNING id",
      [ca, documentTypeA],
    );
    return result.rows[0].id as string;
  });
  const validDocument = await inRuntimeTenant(a, ca, async (client) => {
    const result = await client.query(
      "INSERT INTO documents(company_id,document_type_id,subject_type,driver_id,created_by_user_id) VALUES ($1,$2,'DRIVER',$3,$4) RETURNING id",
      [ca, documentTypeA, linkedDriver.id, a],
    );
    return result.rows[0].id as string;
  });
  const invalidDocumentTypeTenant = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO documents(company_id,document_type_id,subject_type,driver_id,created_by_user_id) VALUES ($1,$2,'DRIVER',$3,$4)",
        [ca, documentTypeB, linkedDriver.id, a],
      ),
    ),
  );
  const invalidDocumentSubject = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO documents(company_id,document_type_id,subject_type,vehicle_id,created_by_user_id) VALUES ($1,$2,'DRIVER',$3,$4)",
        [ca, documentTypeA, serviceVehicle.id, a],
      ),
    ),
  );
  const invalidRequirementSubject = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO compliance_requirements(company_id,document_type_id,subject_type,applicability,name) VALUES ($1,$2,'VEHICLE','GLOBAL','Invalid subject')",
        [ca, documentTypeA],
      ),
    ),
  );
  const invalidCompanyRequirement = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO compliance_requirements(company_id,document_type_id,subject_type,applicability,name) VALUES ($1,$2,'COMPANY','SPECIFIC','Invalid company applicability')",
        [ca, documentTypeCompany],
      ),
    ),
  );
  const companyRequirement = await inRuntimeTenant(a, ca, async (client) => {
    const result = await client.query(
      "INSERT INTO compliance_requirements(company_id,document_type_id,subject_type,applicability,name) VALUES ($1,$2,'COMPANY','GLOBAL','RLS company requirement') RETURNING id",
      [ca, documentTypeCompany],
    );
    return result.rows[0].id as string;
  });
  const duplicateActiveRequirement = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO compliance_requirements(company_id,document_type_id,subject_type,applicability,name) VALUES ($1,$2,'DRIVER','GLOBAL','Duplicate requirement')",
        [ca, documentTypeA],
      ),
    ),
  );
  const validAssignment = await inRuntimeTenant(a, ca, (client) =>
    client.query(
      "INSERT INTO compliance_requirement_assignments(company_id,requirement_id,subject_type,driver_id,assigned_by_user_id) VALUES ($1,$2,'DRIVER',$3,$4)",
      [ca, driverRequirement, linkedDriver.id, a],
    ),
  );
  const invalidAssignment = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO compliance_requirement_assignments(company_id,requirement_id,subject_type,driver_id,vehicle_id,assigned_by_user_id) VALUES ($1,$2,'DRIVER',$3,$4,$5)",
        [ca, driverRequirement, linkedDriver.id, serviceVehicle.id, a],
      ),
    ),
  );
  const duplicateActiveAssignment = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO compliance_requirement_assignments(company_id,requirement_id,subject_type,driver_id,assigned_by_user_id) VALUES ($1,$2,'DRIVER',$3,$4)",
        [ca, driverRequirement, linkedDriver.id, a],
      ),
    ),
  );
  const invalidAssignmentRemoval = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "UPDATE compliance_requirement_assignments SET removed_at=now() WHERE company_id=$1 AND requirement_id=$2 AND driver_id=$3",
        [ca, driverRequirement, linkedDriver.id],
      ),
    ),
  );
  const invalidExemption = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO compliance_requirement_exemptions(company_id,requirement_id,subject_type,company_subject_id,reason,effective_from,granted_by_user_id) VALUES ($1,$2,'COMPANY',$3,'Invalid company subject',current_date,$4)",
        [ca, companyRequirement, cb, a],
      ),
    ),
  );
  const invalidExemptionDates = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO compliance_requirement_exemptions(company_id,requirement_id,subject_type,driver_id,reason,effective_from,expires_on,granted_by_user_id) VALUES ($1,$2,'DRIVER',$3,'Invalid date range','2030-01-02','2030-01-01',$4)",
        [ca, driverRequirement, linkedDriver.id, a],
      ),
    ),
  );
  const invalidDocumentReview = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO documents(company_id,document_type_id,subject_type,driver_id,reviewed_at,created_by_user_id) VALUES ($1,$2,'DRIVER',$3,now(),$4)",
        [ca, documentTypeA, linkedDriver.id, a],
      ),
    ),
  );
  const invalidDocumentArchive = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query("UPDATE documents SET archived_at=now() WHERE id=$1", [validDocument]),
    ),
  );
  const invalidDocumentRevocation = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query("UPDATE documents SET revoked_at=now() WHERE id=$1", [validDocument]),
    ),
  );
  const invalidAvailableFile = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO stored_files(company_id,storage_provider,bucket,object_key,original_filename,file_state,created_by_user_id) VALUES ($1,'validation','private','missing-metadata','evidence.pdf','AVAILABLE',$2)",
        [ca, a],
      ),
    ),
  );
  const invalidSha256 = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO stored_files(company_id,storage_provider,bucket,object_key,original_filename,sha256,created_by_user_id) VALUES ($1,'validation','private','bad-hash','evidence.pdf',decode('aa','hex'),$2)",
        [ca, a],
      ),
    ),
  );
  const invalidAvailableSize = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO stored_files(company_id,storage_provider,bucket,object_key,original_filename,mime_type,size_bytes,sha256,file_state,created_by_user_id) VALUES ($1,'validation','private','bad-size','evidence.pdf','application/pdf',0,decode(repeat('aa',32),'hex'),'AVAILABLE',$2)",
        [ca, a],
      ),
    ),
  );
  const oversizedAvailableFile = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO stored_files(company_id,storage_provider,bucket,object_key,original_filename,mime_type,size_bytes,sha256,file_state,created_by_user_id) VALUES ($1,'validation','private','oversized','evidence.pdf','application/pdf',10485761,decode(repeat('aa',32),'hex'),'AVAILABLE',$2)",
        [ca, a],
      ),
    ),
  );
  const validStoredFile = await inRuntimeTenant(a, ca, async (client) => {
    const result = await client.query(
      "INSERT INTO stored_files(company_id,storage_provider,bucket,object_key,original_filename,mime_type,size_bytes,sha256,file_state,created_by_user_id) VALUES ($1,'validation','private','valid-document','evidence.pdf','application/pdf',1024,decode(repeat('aa',32),'hex'),'AVAILABLE',$2) RETURNING id",
      [ca, a],
    );
    return result.rows[0].id as string;
  });
  const duplicateObjectKey = await isDenied(() =>
    inRuntimeTenant(b, cb, (client) =>
      client.query(
        "INSERT INTO stored_files(company_id,storage_provider,bucket,object_key,original_filename,created_by_user_id) VALUES ($1,'validation','private','valid-document','other.pdf',$2)",
        [cb, b],
      ),
    ),
  );
  await inRuntimeTenant(a, ca, (client) =>
    client.query(
      "INSERT INTO document_files(company_id,document_id,stored_file_id,attached_by_user_id) VALUES ($1,$2,$3,$4)",
      [ca, validDocument, validStoredFile, a],
    ),
  );
  const duplicateDocumentFile = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO document_files(company_id,document_id,stored_file_id,attached_by_user_id) VALUES ($1,$2,$3,$4)",
        [ca, validDocument, validStoredFile, a],
      ),
    ),
  );
  const licenceStoredFile = await inRuntimeTenant(a, ca, async (client) => {
    const result = await client.query(
      "INSERT INTO stored_files(company_id,storage_provider,bucket,object_key,original_filename,created_by_user_id) VALUES ($1,'validation','private','licence-front','licence-front.jpg',$2) RETURNING id",
      [ca, a],
    );
    return result.rows[0].id as string;
  });
  const secondLicenceStoredFile = await inRuntimeTenant(a, ca, async (client) => {
    const result = await client.query(
      "INSERT INTO stored_files(company_id,storage_provider,bucket,object_key,original_filename,created_by_user_id) VALUES ($1,'validation','private','licence-front-second','licence-front-2.jpg',$2) RETURNING id",
      [ca, a],
    );
    return result.rows[0].id as string;
  });
  await inRuntimeTenant(a, ca, (client) =>
    client.query(
      "INSERT INTO driver_licence_files(company_id,driver_licence_id,stored_file_id,role,attached_by_user_id) VALUES ($1,$2,$3,'FRONT',$4)",
      [ca, licence.id, licenceStoredFile, a],
    ),
  );
  const duplicateLicenceAttachmentFile = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO driver_licence_files(company_id,driver_licence_id,stored_file_id,role,attached_by_user_id) VALUES ($1,$2,$3,'FRONT',$4)",
        [ca, licence.id, licenceStoredFile, a],
      ),
    ),
  );
  const duplicateLicenceAttachmentRole = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO driver_licence_files(company_id,driver_licence_id,stored_file_id,role,attached_by_user_id) VALUES ($1,$2,$3,'FRONT',$4)",
        [ca, licence.id, secondLicenceStoredFile, a],
      ),
    ),
  );
  const selfReplacingLicence = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query("UPDATE driver_licences SET replaces_licence_id=id WHERE id=$1", [licence.id]),
    ),
  );
  const successorLicence = await inRuntimeTenant(a, ca, async (client) => {
    const result = await client.query(
      "INSERT INTO driver_licences(company_id,driver_id,licence_number_ciphertext,licence_number_lookup_hash,licence_number_last4,licence_number_key_version,expires_on,valid_from,replaces_licence_id) VALUES ($1,$2,'phase3b-successor',decode(repeat('bb',32),'hex'),'9999','validation','2035-01-01','2034-01-01',$3) RETURNING id",
      [ca, linkedDriver.id, licence.id],
    );
    return result.rows[0].id as string;
  });
  const secondDirectSuccessor = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO driver_licences(company_id,driver_id,licence_number_ciphertext,licence_number_lookup_hash,licence_number_last4,licence_number_key_version,expires_on,valid_from,replaces_licence_id) VALUES ($1,$2,'phase3b-second',decode(repeat('cc',32),'hex'),'8888','validation','2035-01-01','2034-01-01',$3)",
        [ca, linkedDriver.id, licence.id],
      ),
    ),
  );
  const crossDriverReplacement = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query(
        "INSERT INTO driver_licences(company_id,driver_id,licence_number_ciphertext,licence_number_lookup_hash,licence_number_last4,licence_number_key_version,expires_on,valid_from,replaces_licence_id) VALUES ($1,$2,'phase3b-cross-driver',decode(repeat('dd',32),'hex'),'7777','validation','2035-01-01','2034-01-01',$3)",
        [ca, otherDriver.id, licence.id],
      ),
    ),
  );
  const invalidLicenceRevocation = await isDenied(() =>
    inRuntimeTenant(a, ca, (client) =>
      client.query("UPDATE driver_licences SET revoked_at=now() WHERE id=$1", [successorLicence]),
    ),
  );
  checkpoint(
    "phase3b_constraints_and_file_integrity",
    validAssignment.rowCount === 1 &&
      invalidDocumentTypeTenant &&
      invalidDocumentSubject &&
      invalidRequirementSubject &&
      invalidCompanyRequirement &&
      duplicateActiveRequirement &&
      invalidAssignment &&
      duplicateActiveAssignment &&
      invalidAssignmentRemoval &&
      invalidExemption &&
      invalidExemptionDates &&
      invalidDocumentReview &&
      invalidDocumentArchive &&
      invalidDocumentRevocation &&
      invalidAvailableFile &&
      invalidSha256 &&
      invalidAvailableSize &&
      oversizedAvailableFile &&
      duplicateObjectKey &&
      duplicateDocumentFile &&
      duplicateLicenceAttachmentFile &&
      duplicateLicenceAttachmentRole &&
      selfReplacingLicence &&
      secondDirectSuccessor &&
      crossDriverReplacement &&
      invalidLicenceRevocation,
  );
  const auditRows = await withTenantTransaction(applicationPrisma, applicationContext, (tx) =>
    tx.activity.count({ where: { action: "tenant_context.established", actorUserId: a } }),
  );
  const crossTenantAuditRows = await withTenantTransaction(
    applicationPrisma,
    applicationContextB,
    (tx) => tx.activity.count({ where: { action: "tenant_context.established", actorUserId: a } }),
  );
  await applicationPrisma.$disconnect();
  checkpoint(
    "application_tenant_context_audit",
    applicationContext.companyId === ca &&
      applicationRows.every((row) => row.companyId === ca) &&
      auditRows === 1,
  );
  checkpoint("audit_cross_tenant_isolation", crossTenantAuditRows === 0);
  await runPhase3a3ApiAcceptance({
    admin,
    runtimeDatabaseUrl: runtimeUrl(),
    checkpoint,
  });
  await runPhase3b3ApiAcceptance({
    admin,
    runtimeDatabaseUrl: runtimeUrl(),
    checkpoint,
  });
  await runPhase3b4ApiAcceptance({ admin, runtimeDatabaseUrl: runtimeUrl(), checkpoint });
  const passwordPrisma = new PrismaClient({ datasources: { db: { url: runtimeUrl() } } });
  const issued = await issuePasswordReset(passwordPrisma, "a@validation.test");
  const storedToken = await admin.query(
    "SELECT token_hash FROM password_reset_tokens WHERE user_id=$1 ORDER BY expires_at DESC LIMIT 1",
    [a],
  );
  const expired = createPasswordResetToken();
  await admin.query(
    "INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES ($1,$2,now()-interval '1 minute')",
    [a, expired.tokenHash],
  );
  const expiredDenied = await isDenied(() =>
    consumePasswordReset(passwordPrisma, expired.token, "validation-new-password"),
  );
  const resetUserId = issued
    ? await consumePasswordReset(passwordPrisma, issued.token, "validation-new-password")
    : null;
  const reusedDenied = issued
    ? await isDenied(() =>
        consumePasswordReset(passwordPrisma, issued.token, "validation-new-password"),
      )
    : false;
  await passwordPrisma.$disconnect();
  checkpoint(
    "password_reset_lifecycle",
    Boolean(issued) &&
      storedToken.rows[0]?.token_hash !== issued?.token &&
      expiredDenied &&
      resetUserId === a &&
      reusedDenied,
  );
  const adminPrisma = new PrismaClient({ datasources: { db: { url } } });
  await seedFoundation(adminPrisma, randomBytes(32).toString("base64url"));
  await seedFoundation(adminPrisma, randomBytes(32).toString("base64url"));
  const seededCounts = await adminPrisma.$transaction(async (tx) => ({
    companies: await tx.company.count({ where: { slug: "ois-demo" } }),
    users: await tx.user.count({ where: { email: "owner@ois-demo.test" } }),
    settings: await tx.companyOperationalSettings.count({
      where: {
        companyId: (await tx.company.findUniqueOrThrow({ where: { slug: "ois-demo" } })).id,
      },
    }),
    categories: await tx.vehicleCategory.count({
      where: {
        companyId: (await tx.company.findUniqueOrThrow({ where: { slug: "ois-demo" } })).id,
      },
    }),
  }));
  await adminPrisma.$disconnect();
  checkpoint(
    "seed_idempotency",
    seededCounts.companies === 1 &&
      seededCounts.users === 1 &&
      seededCounts.settings === 1 &&
      seededCounts.categories === 6,
  );
  const runtimeRoleFlags = await admin.query(
    "SELECT rolbypassrls, rolinherit FROM pg_roles WHERE rolname=$1",
    [runtime],
  );
  checkpoint("runtime_noinherit", runtimeRoleFlags.rows[0]?.rolinherit === false);
  const cannotDisableRls = await isDenied(() =>
    r.query("ALTER TABLE locations DISABLE ROW LEVEL SECURITY"),
  );
  const cannotAlterPolicy = await isDenied(() =>
    r.query("ALTER POLICY locations_tenant ON locations USING (true)"),
  );
  checkpoint("runtime_cannot_alter_rls", cannotDisableRls && cannotAlterPolicy);
  const privilege = await r.query(
    "SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create, pg_has_role(current_user,$1,'USAGE') AS can_assume",
    [migrator],
  );
  console.log(
    `runtime_least_privilege: ${privilege.rows[0].can_create === false && privilege.rows[0].can_assume === false ? "PASS" : "FAIL"}`,
  );
  // Runs against a fresh disposable database through Railway's private PostgreSQL URL.
  // It is intentionally after the complete accepted matrix and before this runner's
  // final PASS, so a Phase 3B.2 failure fails the validation container.
  await runPhase3b2PostgresAcceptance();
  console.log("bootstrap_rls_matrix: PASS");
  await r.end();
  await admin.end();
}
if (process.env.OIS_RUNNER_IMPORT_SMOKE === "true") {
  console.log("migration_runner_import_smoke: PASS");
} else {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
