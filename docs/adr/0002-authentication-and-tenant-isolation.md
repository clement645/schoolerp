# ADR 0002 — Authentication, authorisation and tenant isolation

- **Status:** Accepted
- **Date:** 2026-10-13
- **Phase:** 4 (Authentication and multi-tenancy)

## Context

Many schools share one deployment. A defect that shows one school another
school's pupils, marks or fees is the worst failure the product can have, so
isolation must not depend on every query being written correctly. Sessions
must also survive stolen tokens and be revocable at once.

## Decisions

### Tenancy model

- **Tenant** is the customer account: the isolation and subscription boundary.
- **School** is a school run by that tenant. Most tenants have one; a group
  has several. Records partition by school _within_ a tenant from Phase 5.
- **Users** belong to exactly one tenant. Platform staff (`SUPER_ADMIN`) have
  no tenant. Email addresses are unique across the platform.
- Roles are currently tenant-wide. Per-school role scoping is deferred until a
  multi-school tenant needs it; teacher/class scoping arrives with teacher
  assignments in Phase 6.

### Isolation is enforced by PostgreSQL, not only by the application

Every tenant-owned table has `tenant_id` and a row-level-security policy.
Tenant-scoped code runs through `PrismaService.withTenant(tenantId, work)`,
which opens a transaction, sets `app.tenant_id`, and switches to the
unprivileged `edumaster_app` role (`SET LOCAL ROLE`). Under that role:

- rows of other tenants are invisible, and cannot be updated or deleted;
- inserting or moving a row into another tenant is rejected (`WITH CHECK`);
- with no tenant set, every policy matches nothing;
- `audit_logs` is INSERT/SELECT only, `users` cannot be deleted, the role
  catalogue is read-only, and refresh tokens cannot be created.

`edumaster_app` cannot log in; it is reachable only by `SET ROLE` from the
application's own connection, so no second credential exists. `SET LOCAL`
confines the change to the transaction, so pooled connections never carry a
tenant over.

Calling Prisma models directly on `PrismaService` uses the owner role and
bypasses the policies. That path is reserved for what is cross-tenant by
nature: authentication (the tenant is unknown until the user is identified),
platform administration, and the catalogue sync.

**When adding a tenant-owned table**, add its `GRANT`s and policy in the same
migration. `test/tenant-isolation.e2e-spec.ts` queries the catalogue and fails
if any table with a `tenant_id` column lacks RLS or a policy.

### Sessions

| Token   | Form                         | Lifetime | Where it lives                                  |
| ------- | ---------------------------- | -------- | ----------------------------------------------- |
| Access  | JWT, HS256, pinned algorithm | 15 min   | Browser memory only                             |
| Refresh | 256-bit opaque random value  | 7 days   | `HttpOnly; SameSite=Strict` cookie, path-scoped |

- The access token is never written to `localStorage`, so injected script
  cannot steal a long-lived credential. After a reload the SPA re-obtains one
  through the refresh cookie.
- Refresh tokens are stored as SHA-256 hashes and **rotate on every use**. All
  tokens from one sign-in share a family; presenting an already-used token
  revokes the whole family (theft detection) and is audited.
- The cookie is scoped to `/api/v1/auth`. Cookie-authenticated endpoints also
  reject requests whose `Origin` is outside `CORS_ORIGINS`.
- The SPA serialises refreshes across tabs with a Web Lock; otherwise two tabs
  restoring one session would race and trip theft detection.

### The principal is rebuilt on every request

`AuthGuard` verifies the token, then loads the user, roles and permissions
from the database. Disabling a user, suspending a tenant, changing a role or
changing a password therefore takes effect on the next request rather than
when the token expires. The cost is one indexed query per request; caching in
Redis is a later optimisation if profiling calls for it.

### Authorisation is deny-by-default

Every route declares `@Public`, `@AuthenticatedOnly` or
`@RequirePermissions(...)`. A route with no declaration is refused at request
time, and an e2e test enumerates all routes to catch one before it ships.

Permissions and the ten system roles are defined in code
(`rbac.catalogue.ts`) and mirrored into the database on start-up.

A user may grant, change or remove a role only if they hold every permission
that role carries, and `SUPER_ADMIN` can never be granted through the API.
Users cannot change their own roles or disable themselves.

### Passwords and brute force

- Argon2id (19 MiB, 2 iterations), minimum 12 characters.
- Sign-in failures return one generic message, and a decoy hash is verified
  for unknown accounts so timing does not reveal which emails exist.
- Five consecutive failures lock the account for 15 minutes.
- Password endpoints are rate-limited per client (default 10/min).
- Administrators set a _temporary_ password; the user is confined to the
  change-password endpoint until they replace it.

### Audit log

Sign-ins (succeeded and failed), sign-outs, token replay, password changes and
resets, user and role changes, and tenant changes are recorded with actor,
tenant, resource, IP address, user agent and before/after values. Entries are
written in the same transaction as the change they describe.

## Deferred

| Item                                            | Why / when                                  |
| ----------------------------------------------- | ------------------------------------------- |
| Self-service password reset, email verification | Needs outbound email (Phase 14)             |
| Optional MFA (TOTP)                             | Phase 15 hardening                          |
| Redis-backed rate limiting                      | Needed once more than one API instance runs |
| `trust proxy` configuration for real client IPs | With the Nginx deployment (Phase 15)        |
| Absolute session lifetime cap                   | Phase 15 hardening                          |
