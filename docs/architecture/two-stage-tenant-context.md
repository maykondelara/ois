# Two-stage tenant context

Stage 1 is authenticated-user bootstrap. Auth.js derives an immutable user ID from its signed, HTTP-only session cookie. `withAuthenticatedUserTransaction` opens a short Prisma transaction and sets only `app.current_user_id` through `set_config(..., true)`. PostgreSQL RLS then permits discovery of only that user's active memberships. A requested company ID is a selection, not authorization.

Stage 2 begins only after `resolveTenantContext` finds an active membership for that user and selection. The returned context contains the actor user ID, company ID, membership ID, role, and capability set. `withTenantTransaction` opens a new transaction and sets both `app.current_user_id` and the authorized `app.current_company_id` transaction-locally. Tenant repositories receive that context and transaction; they never accept an arbitrary company ID from an HTTP request.

Neither setting is session-level. PostgreSQL RLS remains the final data isolation boundary, including when an application bug bypasses a repository filter.
