/* eslint-disable no-unused-vars */
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Client } from "pg";

type Result = { name: string; passed: boolean; detail: string };

const results: Result[] = [];
const schema = "ois_rls_poc";
const migratorRole = "ois_poc_migrator";
const appRole = "ois_poc_app";
const databaseUrl = process.env.DATABASE_URL ?? "";

if (!databaseUrl)
  throw new Error("DATABASE_URL is required inside the temporary Railway POC service.");

const companyA = randomUUID();
const companyB = randomUUID();
const migratorPassword = randomBytes(32).toString("hex");
const appPassword = randomBytes(32).toString("hex");

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function cleanup(admin: Client) {
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  for (const role of [appRole, migratorRole]) {
    const exists = await admin.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists",
      [role],
    );
    if (exists.rows[0]?.exists) {
      await admin.query(`DROP OWNED BY ${role}`);
      await admin.query(
        `REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdentifier(databaseName)} FROM ${role}`,
      );
      await admin.query(`DROP ROLE ${role}`);
    }
  }
}

function record(name: string, passed: boolean, detail: string) {
  results.push({ name, passed, detail });
  if (!passed) throw new Error(`${name}: ${detail}`);
}

function roleUrl(role: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = role;
  url.password = password;
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "10");
  return url.toString();
}

async function withClient<T>(url: string, operation: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.end();
  }
}

async function tenantRows(prisma: PrismaClient, companyId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
    return tx.$queryRaw<Array<{ company_id: string; value: string }>>`
      SELECT company_id::text, value FROM ois_rls_poc.tenant_rows ORDER BY value
    `;
  });
}

async function noTenantRows(prisma: PrismaClient) {
  return prisma.$transaction(
    (tx) =>
      tx.$queryRaw<
        Array<{ company_id: string }>
      >`SELECT company_id::text FROM ois_rls_poc.tenant_rows`,
  );
}

