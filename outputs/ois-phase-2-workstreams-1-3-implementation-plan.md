# Operations Intelligence System — Phase 2 detailed implementation plan

**Scope:** Workstreams 1–3 only: foundation/environments, database/tenant safety, identity/authorisation.  
**Status:** Planning only. This document intentionally contains no application code.

## A. Executive implementation summary

Phase 2 establishes the OIS security and delivery foundation before any operational product screen or workflow is built. The outcome is a deployable Next.js application with credential-based authentication, company membership, server-enforced RBAC, PostgreSQL Row-Level Security (RLS), auditable identity actions, and a tested cross-tenant security boundary.

The initial deployment recommendation is **container-based hosting on Railway**: one Next.js web service, a managed PostgreSQL 18 database, managed Redis, and a separate worker service reserved for the later BullMQ workstream. Use Cloudflare R2 for production object storage. This is simpler and safer than Vercel for this architecture because it supports both the web process and a persistent worker with the same deployment model. The worker is not implemented in Workstreams 1–3.

The Phase 2 schema is intentionally small. Create only identity/tenancy, Auth.js support tables, locations (as a useful tenant-owned test record), and audit activities. Define—but do not migrate—the operational entities until their respective Phase 3 modules are authorised. Adding unused operational tables now would create migration and permission obligations without any feature using them.

### Non-negotiable boundaries

- No dashboard, operations UI, integrations, AI, notifications, or workflow implementation.
- Auth pages are permitted because they are infrastructure, not a product module UI.
- Tenant authority always derives from a valid server-side session and membership—not from a request body, URL parameter, cookie, or browser state.
- Every tenant-owned database operation runs inside a tenant-scoped transaction and is additionally protected by RLS.
- The production runtime database role is not the migration/table-owner role and does not have `BYPASSRLS`.

## B. Workstream 1 — Foundation and environments

### 1. Repository and project setup

#### Baseline choices

| Area | Decision |
|---|---|
| Runtime | Node.js 24 LTS, pinned in `.node-version`; CI uses the same major release. |
| Package manager | pnpm, with committed lockfile and `packageManager` metadata. |
| Framework | Latest supported stable Next.js App Router release compatible with the selected stable React version. |
| Language | TypeScript with `strict: true`; no JavaScript application source. |
| Styling | Tailwind CSS plus shadcn/ui initialisation, but no product UI components yet. |
| Database access | Prisma ORM; generated client outside version control. |
| Test tools | Vitest for unit/integration tests, Playwright for a small auth security suite. |

#### Initial directories

```text
.github/workflows/          CI
.husky/                     local Git hooks
docker/                     local infrastructure configuration
docs/                       architecture decision records and runbooks
prisma/                     schema, migrations, seed entry point
src/
  app/                      App Router routes, auth pages, API route roots
  auth/                     session, credentials, tenant resolution
  db/                       Prisma client, transaction and repository conventions
  lib/                      environment, IDs, errors, request context, validation
  modules/identity/         identity and membership services only
  modules/companies/        company/location services only
  modules/activities/       audit service and action registry
  services/storage/         storage interface and local adapter boundary only
  tests/                    unit, integration, e2e support
tests/e2e/                  Playwright specifications
```

Create empty module barrels only where a Phase 2 responsibility exists. Do not scaffold future drivers, vehicles, inspection, AI, integration, workflow, or notification modules.

#### Project configuration requirements

- Use the `@/` alias for `src/`; do not use long relative imports across modules.
- Keep route handlers under `src/app/api/v1`; Auth.js remains at its framework-required route path.
- `src/app/(auth)` contains sign-in, reset-request, and reset-confirmation routes. These are the only user-facing pages in scope.
- The root route must redirect to sign-in or return a minimal authenticated-not-configured response. It must not become a placeholder dashboard.
- Configure Next.js to keep server-only environment variables out of client bundles. Only variables prefixed `NEXT_PUBLIC_` may be referenced by client components.
- Add package scripts: `dev`, `build`, `start`, `lint`, `format`, `format:check`, `typecheck`, `test`, `test:unit`, `test:integration`, `test:e2e`, `db:generate`, `db:validate`, `db:migrate:dev`, `db:migrate:deploy`, `db:seed`, and `infra:up` / `infra:down`.

### 2. Code quality controls

| Control | Plan | Local use | CI use |
|---|---|---|---|
| ESLint | Next.js TypeScript rules plus import-boundary and security-oriented rules where stable. | `lint` before PR | Required |
| Prettier | One repository-wide formatting configuration. | pre-commit on staged source/config files | Required check |
| TypeScript | Strict compiler, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and no ignored errors without rationale. | `typecheck` | Required |
| Tests | Vitest and Playwright. | targeted tests while developing | Required suites appropriate to change |
| Hooks | Husky + lint-staged run formatting and ESLint on staged supported files. Do not run a full test suite in pre-commit. | Required after toolchain setup | N/A |

Use ESLint as the code-quality rule engine and Prettier only for formatting. Do not introduce a second formatter/linter stack. CI remains the source of truth; hooks are convenience checks and must be bypassable only with an explicit documented reason.

### 3. Local development infrastructure

Use `docker-compose.yml` solely for local dependencies. The application itself runs through `pnpm dev` to retain fast Next.js feedback.

| Service | Local port | Development-only identity | Persistence | Health check |
|---|---:|---|---|---|
| PostgreSQL 18 | 5432 | database `ois_local`; user `ois_local_app`; password stored only in untracked `.env.local` | named volume `postgres_data` | `pg_isready` |
| Redis 7 | 6379 | no password locally by default, bound to loopback via Docker port mapping | named volume `redis_data` | `redis-cli ping` |
| MinIO | 9000 API / 9001 console | access key `ois_local_minio`; secret only in `.env.local` | named volume `minio_data` | MinIO readiness endpoint |

Requirements:

