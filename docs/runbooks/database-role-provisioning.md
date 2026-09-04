# Database role provisioning

This is a privileged deployment operation, separate from application requests. The application uses `DATABASE_URL` for a `NOINHERIT NOBYPASSRLS` runtime login. Migrations and deterministic seeds use `DIRECT_URL` for a separately controlled migrator credential. Neither value belongs in source control.

The runtime role receives `CONNECT` on the application database and `USAGE` on `public`, but no `CREATE` on the schema and no role membership in the migrator role. It receives only the DML required by Phase 2: read access for users, RBAC tables and memberships; database-session/password-reset access; and tenant-table access for companies, memberships, locations and activities. RLS still filters protected tables.

The runtime role must not own tables, receive `BYPASSRLS`, perform DDL, alter policies, or assume the migrator role. The Railway POC validates this model with `ois_validation_runtime`; a future staging environment must provision a distinct application runtime role with the same restrictions. The POC role and its ephemeral password are not product deployment credentials.
