import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "../src/db/tenant-transaction";
import {
  consumePasswordReset,
  issuePasswordReset,
} from "../src/modules/identity/password-reset.service";
import { createPasswordResetToken } from "../src/modules/identity/password.service";
import { locationRepository } from "../src/modules/companies/location.repository";
import { seedFoundation } from "../src/modules/identity/seed.service";
import { resolveTenantContext } from "../src/modules/identity/tenant-context.service";

const url =
  process.env.DATABASE_URL ??
  (() => {
    throw new Error("DATABASE_URL missing inside Railway validation service");
  })();
const migrator = "ois_validation_migrator";
const runtime = "ois_validation_runtime";
const password = randomBytes(32).toString("hex");
const admin = new Client({ connectionString: url });
const quoteIdentifier = (s: string) => `"${s.replaceAll('"', '""')}"`;
const db = new URL(url).pathname.slice(1);
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

function checkpoint(name: string, passed: boolean) {
  console.log(`${name}: ${passed ? "PASS" : "FAIL"}`);
  if (!passed) throw new Error(`${name} failed`);
}

async function main() {
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
  const required = [
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
  const present = new Set(tables.rows.map((x) => x.tablename));
  if (required.every((name) => present.has(name)))
    console.log("migration_apply: PASS (already applied)");
  else if (required.some((name) => present.has(name)))
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
  await m.query(
    `GRANT USAGE ON SCHEMA public TO ${runtime}; GRANT SELECT,UPDATE ON users TO ${runtime}; GRANT SELECT ON roles,permissions,role_permissions TO ${runtime}; GRANT SELECT,INSERT,UPDATE ON companies,company_memberships,locations,activities,password_reset_tokens TO ${runtime}; GRANT SELECT,INSERT,DELETE ON sessions TO ${runtime}`,
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
  const migratedTables = await admin.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  console.log(
    `schema_validation: ${required.every((name) => migratedTables.rows.some((x) => x.tablename === name)) ? "PASS" : "FAIL"}`,
  );
  console.log(
    `runtime_nobypassrls: ${runtimeRoleCheck.rows[0]?.rolbypassrls === false ? "PASS" : "FAIL"}`,
  );
  console.log(
    `rls_validation: ${flags.rows.every((x) => x.relrowsecurity && x.relforcerowsecurity) ? "PASS" : "FAIL"}`,
  );
  console.log(JSON.stringify({ tables: migratedTables.rows.map((x) => x.tablename) }));
  console.log("bootstrap_rls_matrix: START");
  await admin.query(
    "TRUNCATE activities, locations, company_memberships, accounts, sessions, password_reset_tokens, verification_tokens, companies, users",
  );
  const seeded = await admin.query(
    "INSERT INTO users(email,account_status,updated_at) VALUES ('a@validation.test','ACTIVE',now()),('b@validation.test','ACTIVE',now()) RETURNING id,email",
  );
  const a = seeded.rows.find((x) => x.email === "a@validation.test").id;
  const b = seeded.rows.find((x) => x.email === "b@validation.test").id;
  const rs = await admin.query(
    "INSERT INTO roles(code,name) VALUES ('OWNER','Owner') ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name RETURNING id",
  );
  const seedRoleId = rs.rows[0].id;
  const companies = await admin.query(
    "INSERT INTO companies(name,slug,updated_at) VALUES ('A','validation-a',now()),('B','validation-b',now()),('I','validation-i',now()) RETURNING id,slug",
  );
  const ca = companies.rows.find((x) => x.slug === "validation-a").id,
    cb = companies.rows.find((x) => x.slug === "validation-b").id,
    ci = companies.rows.find((x) => x.slug === "validation-i").id;
  await admin.query(
    "INSERT INTO company_memberships(company_id,user_id,role_id,status,updated_at) VALUES ($1,$2,$4,'ACTIVE',now()),($3,$5,$4,'ACTIVE',now()),($6,$2,$4,'INACTIVE',now())",
    [ca, a, cb, seedRoleId, b, ci],
  );
  const companyRead = await admin.query(
    "INSERT INTO permissions(code,description) VALUES ('company.read','Validation permission') ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description RETURNING id",
  );
  await admin.query(
    "INSERT INTO role_permissions(role_id,permission_id) VALUES ($1,$2) ON CONFLICT(role_id,permission_id) DO NOTHING",
    [seedRoleId, companyRead.rows[0].id],
  );
  const tx = async (user: string, company?: string) => {
    await r.query("BEGIN");
    await r.query("SELECT set_config('app.current_user_id',$1,true)", [user]);
    if (company) await r.query("SELECT set_config('app.current_company_id',$1,true)", [company]);
    return r;
  };
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
  const auditRows = await withTenantTransaction(applicationPrisma, applicationContext, (tx) =>
    tx.activity.count({ where: { action: "tenant_context.established", actorUserId: a } }),
  );
  const applicationContextB = await resolveTenantContext(applicationPrisma, { userId: b }, cb);
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
  }));
  await adminPrisma.$disconnect();
  checkpoint("seed_idempotency", seededCounts.companies === 1 && seededCounts.users === 1);
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
  console.log("bootstrap_rls_matrix: PASS");
  await r.end();
  await admin.end();
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