- Keep template values in `.env.example` visibly non-secret, for example `change-me-local-only`; developers copy it to `.env.local` and choose local values.
- Compose creates an application bucket named `ois-local-private`; a bootstrap container or documented one-time command applies the bucket policy. The bucket is private by default.
- Never expose compose ports on non-loopback interfaces in shared development environments.
- `.env.local`, database dumps, uploaded test files, and named volumes are excluded from Git.
- Test infrastructure uses a separate `ois_test` database and test bucket. Tests may truncate/reset only that isolated environment.

### 4. Environment strategy

| Environment | Purpose | Data rules | Deployment source |
|---|---|---|---|
| Local | Developer work | Synthetic/local data only; disposable | local machine + Docker Compose |
| Staging | Integration, migrations, release verification | Seeded demo company only; no customer data | protected `staging` branch or release workflow |
| Production | Customer service | Real customer data; backups, access logging, restricted access | approved release from main |

#### Variable groups

| Group | Variables | Classification |
|---|---|---|
| App | `NODE_ENV`, `APP_URL`, `LOG_LEVEL` | server-only, except intentionally exposed safe URL if needed |
| Database | `DATABASE_URL`, `DIRECT_URL` | secret, server-only |
| Auth | `AUTH_SECRET`, `AUTH_URL`, password-reset email credentials | secret, server-only |
| Redis | `REDIS_URL` | secret, server-only |
| Storage | endpoint, region, bucket, access key, secret key | endpoint/bucket may be server configuration; credentials secret/server-only |
| Observability | Sentry DSN and release identifier | DSN may be public only if deliberately used client-side; auth token secret/server-only |
| Public | `NEXT_PUBLIC_APP_NAME`, intentionally public Sentry DSN only | browser-safe, minimal |

`src/lib/env/server` validates all server variables at process start with Zod. `src/lib/env/client` validates the small public subset during build/client initialisation. Validation must fail fast in staging/production for absent or malformed required values; local optional values may be conditionally required only when the feature is enabled. Do not read `process.env` directly outside environment modules.

Secrets live in Railway service variables for staging/production and in the password manager plus `.env.local` for developers. Rotation instructions belong in the operations runbook. `.env.example` documents variable names, classification, sample formats, and whether a variable is required—not actual secrets.

### 5. CI/CD plan

Use one GitHub Actions pull-request workflow and one protected deployment workflow. Do not add preview databases or infrastructure-as-code in this phase.

#### Pull-request workflow

1. Check out the repository and set up the pinned Node/pnpm version.
2. Install with frozen lockfile.
3. Run format check, ESLint, and strict typecheck.
4. Generate Prisma client and run Prisma schema validation/format check.
5. Start PostgreSQL, Redis, and MinIO as workflow services or Docker Compose dependencies.
6. Apply migrations to an ephemeral CI test database.
7. Run unit and integration tests, including RLS cross-tenant tests.
8. Run the production Next.js build.
9. Run the limited Playwright authentication/security suite if browser infrastructure is available; otherwise make it a required protected-branch workflow before merge.

Required PR blockers: lockfile integrity, formatting, lint, typecheck, Prisma validation, migration application, unit/integration tests, build, and security tests. A failed or skipped required test blocks merge. Dependency scanning may report findings initially but only becomes blocking after a remediation policy is approved.

#### Deployment workflow

- Staging: builds the same commit, runs `prisma migrate deploy` through the migration job using `DIRECT_URL`, then deploys the web service.
- Production: manual approval gate after successful staging verification. Execute migrations as a one-off migration job before deployment; then deploy the web service. A worker service is provisioned but disabled until Workstream 5.
- Build artefacts and migration logs are retained by the CI/deployment platform.

### 6. Initial deployment

Choose **Railway container deployment** for the initial implementation.

Why: Next.js is portable in a container, Railway offers a straightforward web-service plus persistent-worker model, and the same project can host managed PostgreSQL and Redis. Vercel is excellent for the web application but does not naturally host a continuously running BullMQ worker, which would force a second deployment platform immediately. Use Cloudflare R2 for object storage because it is S3-compatible, private, durable, and independent of the compute platform.

Provision only:

- one Railway web service;
- one Railway PostgreSQL 18 service;
- one Railway Redis service;
- one private R2 bucket;
- one disabled/zero-replica worker service definition for future use;
- staging equivalents with no production data.

No Kubernetes, Terraform estate, CDN configuration project, analytics warehouse, or dedicated queue cluster is required now.

## C. Workstream 2 — Database and tenant safety

### 7. Prisma schema and migration scope

#### Create in Phase 2

| Order | Tables | Why now |
|---:|---|---|
| 1 | `companies`, `users`, Auth.js `accounts`, `sessions`, `verification_tokens`, `password_reset_tokens` | Authentication and company ownership cannot operate without them. |
| 2 | `roles`, `permissions`, `role_permissions`, `company_memberships` | Required for capability-based tenant access. |
| 3 | `locations` | Small, real tenant-owned operational entity used to prove repository/RLS/scoping patterns and future company configuration. |
| 4 | `activities` | Required foundation for identity and authorisation audit events. |

`password_reset_tokens` is an application-owned, single-use hashed-token table; it is separate from Auth.js verification tokens so its purpose, expiry, and audit treatment are explicit.

#### Define in the data-model ADR; defer migrations until Phase 3 module approval

| Deferred group | Tables |
|---|---|
| Driver and vehicle foundation | `drivers`, `vehicles`, `vehicle_status_history` |
| File/document domain | `document_files`, `driver_documents`, `vehicle_documents` |
| Inspection and defect domain | `inspection_templates`, `inspection_template_items`, `inspections`, `inspection_items`, `defects` |
| Operations execution | `maintenance_records`, `tasks`, `notifications` |
| Future platform adapters | `integrations`, `integration_sync_runs`, `external_entity_mappings`, `ai_insights`, `outbox_events` |

The ADR must include intended ownership, foreign keys, status lifecycle, tenant indexes, and migration order for these tables. It is deliberately not a Prisma schema migration yet. This avoids unused tables, grants, RLS policies, data-retention commitments, and audits for unbuilt capabilities.