async function run() {
  const admin = new Client({ connectionString: databaseUrl });
  let prisma: PrismaClient | undefined;

  try {
    await admin.connect();
    const version = await admin.query<{ server_version_num: string }>("SHOW server_version_num");
    record(
      "server_version_num",
      Number(version.rows[0]?.server_version_num) >= 180000,
      `PostgreSQL ${version.rows[0]?.server_version_num ?? "unknown"}`,
    );

    const uuid = await admin.query<{ value: string }>("SELECT uuidv7()::text AS value");
    record("uuidv7()", Boolean(uuid.rows[0]?.value), "Native uuidv7() returned a UUID.");

    await cleanup(admin);
    await admin.query(
      `CREATE ROLE ${migratorRole} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${migratorPassword}'`,
    );
    await admin.query(
      `CREATE ROLE ${appRole} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${appPassword}'`,
    );
    const databaseName = new URL(databaseUrl).pathname.slice(1);
    await admin.query(
      `GRANT CONNECT, CREATE ON DATABASE ${quoteIdentifier(databaseName)} TO ${migratorRole}`,
    );
    await admin.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${appRole}`);

    const roleCheck = await admin.query<{ rolname: string; rolbypassrls: boolean }>(
      "SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ($1, $2) ORDER BY rolname",
      [appRole, migratorRole],
    );
    const roleMap = new Map(roleCheck.rows.map((row) => [row.rolname, row.rolbypassrls]));
    record(
      "separate migrator/app roles with NOBYPASSRLS",
      roleMap.get(appRole) === false &&
        roleMap.get(migratorRole) === false &&
        roleCheck.rows.length === 2,
      "Both temporary login roles exist and neither can bypass RLS.",
    );

    await withClient(roleUrl(migratorRole, migratorPassword), async (migrator) => {
      await migrator.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${migratorRole}`);
      await migrator.query(
        `CREATE TABLE ${schema}.companies (id uuid PRIMARY KEY DEFAULT uuidv7(), name text NOT NULL)`,
      );
      await migrator.query(
        `CREATE TABLE ${schema}.tenant_rows (id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL REFERENCES ${schema}.companies(id), value text NOT NULL)`,
      );
      await migrator.query(`ALTER TABLE ${schema}.tenant_rows ENABLE ROW LEVEL SECURITY`);
      await migrator.query(`ALTER TABLE ${schema}.tenant_rows FORCE ROW LEVEL SECURITY`);
      await migrator.query(
        `CREATE POLICY tenant_select ON ${schema}.tenant_rows FOR SELECT USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)`,
      );
      await migrator.query(
        `CREATE POLICY tenant_insert ON ${schema}.tenant_rows FOR INSERT WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)`,
      );
      await migrator.query(
        `CREATE POLICY tenant_update ON ${schema}.tenant_rows FOR UPDATE USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)`,
      );
      await migrator.query(`GRANT USAGE ON SCHEMA ${schema} TO ${appRole}`);
      await migrator.query(`GRANT SELECT, INSERT, UPDATE ON ${schema}.tenant_rows TO ${appRole}`);
    });

    const rlsFlags = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = 'tenant_rows'",
      [schema],
    );
    record(
      "RLS enabled and FORCE RLS enabled",
      rlsFlags.rows[0]?.relrowsecurity === true && rlsFlags.rows[0]?.relforcerowsecurity === true,
      "The tenant table has both PostgreSQL RLS flags enabled.",
    );

    await admin.query(
      `INSERT INTO ${schema}.companies (id, name) VALUES ($1, 'Company A'), ($2, 'Company B')`,
      [companyA, companyB],
    );
    await admin.query(
      `INSERT INTO ${schema}.tenant_rows (company_id, value) VALUES ($1, 'A-original'), ($2, 'B-original')`,
      [companyA, companyB],
    );
    record(
      "two companies and tenant-owned rows",
      true,
      "Seeded Company A and Company B with one row each.",
    );

    prisma = new PrismaClient({ datasources: { db: { url: roleUrl(appRole, appPassword) } } });
    await prisma.$connect();

    const aRows = await tenantRows(prisma, companyA);
    record(
      "Company A legitimate read",
      aRows.length === 1 && aRows[0]?.value === "A-original",
      "Company A can read only its own row.",
    );

    const bRowsFromA = await tenantRows(prisma, companyA);
    record(
      "Company A cannot read Company B",
      bRowsFromA.every((row) => row.company_id === companyA),
      "Company B row is invisible to Company A.",
    );

    const updateCount = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyA}, true)`;
      return tx.$executeRaw`UPDATE ois_rls_poc.tenant_rows SET value = 'tampered' WHERE company_id = ${companyB}::uuid`;
    });
    const bRows = await tenantRows(prisma, companyB);
    record(
      "Company A cannot modify Company B",
      updateCount === 0 && bRows.length === 1 && bRows[0]?.value === "B-original",
      "Cross-tenant update affected zero rows and Company B data remains unchanged.",
    );

    const unscopedRows = await noTenantRows(prisma);
    record(
      "no tenant context denied",
      unscopedRows.length === 0,
      "No RLS-protected rows are visible without transaction-local tenant context.",
    );
    record(
      "transaction-local tenant context",
      unscopedRows.length === 0,
      "set_config(..., true) scoped the tenant setting to its transaction; a following transaction had no visible tenant rows.",
    );

    let alternationPassed = true;
    const backendPids = new Set<number>();
    for (let index = 0; index < 100; index += 1) {
      const companyId = index % 2 === 0 ? companyA : companyB;
      const expected = index % 2 === 0 ? "A-original" : "B-original";
      const outcome = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
        const pid = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
        const rows = await tx.$queryRaw<
          Array<{ value: string }>
        >`SELECT value FROM ois_rls_poc.tenant_rows`;
        return { pid: pid[0]?.pid, values: rows.map((row) => row.value) };
      });
      if (outcome.pid) backendPids.add(outcome.pid);
      if (outcome.values.length !== 1 || outcome.values[0] !== expected) alternationPassed = false;
    }
    const afterAlternation = await noTenantRows(prisma);
    record(
      "Prisma pooled alternating-tenant isolation",
      alternationPassed && afterAlternation.length === 0 && backendPids.size === 1,
      `100 alternating transactions used ${backendPids.size} pooled backend connection(s) with no tenant-context leakage.`,
    );
  } finally {
    await prisma?.$disconnect();
    try {
      await cleanup(admin);
    } finally {
      await admin.end();
    }
  }
}

run()
  .then(() => {
    console.table(results);
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    console.table(results);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
