-- Generated from the lean Phase 2 Prisma schema; PostgreSQL 18 supplies uuidv7().
CREATE TABLE companies (id uuid PRIMARY KEY DEFAULT uuidv7(), name text NOT NULL, slug text NOT NULL UNIQUE, timezone text NOT NULL DEFAULT 'Australia/Perth', status text NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT uuidv7(), email text NOT NULL UNIQUE, name text, password_hash text, account_status text NOT NULL DEFAULT 'PENDING_ACTIVATION', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE roles (id uuid PRIMARY KEY DEFAULT uuidv7(), code text NOT NULL UNIQUE, name text NOT NULL, description text);
CREATE TABLE permissions (id uuid PRIMARY KEY DEFAULT uuidv7(), code text NOT NULL UNIQUE, description text);
CREATE TABLE role_permissions (role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE, permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE, PRIMARY KEY (role_id,permission_id));
CREATE TABLE company_memberships (id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, role_id uuid NOT NULL REFERENCES roles(id), status text NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,user_id), UNIQUE(company_id,id));
CREATE TABLE locations (id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE, name text NOT NULL, address text, status text NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,id), UNIQUE(company_id,name));
CREATE TABLE activities (id uuid PRIMARY KEY DEFAULT uuidv7(), company_id uuid REFERENCES companies(id) ON DELETE RESTRICT, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, action text NOT NULL, entity_type text NOT NULL, entity_id uuid, request_id text, metadata jsonb, occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE accounts (id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, type text NOT NULL, provider text NOT NULL, provider_account_id text NOT NULL, UNIQUE(provider,provider_account_id));
CREATE TABLE sessions (id text PRIMARY KEY, session_token text NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires timestamptz NOT NULL);
CREATE TABLE verification_tokens (identifier text NOT NULL, token text NOT NULL UNIQUE, expires timestamptz NOT NULL, UNIQUE(identifier,token));
CREATE TABLE password_reset_tokens (id uuid PRIMARY KEY DEFAULT uuidv7(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz);
CREATE INDEX company_memberships_user_status_idx ON company_memberships(user_id,status);
CREATE INDEX activities_company_occurred_idx ON activities(company_id,occurred_at DESC);
CREATE INDEX password_reset_tokens_user_expiry_idx ON password_reset_tokens(user_id,expires_at);

-- Tenant role/policy operations run under the migrator role, never the runtime role.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY; ALTER TABLE companies FORCE ROW LEVEL SECURITY;
ALTER TABLE company_memberships ENABLE ROW LEVEL SECURITY; ALTER TABLE company_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY; ALTER TABLE locations FORCE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY; ALTER TABLE activities FORCE ROW LEVEL SECURITY;
-- Stage 1 bootstrap: only an authenticated user setting can discover their own active memberships.
CREATE POLICY memberships_user_bootstrap ON company_memberships USING (user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid) WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid);
-- Companies are visible only through an active membership; this is safe because the membership policy is user-scoped, not company-scoped.
CREATE POLICY companies_authorised_member ON companies USING (EXISTS (SELECT 1 FROM company_memberships m WHERE m.company_id = companies.id AND m.user_id = NULLIF(current_setting('app.current_user_id',true),'')::uuid AND m.status = 'ACTIVE'));
CREATE POLICY locations_tenant ON locations USING (company_id = NULLIF(current_setting('app.current_company_id',true),'')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id',true),'')::uuid);
CREATE POLICY activities_tenant ON activities USING (company_id = NULLIF(current_setting('app.current_company_id',true),'')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id',true),'')::uuid);