#### Exact Phase 2 schema build order

1. Enable required PostgreSQL extensions and create the runtime/migrator role model.
2. Add base database helper conventions: UUIDv7 default, timestamps, and migrations metadata.
3. Add companies and users, then Auth.js support tables.
4. Add RBAC catalogue tables and memberships.
5. Add locations as the first tenant-owned domain table.
6. Add activities and indexes.
7. Add RLS to tenant-owned tables and policies.
8. Add seed script and test fixtures only after schema stabilises.

### 8. Database conventions

| Convention | Decision |
|---|---|
| Naming | PostgreSQL tables/columns use lowercase `snake_case`; Prisma models use singular PascalCase and explicit `@map`/`@@map` mappings. |
| Primary IDs | `uuid` with database-generated UUIDv7 defaults. PostgreSQL 18’s native UUIDv7 function is the required baseline; validate exact managed-service support before provisioning. |
| Timestamps | `created_at` and `updated_at` are UTC `timestamptz`; database defaults `created_at`; application/ORM updates `updated_at`. Use `occurred_at` for immutable event time. |
| Soft deletion | Do not add generic soft deletion. Use `status`, `archived_at`, or `deactivated_at` only for entities with a defined lifecycle. Auth/activity records are never hard-deleted by ordinary product actions. |
| Statuses | Use PostgreSQL enums only for small, stable, database-enforced lifecycles (membership/account status). Use lookup/configuration tables when values need tenant customisation. Never store free-text statuses. |
| JSON | Use `jsonb` only for structured, versioned metadata or audit payloads that is not queried as core relational data. Keep keys documented and avoid JSON for tenant links, permissions, money, statuses, or search-critical fields. |
| Foreign keys | Every tenant-owned child has `company_id`; reference tenant-owned parents using `(company_id, parent_id)` composite unique/foreign-key pairs where the relation could otherwise cross tenants. |
| Indexes | Every RLS/filter path starts with `company_id`; favour compound indexes matching real predicates, e.g. `(company_id, status)`. Avoid speculative indexes. |
| Uniqueness | Tenant-scoped business identifiers include `company_id`, e.g. unique company slug globally; unique membership `(company_id, user_id)`; unique location name only if product rules require it. |
| Nullability | A column is nullable only when “unknown/not applicable/not yet set” is a valid state. Do not use empty strings as null. |

### 9. Exact tenant-isolation strategy

#### TenantContext

The authenticated request obtains a session user ID. The server loads the selected membership from a server-controlled active-company value, confirms it belongs to that user and is active, loads its role permissions, and creates a `TenantContext`.

The active-company selector may be a signed server-set cookie containing a company ID, but it is only a preference. The membership query decides authority. A route parameter or request body company ID can at most identify a requested resource; it can never establish tenant access.

#### Service and repository rules

- Route handlers call an identity guard once and pass `TenantContext` into a module service.
- Module services call repositories only with the context or the context’s tenant transaction handle.
- Repositories never expose a generic `findById(id)` for tenant-owned tables; they require context and always include `company_id`.
- Multi-tenant administration is not in scope. No “all companies” application runtime query exists.
- Database writes assign `company_id` from `TenantContext`, not input.

#### Transaction model

Use one helper, conceptually `withTenantTransaction(context, operation)`. It opens an interactive Prisma transaction, sets PostgreSQL transaction-local tenant and actor settings as the first statements, then passes the transaction-bound Prisma client to repositories. Every database query inside the operation uses that transaction client; no global Prisma client may be used from inside the callback.

