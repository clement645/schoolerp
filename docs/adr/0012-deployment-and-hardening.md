# ADR 0012 — Deployment and security hardening

- **Status:** Accepted
- **Date:** 2026-10-14
- **Phase:** 15 (Security, testing and deployment)

## Decisions

### Two images and one compose file

- **API** (`apps/api/Dockerfile`): multi-stage; the runtime stage holds
  production dependencies and compiled output only, runs as the unprivileged
  `node` user on a read-only root filesystem with all capabilities dropped.
  A `migrate` target keeps the Prisma CLI for the one-shot migration job.
- **Web** (`apps/web/Dockerfile`): the built application served by
  unprivileged Nginx, which also forwards `/api` to the API.
- `docker-compose.prod.yml` wires them to PostgreSQL, Redis and S3-compatible
  storage. Only the web container publishes a port, bound to localhost by
  default. Migrations run before the API starts.

TLS terminates in front of the web container; see `docs/deployment.md`.

### Browser security headers at the edge

Nginx sends a Content-Security-Policy that allows scripts, styles and fonts
from the application's own origin only (inline styles are permitted; inline
scripts are not), plus `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy`.
`blob:` is allowed for images and frames because private files are shown from
memory. The policy was exercised in a browser against the production build:
charts, photo upload and the PDF viewer work with no violations reported.

### Rate limits live in Redis

Counters are kept in Redis by an atomic script, so a limit holds across every
API instance. If Redis is unreachable, counting falls back to the instance's
memory rather than failing requests or dropping the limit.

### The client address is taken from a fixed number of proxy hops

`TRUST_PROXY_HOPS` says how many reverse proxies are in front of the API
(1 with the bundled Nginx). Nginx overwrites `X-Forwarded-For` with the peer
address, so a client cannot forge the address that rate limits and audit
records see.

### Tests at three levels

- Unit and component tests (Vitest) beside the code.
- API end-to-end tests against real PostgreSQL, Redis and object storage,
  including tenant isolation for every module and a check that every table
  with a `tenant_id` has row-level security.
- Browser tests (Playwright, `e2e/`) of the critical workflows against the
  real stack: sign-in and forced password change; an examination from
  creation to published report cards; attendance; fees from structure to
  statement; the parent portal's boundaries.

### Backups are tested by restoring them

`scripts/backup.sh` dumps the database and archives stored files with
checksums; `scripts/verify-backup.sh` restores a dump into a scratch database
and checks it; `scripts/restore.sh` replaces a stack's data. See
`docs/backup-and-recovery.md`.

## Known gaps

- **No virus scanning of uploads.** Files are type-checked by content, size-
  limited, stored privately and never served from the application's origin as
  active content, but they are not scanned.
- **No self-service password reset, e-mail verification or MFA.** An
  administrator resets passwords; there is no e-mail integration.
- **No load testing** has been done; performance work is limited to indexes,
  pagination, code-splitting, compression and caching headers.
- **Dependency advisories:** `npm audit --omit=dev` reports 4 high in
  transitive dependencies of the Prisma CLI (`mysql2`, `deepmerge-ts`) and 2
  moderate in `uuid` via `exceljs`. The only fixes offered are breaking
  downgrades. The MySQL driver is never loaded (the database is PostgreSQL)
  and `exceljs` does not call the affected `uuid` functions with a buffer.
- The API runtime image is about 650 MB, mostly dependencies; it has not been
  slimmed.
- The CI workflow has never been run on GitHub.
