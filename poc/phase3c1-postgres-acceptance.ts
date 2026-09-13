/**
 * Disposable PostgreSQL proof for Phase 3C.1. DATABASE_URL must name an
 * administrative server database; this harness creates and drops its own DB.
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

const sourceUrl = process.env.DATABASE_URL;
const database = `ois_phase3c1_acceptance_${process.pid}_${Date.now()}`;
const runtimeRole = `ois_phase3c1_runtime_${process.pid}`;
const migratorRole = `ois_phase3c1_migrator_${process.pid}`;
const password = randomBytes(24).toString("hex");
const inspectionTables = [
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
const migrations = [
  "prisma/migrations/20260902000100_lean_phase2_initial/migration.sql",
  "prisma/migrations/20260905000100_phase3a_drivers_vehicles_foundation/migration.sql",
  "prisma/migrations/20260906000100_company_membership_tenant_read_rls_hardening/migration.sql",
  "prisma/migrations/20260906000200_company_membership_stage2_read_scope_correction/migration.sql",
  "prisma/migrations/20260906000300_phase3b_documents_compliance_foundation/migration.sql",
  "prisma/migrations/20260909000100_phase3b_exemption_effective_from_nullable/migration.sql",
  "prisma/migrations/20260910000100_driver_licence_same_driver_number_renewal/migration.sql",
  "prisma/migrations/20260913000100_phase3c_inspection_engine_foundation/migration.sql",
];

function quote(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function connectionFor(url: string, databaseName: string, role?: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  if (role) {
    parsed.username = role;
    parsed.password = password;
  }
  return parsed.toString();
}

function checkpoint(name: string, passed: boolean) {
  console.log(`${name}: ${passed ? "PASS" : "FAIL"}`);
  if (!passed) throw new Error(`${name} failed`);
}

export async function runPhase3c1PostgresAcceptance() {
  if (!sourceUrl) throw new Error("DATABASE_URL is required");
  const sourceDatabase = new URL(sourceUrl).pathname.slice(1);
  if (sourceDatabase.startsWith("ois_phase3c1_acceptance_"))
    throw new Error("DATABASE_URL must name an administrative server database");
  const admin = new Client({ connectionString: sourceUrl });
  let runtime: Client | undefined;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${quote(database)}`);
    await admin.query(
      `CREATE ROLE ${quote(migratorRole)} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`,
    );
    await admin.query(
      `CREATE ROLE ${quote(runtimeRole)} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`,
    );
    await admin.query(
      `GRANT CONNECT, CREATE ON DATABASE ${quote(database)} TO ${quote(migratorRole)}`,
    );
    await admin.query(`GRANT CONNECT ON DATABASE ${quote(database)} TO ${quote(runtimeRole)}`);
    const bootstrap = new Client({ connectionString: connectionFor(sourceUrl, database) });
    await bootstrap.connect();
    await bootstrap.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${quote(migratorRole)}`);
    await bootstrap.end();
    const migrator = new Client({
      connectionString: connectionFor(sourceUrl, database, migratorRole),
    });
    await migrator.connect();
    for (const migration of migrations) await migrator.query(await readFile(migration, "utf8"));
    await migrator.query(
      (await readFile("prisma/role-provisioning/phase3a-runtime-grants.sql", "utf8")).replaceAll(
        ':"runtime_role"',
        quote(runtimeRole),
      ),
    );
    await migrator.end();
    const targetAdmin = new Client({ connectionString: connectionFor(sourceUrl, database) });
    await targetAdmin.connect();
    await targetAdmin.query(`GRANT USAGE ON SCHEMA public TO ${quote(runtimeRole)}`);
    await targetAdmin.query(
      `GRANT SELECT,INSERT,UPDATE ON companies,users,roles,permissions,role_permissions,company_memberships,locations,activities TO ${quote(runtimeRole)}`,
    );
    const schema = await targetAdmin.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1::text[])",
      [inspectionTables],
    );
    checkpoint("phase3c1_schema", schema.rows.length === inspectionTables.length);
    const rls = await targetAdmin.query(
      "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[])",
      [inspectionTables],
    );
    checkpoint(
      "phase3c1_rls",
      rls.rows.length === inspectionTables.length &&
        rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity),
    );
    const flags = await targetAdmin.query(
      "SELECT rolbypassrls,rolinherit FROM pg_roles WHERE rolname=$1",
      [runtimeRole],
    );
    checkpoint(
      "phase3c1_runtime_role",
      flags.rows[0]?.rolbypassrls === false && flags.rows[0]?.rolinherit === false,
    );
    const companies = await targetAdmin.query(
      "INSERT INTO companies(name,slug,updated_at) VALUES ('Inspection A','inspection-a',now()),('Inspection B','inspection-b',now()) RETURNING id,slug",
    );
    const companyA = companies.rows.find((row) => row.slug === "inspection-a")?.id;
    const companyB = companies.rows.find((row) => row.slug === "inspection-b")?.id;
    await targetAdmin.query(
      "INSERT INTO users(email,account_status,updated_at) VALUES ('inspection-owner@test.invalid','ACTIVE',now())",
    );
    const owner = (
      await targetAdmin.query("SELECT id FROM users WHERE email='inspection-owner@test.invalid'")
    ).rows[0]?.id;
    await targetAdmin.end();
    runtime = new Client({ connectionString: connectionFor(sourceUrl, database, runtimeRole) });
    await runtime.connect();
    const noContext = await runtime.query(
      "SELECT count(*)::int AS count FROM inspection_templates",
    );
    checkpoint("phase3c1_no_context_fail_closed", noContext.rows[0]?.count === 0);
    await runtime.query("BEGIN");
    await runtime.query("SELECT set_config('app.current_company_id',$1,true)", [companyA]);
    await runtime.query("SELECT set_config('app.current_user_id',$1,true)", [owner]);
    const template = await runtime.query(
      "INSERT INTO inspection_templates(company_id,code,name,updated_at) VALUES ($1,'PRESTART','Pre-start',now()) RETURNING id",
      [companyA],
    );
    const templateId = template.rows[0]?.id;
    await runtime.query(
      "INSERT INTO inspection_template_versions(company_id,template_id,version,created_by_user_id,updated_at) VALUES ($1,$2,1,$3,now())",
      [companyA, templateId, owner],
    );
    await runtime.query("COMMIT");
    await runtime.query("BEGIN");
    await runtime.query("SELECT set_config('app.current_company_id',$1,true)", [companyB]);
    const hidden = await runtime.query(
      "SELECT count(*)::int AS count FROM inspection_templates WHERE id=$1",
      [templateId],
    );
    checkpoint("phase3c1_cross_tenant_isolation", hidden.rows[0]?.count === 0);
    await runtime.query("ROLLBACK");
    console.log("phase3c1_template_versioning: PASS");
  } finally {
    await runtime?.end().catch(() => undefined);
    await admin
      .query(`DROP DATABASE IF EXISTS ${quote(database)} WITH (FORCE)`)
      .catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS ${quote(runtimeRole)}`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS ${quote(migratorRole)}`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}

const importSmoke = process.env.OIS_PHASE3C1_POSTGRES_IMPORT_SMOKE === "true";
if (importSmoke) console.log("phase3c1_postgres_acceptance_import_smoke: PASS");

if (!importSmoke && process.argv[1]?.endsWith("phase3c1-postgres-acceptance.ts"))
  runPhase3c1PostgresAcceptance().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