This matters with pooled connections: `SET LOCAL` is limited to the transaction and cannot leak a prior tenant setting to the next request. PostgreSQL documents that `SET LOCAL` lasts only until the current transaction ends. [PostgreSQL SET documentation](https://www.postgresql.org/docs/17/sql-set.html)

### 10. RLS implementation plan

#### Tables covered in Phase 2

| Category | Tables | RLS treatment |
|---|---|---|
| Tenant-owned | `company_memberships`, `locations`, `activities` | Enable and force RLS; policy requires the transaction tenant to match `company_id`. |
| Tenant root | `companies` | Enable/force RLS; policy permits only the active company ID. |
| Global identity/catalogue | `users`, `roles`, `permissions`, `role_permissions`, Auth.js tables, reset tokens | No generic tenant RLS. Access only through narrow identity repositories; sensitive token tables are never exposed to product repositories. |

When later tenant-owned tables are introduced, RLS and tenant indexes are mandatory in the same migration as the table—not a later hardening task.

#### Database roles

- `ois_migrator`: owns schemas/tables and is used only by migration jobs. It is never used by the web runtime.
- `ois_app`: production/staging runtime role, `NOBYPASSRLS`, granted only the necessary table/sequence privileges.
- `ois_test_app`: analogous non-production role used to prove policies.

Use `FORCE ROW LEVEL SECURITY` for tables owned by `ois_migrator`, so accidental use of the owner does not silently evade policies. Confirm the managed PostgreSQL service permits required role grants before committing the platform choice.

#### Policy model

Policies compare a row’s `company_id` to the UUID stored in `current_setting('app.current_company_id', true)`. `SELECT`, `INSERT`, `UPDATE`, and `DELETE` policies must each enforce matching company IDs; insert/update use `WITH CHECK` to stop injected or reassigned tenants. A second optional transaction setting, `app.current_user_id`, is reserved for database functions/audit checks but does not replace application authorisation.

Migrations use reviewed SQL migration files for extensions, roles, `ENABLE/FORCE ROW LEVEL SECURITY`, and policies. Prisma schema migrations remain the source for models and ordinary constraints. This division is intentional because RLS roles/policies are PostgreSQL-specific.

#### Prisma interaction and safeguards

- Use `DATABASE_URL` for the `ois_app` pooled runtime connection and `DIRECT_URL` for migrations.
- All RLS-protected access runs through `withTenantTransaction`; use parameterised raw execution for the two transaction-local settings before repository queries.
- No Prisma middleware or client extension is relied on as the sole RLS mechanism; it cannot guarantee that a setting and subsequent query share a connection unless it owns the transaction boundary.
- Do not use `SET` without `LOCAL`; it risks pooled-connection tenant leakage.
- Do not perform tenant reads outside the tenant transaction, including “harmless” permission checks or logging writes.
- RLS policy tests execute queries as `ois_test_app`, not as the migration owner.

Prisma transactions use the transaction-scoped client for all work in a transaction; global client calls operate outside it. The implementation must enforce this repository convention. [Prisma transaction reference](https://www.prisma.io/docs/orm/reference/transactions-and-runtime)

### 11. Seed-data plan

`prisma/seed.ts` creates only local and staging synthetic data, guarded by an explicit `SEED_MODE=demo` and refusal in production.

Seed contents:

- **Demo Logistics Pty Ltd** with a non-production slug and Australia/Perth time zone.
- Five active user accounts: one each for owner, admin, manager, supervisor, and driver. Passwords come only from seed environment variables and are never committed.
- Seeded role/permission catalogue and the five memberships.
- Two locations (e.g. Perth Depot and Kewdale Yard) under the demo company.
- A second minimal **Isolation Test Transport** company with one owner and one location for tenant isolation tests.

Do not seed vehicles or drivers in Phase 2 because their schema is deferred. The `locations` table is sufficient to test tenant reads/writes and role policies. Production migrations seed only immutable role/permission catalogue records, never demo companies or accounts.

### 12. Database migration strategy

#### Migration lifecycle

1. Developers create forward-only migrations locally against a disposable development database.
2. Review includes generated Prisma migration plus the accompanying reviewed RLS/role SQL migration where needed.
3. CI starts clean PostgreSQL, applies every migration from zero, runs `prisma validate`, applies seed fixtures, and executes integration/security tests.
4. Staging migration job applies the immutable migration chain using `ois_migrator` and `DIRECT_URL` before the application deployment.
5. Production follows staging approval and runs the same migration job once with observability/log capture.

#### Safe-change policy

- No automatic database reset outside local/test environments.
- No rollback by blindly reversing a production migration. Application rollout is rolled back first when possible; data migrations receive an explicit forward repair migration.
- Future breaking changes use expand/contract: add backwards-compatible schema, deploy readers/writers compatible with both forms, backfill in controlled batches, switch reads, then remove old fields in a later release.
- Destructive operations require a reviewed backup/restore plan, affected-row estimate, and explicit release approval.

## D. Workstream 3 — Identity and authorisation

### 13. Authentication plan

Implement **Auth.js credentials authentication now**, rather than delaying identity or adding a social provider. OIS is B2B operational software; password identity is the minimum universal provider, and Auth.js preserves a path to OIDC/SAML later. Social login is not required for the MVP.

#### Account lifecycle

| State | Meaning | Access |
|---|---|---|
| `PENDING_ACTIVATION` | Account provisioned but password not set | Cannot sign in; may use activation/reset link. |
| `ACTIVE` | Normal account | Can sign in, subject to active membership. |
| `SUSPENDED` | Temporarily disabled | Existing sessions invalidated; sign-in denied. |
| `DEACTIVATED` | Closed/removed identity | Sign-in denied; retained according to retention policy. |

#### Required behaviours

- **Sign-in:** Email/password credentials. Normalise email, look up active user, verify Argon2id hash, apply rate limiting, record success/failure audit event, issue Auth.js session.
- **Sign-out:** Destroy session and audit the event. A sign-out endpoint must be CSRF-protected by Auth.js/form conventions.
- **Sessions:** Database-backed sessions, 8-hour idle expiry and 7-day absolute expiry for the initial operational MVP. Renew only on authenticated activity. Store no role/permission authority exclusively in session claims; reload membership/role state when constructing `TenantContext`.
- **Password storage:** Use Argon2id with current OWASP-aligned memory/time/parallelism settings recorded in an ADR. Password hashes only; never log credentials.
- **Reset/activation:** Single-use, hashed, short-lived (30-minute) tokens. Request endpoint always returns a neutral response to prevent account enumeration. Account-recovery email is allowed as identity infrastructure; use a narrowly scoped transactional email provider, not the future product notification service.
- **Cookies:** Secure, HTTP-only, `SameSite=Lax`, production secure flag enabled, host-only cookie scope, HTTPS only. `AUTH_SECRET` is distinct per environment.
- **Protected routes:** Use Auth.js route protection for coarse authentication redirects, then server-side `requireTenant`/`requirePermission` in server components, route handlers, and server actions. Middleware/proxy is not the final authorisation decision.

The Auth.js API exposes server-side session access and framework route handlers; use those in the defined authentication boundary. [Auth.js documentation](https://authjs.dev/)

### 14. TenantContext contract

Conceptual immutable structure:

| Field | Meaning |
|---|---|
| `actorUserId` | Authenticated global user UUID. |
| `companyId` | Authorised active company UUID. |
| `membershipId` | Active company-membership UUID. |
| `roleCode` | Seeded current role code. |
| `permissions` | Read-only set of capability strings loaded from role mapping. |
| `requestId` | Correlation ID for logging/audit propagation. |

Creation sequence:

1. `requireAuthentication` obtains and validates the Auth.js server session.
2. The identity service verifies the user account is `ACTIVE`.
3. The server reads the preferred active-company cookie only as a candidate.
4. It finds an active membership for that user and candidate company; if no valid preference exists, it selects the user’s sole membership or returns a company-selection-required response when several memberships exist.
5. It resolves the role’s permission set, constructs the immutable context, and begins the tenant transaction before accessing tenant-owned data.

Requests without a valid session return unauthenticated. Requests with a session but no active membership return forbidden or company-selection-required; they never receive a default arbitrary tenant. Disabled accounts invalidate their sessions and return forbidden after audit logging.

### 15. RBAC permission matrix

Roles are seeded, not user-editable in Phase 2. Permissions are capability strings and are checked server-side. `company.manage` includes membership administration but does not grant cross-company access.

| Permission | OWNER | ADMIN | MANAGER | SUPERVISOR | DRIVER |
|---|:---:|:---:|:---:|:---:|:---:|
| `company.read` | ✓ | ✓ | ✓ | ✓ |  |
| `company.manage` | ✓ | ✓ |  |  |  |
| `drivers.read` | ✓ | ✓ | ✓ | ✓ | own record only |
| `drivers.manage` | ✓ | ✓ | ✓ |  |  |
| `vehicles.read` | ✓ | ✓ | ✓ | ✓ | assigned only |
| `vehicles.manage` | ✓ | ✓ | ✓ |  |  |
| `inspections.submit` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `inspections.read` | ✓ | ✓ | ✓ | ✓ | own only |
| `inspections.review` | ✓ | ✓ | ✓ | ✓ |  |
| `defects.read` | ✓ | ✓ | ✓ | ✓ | assigned/relevant only |
| `defects.manage` | ✓ | ✓ | ✓ | ✓ |  |
| `tasks.read` | ✓ | ✓ | ✓ | ✓ | assigned only |
| `tasks.manage` | ✓ | ✓ | ✓ | ✓ | update assigned only |
| `maintenance.read` | ✓ | ✓ | ✓ | ✓ |  |
| `maintenance.manage` | ✓ | ✓ | ✓ |  |  |
| `documents.read` | ✓ | ✓ | ✓ | ✓ | own/relevant only |
| `documents.manage` | ✓ | ✓ | ✓ |  |  |
| `reports.read` | ✓ | ✓ | ✓ | ✓ |  |
| `integrations.read` | ✓ | ✓ |  |  |  |
| `integrations.manage` | ✓ | ✓ |  |  |  |

`own`, `assigned`, and `relevant` are **record scope**, not extra permissions. In Phase 2, operational tables do not exist, so the role matrix and scope-policy interfaces are defined/tested with locations and membership administration; operational scope rules are implemented together with their Phase 3 modules. OWNER and ADMIN do not bypass RLS; their broader authority applies only inside their active company.

### 16. Authorisation architecture

Place reusable identity and policy functions under `src/auth/` and narrow record policies under the owning module’s `policies/` directory.

| Guard/service | Responsibility | Failure |
|---|---|---|
| `requireAuthentication` | Return valid session user or reject. | `UnauthenticatedError` → 401 |
| `requireTenantContext` | Validate active account/membership and construct context. | `ForbiddenError` or `TenantSelectionRequiredError` → 403/409 |
| `requirePermission` | Assert one required capability against context permissions. | `ForbiddenError` → 403 |
| `requireRecordAccess` | Apply an explicit module-owned scope policy to a tenant-scoped record. | `NotFoundOrForbiddenError` → externally safe 404/403 policy |
| `withTenantTransaction` | Establish RLS settings and pass a transaction client. | transaction error → mapped server/domain error |

Route handlers and server actions call guards, but services repeat permission checks at their public command boundary. This protects against future callers such as workers, integrations, and scripts. Client-side permission hiding is permitted only as a UX enhancement and never as a security boundary.

### 17. API conventions

Future JSON endpoints use `/api/v1`. Auth.js retains its required authentication route separate from this versioned business API.

| Concern | Convention |
|---|---|
| Handler role | Authenticate, parse/validate Zod input, create request context, call one service, map a typed result/error. No business mutation or raw Prisma access in route handlers. |
| Versioning | `/api/v1` from the first business endpoint; breaking public behaviour requires `/api/v2`, not silent mutation. |
| Pagination | Cursor pagination by default: opaque cursor plus bounded `limit` (default 25, maximum 100). |
| Filtering/sorting | Explicit Zod schema per resource; allowlisted fields/operators only; no arbitrary database field names. |
| Errors | Stable envelope containing `error.code`, safe `message`, `requestId`, and field details only for validation failures. |
| Statuses | 200/201 success, 204 no content, 400 invalid request, 401 unauthenticated, 403 unauthorised, 404 non-disclosing resource absence where needed, 409 conflict, 422 semantic validation error, 429 rate limited, 500 unexpected failure. |
| Correlation | Create or accept a validated `X-Request-Id`; always return it and include it in logs/audit records. |

### 18. Audit logging foundation

`activities` is an append-only application audit table. It is not a full event-sourcing system.

Required columns: ID, company ID when applicable, actor user ID (nullable only for system events), action code, entity type, entity ID, occurred-at UTC, request ID, source (`web`, `api`, `system`), and versioned `metadata` JSONB.

Action names use lowercase dot notation, for example:

- `auth.login_succeeded`, `auth.login_failed`, `auth.logout`
- `auth.password_reset_requested`, `auth.password_reset_completed`
- `user.account_activated`, `user.account_suspended`, `user.account_deactivated`
- `membership.created`, `membership.role_changed`, `membership.deactivated`
- `role.permissions_changed` (future administrative capability; role catalogue is immutable in Phase 2)
- `tenant.active_company_changed`

During Phase 2, audit only identity/security and tenant administration actions. Metadata contains safe facts such as prior/new role code, never plaintext passwords, reset tokens, session tokens, connection strings, or full request bodies. Writes happen in the same tenant transaction as the audited membership/company action. Authentication failures that lack a resolved company are captured by structured security logs and optionally a global security audit record only after privacy/retention approval.

## E. Exact file plan

The following is the complete planned file inventory for Workstreams 1–3. Framework-generated lockfiles and generated Prisma client output are omitted because they are not manually authored.

| File | Purpose | Dependencies | Responsibilities |
|---|---|---|---|
| `.node-version` | Runtime pin | Node | Declares Node 24 LTS. |
| `package.json` | Commands/dependencies | pnpm | Declares runtime, quality, test, auth, Prisma packages and scripts. |
| `pnpm-lock.yaml` | Reproducible packages | pnpm | Committed exact dependency graph. |
| `.gitignore` | Secret/generated-file safety | Git | Excludes env files, generated client, test output, dumps. |
| `.env.example` | Environment contract | docs | Names/formats/classification; no secret values. |
| `docker-compose.yml` | Local dependencies | Docker | PostgreSQL, Redis, MinIO, network, volumes, health checks. |
| `docker/minio-init.sh` | Local bucket bootstrap | MinIO | Creates private local/test buckets only. |
| `.dockerignore` | Safe container context | Docker | Excludes local/env/test artefacts. |
| `Dockerfile` | Web/worker-compatible build image | Next.js, Node | Multi-stage application build; no deployment secrets. |
| `next.config.ts` | Next.js controls | Next.js | Server configuration, security-related build options. |
| `tsconfig.json` | Type safety/path aliases | TypeScript | Strict options and `@/` mapping. |
| `eslint.config.mjs` | Lint rules | ESLint, Next | TypeScript/Next/import boundary rules. |
| `.prettierrc.json` | Formatting rules | Prettier | Single formatting source. |
| `.prettierignore` | Formatting exclusions | Prettier | Generated/build/vendor exclusions. |
| `.lintstagedrc.json` | Staged checks | lint-staged | Applies formatter/linter to changed eligible files. |
| `.husky/pre-commit` | Local check hook | Husky | Executes lint-staged. |
| `.github/workflows/ci.yml` | PR quality gate | GitHub Actions | Install, quality, DB/migration/test/build jobs. |
| `.github/workflows/deploy.yml` | Controlled deployment | GitHub Actions/Railway | Staging/prod migration and deploy gates. |
| `docs/adr/0001-deployment-platform.md` | Architecture record | this plan | Records Railway/R2 choice and review trigger. |
| `docs/adr/0002-tenant-isolation-and-rls.md` | Architecture record | PostgreSQL/Prisma | Records transaction/RLS/role model. |
| `docs/adr/0003-authentication-and-sessions.md` | Architecture record | Auth.js | Records credentials, expiry, reset and future SSO boundary. |
| `docs/runbooks/local-development.md` | Developer instructions | Docker/pnpm | Local startup, reset, seed, test guidance. |
| `docs/runbooks/migrations.md` | Migration safety | Prisma/Postgres | Local/staging/prod migration process. |
| `docs/runbooks/deployment.md` | Release operations | Railway | Release, rollback, secret rotation, restore references. |
| `prisma/schema.prisma` | Database contract | Prisma/Postgres | Phase 2 models/mappings/indexes only. |
| `prisma/migrations/<timestamp>_initial_identity/migration.sql` | Base migration | PostgreSQL | Extensions, models, constraints, roles/RLS policy SQL as reviewed. |
| `prisma/seed.ts` | Non-prod demo data | Prisma, Argon2 | Guarded role catalogue/demo tenant fixture creation. |
| `prisma.config.ts` | Prisma configuration | Prisma | Schema location and direct migration URL. |
| `src/app/layout.tsx` | Global app shell | Next | Minimal metadata, font, global style import. |
| `src/app/globals.css` | Base style tokens | Tailwind | Base Tailwind/shadcn styling only. |
| `src/app/page.tsx` | Root behaviour | auth | Redirects appropriately; no placeholder product screen. |
| `src/app/(auth)/sign-in/page.tsx` | Authentication UI | Auth.js | Sign-in form/page only. |
| `src/app/(auth)/reset-password/page.tsx` | Account recovery UI | identity service | Neutral reset-request form. |
| `src/app/(auth)/reset-password/confirm/page.tsx` | Account recovery UI | identity service | Token/password confirmation form. |
| `src/app/api/auth/[...nextauth]/route.ts` | Auth.js route adapter | `src/auth/auth.ts` | Exposes required Auth.js handlers. |
| `src/app/api/v1/health/route.ts` | Health endpoint | environment | Reports non-sensitive readiness/liveness. |
| `src/auth/auth.ts` | Auth.js configuration | Prisma, credentials | Providers, callbacks, session strategy, handlers. |
| `src/auth/credentials.ts` | Credential verification | Argon2, identity repo | Email normalization, rate-limit hook, password verification. |
| `src/auth/session.ts` | Session/session-user access | Auth.js | Server session retrieval and typed session fields. |
| `src/auth/tenant-context.ts` | Context creation | membership/role repos | Validates account/membership and returns immutable context. |
| `src/auth/guards.ts` | Auth/authz guards | session/context/policy | `require…` boundaries and typed errors. |
| `src/auth/permissions.ts` | Capability registry | RBAC | Canonical permission strings and helpers. |
| `src/auth/record-scope.ts` | Scope policy contract | TenantContext | Interface for future module record scopes; no operations logic. |
| `src/db/client.ts` | Prisma singleton | Prisma | Server-only runtime client creation. |
| `src/db/tenant-transaction.ts` | RLS transaction boundary | Prisma/TenantContext | Opens transaction, sets local DB context, exposes tx client. |
| `src/db/repository-types.ts` | Repository contract | Prisma | Prevents unscoped tenant repository interfaces. |
| `src/db/repositories/user-repository.ts` | Identity reads/writes | Prisma | Narrow global user operations. |
| `src/db/repositories/membership-repository.ts` | Membership access | Prisma/RLS | Tenant and membership queries. |
| `src/db/repositories/company-repository.ts` | Company access | Prisma/RLS | Tenant-root queries. |
| `src/db/repositories/location-repository.ts` | First tenant-record example | Prisma/RLS | Context-required location operations. |
| `src/db/repositories/activity-repository.ts` | Audit persistence | Prisma/RLS | Append-only activity writes. |
| `src/modules/identity/identity-service.ts` | Account lifecycle | auth/repos/audit | Activation, suspension, credential/reset flows. |
| `src/modules/identity/membership-service.ts` | Membership lifecycle | context/repos/audit | Create/change/deactivate membership with permission checks. |
| `src/modules/identity/identity-schemas.ts` | Input contracts | Zod | Auth/account/membership validation. |
| `src/modules/companies/company-service.ts` | Tenant root operations | guards/repos/audit | Company read/manage operations permitted in scope. |
| `src/modules/companies/location-service.ts` | Tenant example service | guards/repos/audit | Location operations used for access tests; no product UI. |
| `src/modules/companies/company-schemas.ts` | Input contracts | Zod | Company/location validation. |
| `src/modules/activities/activity-service.ts` | Audit boundary | repo/request context | Canonical event creation and metadata hygiene. |
| `src/modules/activities/activity-actions.ts` | Audit catalogue | TypeScript | Allowed Phase 2 action names. |
| `src/lib/env/server.ts` | Server env validation | Zod | Validates private variables once. |
| `src/lib/env/client.ts` | Public env validation | Zod | Validates browser-safe variables. |
| `src/lib/errors.ts` | Error taxonomy | TypeScript | Typed domain/auth/API errors and safe mappings. |
| `src/lib/request-context.ts` | Correlation IDs | Next.js | Request ID creation/propagation. |
| `src/lib/ids.ts` | UUID type helper | PostgreSQL convention | Documents/validates UUID IDs; generation remains database-default. |
| `src/lib/passwords.ts` | Password policy boundary | Argon2id | Hashing policy and safe verification wrapper. |
| `src/lib/rate-limit.ts` | Auth rate-limit boundary | Redis | Login/reset rate-limiting contract. |
| `src/lib/validation.ts` | Validation helpers | Zod | Shared parse/error conversion helpers. |
| `src/services/storage/storage-provider.ts` | Future storage contract | TypeScript | Signed-upload/download interface only. |
| `src/services/storage/minio-storage-provider.ts` | Local adapter | S3 SDK | Local-only/test storage adapter boundary; no document module. |
| `src/tests/setup.ts` | Test bootstrap | Vitest | Environment, DB cleanup safeguards. |
| `src/tests/factories/tenant-factory.ts` | Security test fixtures | Prisma | Creates isolated tenants/users/memberships. |
| `src/tests/helpers/test-tenant-transaction.ts` | RLS test helper | Prisma | Runs assertions as runtime DB role/context. |
| `src/tests/unit/permissions.test.ts` | Unit coverage | Vitest | Role-permission mapping assertions. |
| `src/tests/unit/tenant-context.test.ts` | Unit coverage | Vitest | Selection/invalid-membership rules. |
| `src/tests/unit/validation.test.ts` | Unit coverage | Vitest | Zod input/error rules. |
| `src/tests/integration/authentication.test.ts` | Integration coverage | Postgres/Auth.js | Sign-in/session/disabled account/reset flow. |
| `src/tests/integration/tenant-repositories.test.ts` | Integration coverage | Postgres/RLS | Context-scoped repository behaviour. |
| `src/tests/integration/rls.test.ts` | Security coverage | Postgres runtime role | Direct read/write cross-tenant policy denial. |
| `src/tests/integration/audit.test.ts` | Integration coverage | Postgres | Required identity events and safe metadata. |
| `tests/e2e/auth-security.spec.ts` | Browser-level verification | Playwright | Protected route, sign-in/out, suspension, invalid membership. |

## F. Recommended implementation sequence

| Step | Deliverable | Why now / dependency | Gate before proceeding |
|---:|---|---|---|
| 1 | Repository initialisation, Node/pnpm, Next.js/TypeScript structure | Establishes one reproducible toolchain. | Clean install, dev server, strict typecheck. |
| 2 | Quality configuration and Git hooks | Prevents inconsistent foundations from accumulating. | Format/lint/typecheck scripts pass. |
| 3 | Docker Compose and `.env.example` | Database-dependent design needs reliable local services. | Postgres, Redis, MinIO healthy; no secrets tracked. |
| 4 | Environment validation and request context | All later services must fail safely and trace requests. | Invalid/absent staging config fails at startup. |
| 5 | Prisma setup and role/extension proof of concept | RLS is the highest-risk technical constraint. | Runtime app role, migrator role, UUIDv7 support, and transaction-local setting work on local and target staging provider. |
| 6 | Initial identity/tenancy migration | Provides durable companies/users/memberships. | Clean database migrates from zero; constraints reviewed. |
| 7 | RBAC catalogue, location, activity schemas and RLS migration | Builds tenant-owned data/test target before application access. | RLS policies deny direct cross-tenant read/write as `ois_test_app`. |
| 8 | Seed and test fixture infrastructure | Enables repeatable realistic security tests. | Demo and isolation fixtures load only outside production. |
| 9 | Auth.js credentials/session/reset implementation plan execution | Requires identity schema and environment controls. | Active user signs in; disabled/pending user cannot; reset token is hashed/single-use. |
| 10 | TenantContext, guards, transaction/repository conventions | Requires session, membership, RBAC, RLS. | All tenant queries flow through tenant transaction; no unscoped repository API is exposed. |
| 11 | Identity, membership, and audit services | Uses approved authz/security boundaries. | Membership lifecycle writes auditable events in the same transaction. |
| 12 | Unit/integration/security test suite | Validates the foundation before delivery automation. | Cross-tenant, privilege, disabled-account, and invalid-membership tests pass. |
| 13 | CI workflow | Automates the known-good gates. | PR checks run cleanly from a fresh clone. |
| 14 | Staging provisioning/deployment runbook | Verifies managed provider behaviour—not just local Docker. | Staging migration, app deployment, login, RLS security tests, and backup check pass. |

Do not begin Phase 3 operational modules until Step 14 is successful. In particular, do not treat application-level filters as sufficient if the staging RLS proof fails.

## G. Testing plan

### Unit tests

- Role-to-permission mapping exactly matches the approved matrix.
- Permission strings are canonical and unsupported permissions cannot be requested.
- `TenantContext` chooses only an active membership belonging to the authenticated user.
- Multiple memberships require a valid server-validated active-company choice.
- Zod schemas reject invalid IDs, impossible statuses, unknown filter fields, and unsafe page limits.
- Password policy/Argon2 wrapper tests verify no plaintext output or logging path.
- Audit action registry accepts approved action names and rejects arbitrary action text.

### Integration tests

- Auth credential success, failure, neutral reset response, expired/used reset token, sign-out, session expiry, account suspension and deactivation.
- Prisma migrations apply cleanly to empty PostgreSQL and seed only non-production fixtures.
- Tenant transaction sets company context before queries and rolls it back/clears it at transaction end.
- Company, membership, location, and activity repositories require context and use tenant filters.
- Activity records are committed/rolled back atomically with membership changes.
- RLS runtime-role queries work for rows of the active company and fail for other-company rows.

### Explicit security tests

| Scenario | Expected outcome |
|---|---|
| Company A user queries Company B location through service/API | No record returned; externally safe 404/403; RLS also denies direct query. |
| Company A user modifies Company B location | Denied; zero rows changed; audit preserves attempted-action security log where appropriate. |
| Request passes Company B `company_id` in JSON/cookie/URL | Ignored as authority; context remains Company A or request is rejected. |
| Admin attempts a permission outside its matrix | 403; no write. |
| Driver accesses another driver’s restricted future record | Scope-policy contract test denies; concrete Phase 3 tests added with driver records. |
| Suspended/deactivated user uses existing session | Rejected and session invalidated. |
| Valid user selects inactive/non-member company | 403/tenant-selection-required; no tenant DB query. |
| Connection pool serves a second tenant after a first | Second transaction observes only its own RLS context; no leaked setting. |
| Runtime role is replaced by migrator/table owner in test | Test fails/raises deployment configuration violation; normal runtime must not use it. |

### CI test tiers

- Every PR: formatting, lint, typecheck, Prisma validation, migrate-from-zero, unit, integration/RLS, build.
- Protected branch/staging: all PR checks plus Playwright auth/security suite and a staged deployment smoke test.
- Before production: successful staging release with migration logs, health check, sign-in, cross-tenant test suite, and verified backup status.

## H. Phase 2 definition of done

### Foundation

- [ ] Fresh clone installs with pinned Node 24/pnpm and starts locally from documented instructions.
- [ ] Local PostgreSQL, Redis, and MinIO start with named volumes and health checks.
- [ ] `.env.example` is complete, contains no secret, and server/public environment validation is enforced.
- [ ] Strict typecheck, lint, format check, unit/integration test, Prisma validation, migration, and build scripts exist and pass.
- [ ] CI blocks PRs on all required checks.

### Database and tenancy

- [ ] Production/staging run PostgreSQL 18 or an explicitly approved UUIDv7-compatible alternative.
- [ ] Initial Phase 2 schema migrates cleanly from an empty database.
- [ ] Users, companies, memberships, roles, permissions, locations, sessions/accounts, reset tokens, and activities are present with reviewed indexes/constraints.
- [ ] Deferred operational tables exist only as an approved data-model ADR, not premature migrations.
- [ ] Runtime and migration database roles are separate; runtime has `NOBYPASSRLS`.
- [ ] Tenant-owned Phase 2 tables use enabled and forced RLS with transaction-local context.
- [ ] Cross-tenant direct reads and writes are denied under the runtime/test-app role.
- [ ] Local/test resets are limited to explicitly named test/development databases.

### Identity and authorisation

- [ ] Credentials sign-in/sign-out works for active users; password hashes are Argon2id.
- [ ] Password reset/activation uses short-lived, single-use hashed tokens and non-enumerating responses.
- [ ] Sessions use secure cookies and expire according to documented idle/absolute limits.
- [ ] Each authenticated request derives an immutable, membership-validated TenantContext.
- [ ] Server-side permission checks implement the approved matrix and do not rely on UI visibility.
- [ ] Every tenant-owned repository requires tenant context and executes inside the tenant transaction helper.
- [ ] Account/membership/security lifecycle events are audit logged with request IDs and safe metadata.

### Delivery readiness

- [ ] Staging uses isolated secrets/data and deploys successfully through the migration-first release process.
- [ ] Staging sign-in, RLS, cross-tenant denial, and backup/restore-readiness checks pass.
- [ ] Deployment, migration, local setup, secret rotation, and incident escalation runbooks are reviewed.
- [ ] No product dashboard, operational module UI, real integration, AI, or notification delivery has been introduced.

## I. Risks and decisions requiring approval

1. **Hosting choice:** approve Railway for web/managed PostgreSQL/Redis plus Cloudflare R2, rather than Vercel. This accommodates the future persistent BullMQ worker without a second compute platform. If Vercel is preferred, approve the separate worker host now.
2. **PostgreSQL version/UUIDs:** approve PostgreSQL 18 so native UUIDv7 defaults can be used. If Railway’s selected managed version or role controls cannot satisfy this, approve `pg_uuidv7` extension or application-generated UUIDv7 as fallback before schema work begins.
3. **Database roles/RLS:** confirm the managed provider permits a dedicated `ois_migrator` owner and a `NOBYPASSRLS` `ois_app` role. This is a release-blocking proof of concept, not a detail to defer.
4. **Credentials and account recovery:** approve credential authentication plus a narrowly scoped transactional-email provider for activation/password recovery. This is separate from the future notification system.
5. **Session policy:** approve the proposed 8-hour idle / 7-day absolute session lifetime, or supply a stricter company security policy.
6. **Schema scope:** approve deferring all operational tables except locations until Phase 3. Their contract is documented now, but migration is delayed to avoid premature schema and RLS maintenance.
7. **RLS error behaviour:** approve externally safe handling that may return 404 for inaccessible tenant resources, reducing cross-tenant resource enumeration.

After these decisions are approved, implementation may begin at Workstream 1, Step 1. No application code should be written before approval.
