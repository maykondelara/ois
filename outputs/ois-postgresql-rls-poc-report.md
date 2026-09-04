# OIS PostgreSQL / RLS Proof of Concept — Step 0

**Status:** PASS  
**Environment:** Railway `ois-postgresql-rls-poc` / `production`  
**Database service:** `Postgres` (private network)  
**Scope:** Temporary database/RLS validation only. No Phase 2 application foundation was implemented.

## Results

| Test | Result | Evidence |
|---|---|---|
| Railway PostgreSQL availability | PASS | Database service was online and the POC ran inside the Railway private network. |
| PostgreSQL version | PASS | `server_version_num = 180006` (PostgreSQL 18.0.6). |
| UUIDv7 | PASS | Native `uuidv7()` returned a UUID. No extension or application-side UUID fallback is required. |
| Separate roles | PASS | Temporary `ois_poc_migrator` and `ois_poc_app` login roles were created separately. |
| Runtime NOBYPASSRLS | PASS | Both temporary roles reported `rolbypassrls = false`; the runtime role was not a table owner. |
| Migration responsibility | PASS | Only the migrator role received database `CREATE`; the app role received only `CONNECT`, schema usage, and table DML grants. |
| RLS and FORCE RLS | PASS | PostgreSQL reported both `relrowsecurity` and `relforcerowsecurity` as true for the tenant-owned test table. |
| Tenant context | PASS | The POC set `app.current_company_id` using `set_config(..., true)`, PostgreSQL's transaction-local equivalent of `SET LOCAL`. |
| Legitimate Company A read | PASS | Company A saw exactly its own row. |
| Company A reads Company B | PASS | Company B's row was invisible to Company A. |
| Company A modifies Company B | PASS | Update affected zero rows and Company B's original value remained unchanged. |
| No tenant context | PASS | No tenant-owned rows were visible without a transaction-local tenant setting. |
| Prisma compatibility | PASS | Prisma 6.19.0 executed the RLS-scoped transactions successfully. |
| Connection-pool isolation | PASS | 100 alternating Company A/Company B Prisma transactions ran through one pooled PostgreSQL backend connection; no context leakage occurred. |

## Implemented POC pattern

1. An administrative connection created temporary database roles.
2. The migrator role created a temporary schema and RLS-protected table.
3. The app role received only required runtime privileges and `NOBYPASSRLS`.
4. Each Prisma transaction set `app.current_company_id` as a transaction-local setting before tenant queries.
5. RLS policies compared table `company_id` against that setting for reads and writes.
6. The POC removed its temporary schema, data, grants, and roles at completion.

## Issues encountered and resolved within the POC

- Newly created roles require explicit `CONNECT` on the Railway database.
- The migration role also needs `CREATE` on the database to create the application schema; the runtime role does not.
- A temporary role cannot be dropped while it retains database grants. Cleanup must revoke privileges and drop owned objects before dropping the role.

These are ordinary PostgreSQL privilege requirements, not incompatibilities with Railway, PostgreSQL RLS, or Prisma.

## Recommendation

Proceed with the approved RLS architecture unchanged:

- PostgreSQL 18 native UUIDv7 defaults.
- Separate `ois_migrator` and `ois_app` roles.
- `NOBYPASSRLS` for the runtime role.
- `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY` on all tenant-owned tables.
- One `withTenantTransaction` boundary that establishes tenant context using transaction-local `set_config` before any tenant query.
- Repositories use only the transaction-bound Prisma client inside that boundary.

## POC artefacts

- POC source: `poc/rls-poc.ts`
- Minimal Prisma contract: `prisma/schema.prisma`
- Temporary POC container definition: `Dockerfile`
- Temporary Railway service: `ois-rls-poc`

The temporary Railway service remains available for inspection. It can be removed after the report is accepted; do not use it as the future application service.
