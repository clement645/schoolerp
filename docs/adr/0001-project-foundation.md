# ADR 0001 — Project foundation

- **Status:** Accepted
- **Date:** 2026-10-13
- **Phase:** 1 (Project foundation)

## Context

EduMaster Pro is a multi-tenant school management platform with a Vue 3 web
client and a NestJS API backed by PostgreSQL and Redis. Phase 1 has to give
later phases a foundation where the build, lint, test and database pipelines
are already proven, so that feature work never starts by fixing tooling.

## Decisions

### Monorepo with npm workspaces

`apps/api` and `apps/web` live in one repository managed by npm workspaces.
npm ships with Node, so there is no extra toolchain to install, and two apps do
not yet justify a task orchestrator. Shared code (for example API contract
types) will be added as `packages/*` when a second consumer exists.

### Pinned toolchain versions

| Tool       | Version | Why not `latest`                                                                     |
| ---------- | ------- | ------------------------------------------------------------------------------------ |
| TypeScript | 6.0.x   | 7.x is outside the supported range of typescript-eslint and `@nestjs/swagger`.       |
| Prisma     | 7.10.0  | The `latest` dist-tag currently points at an 8.0 release candidate.                  |
| ioredis    | 5.x     | Proven line; BullMQ (Phase 12+) drives the eventual upgrade.                         |
| Vitest     | 4.x     | The version the NestJS 12 and create-vue scaffolds are generated and tested against. |

Revisit when the dependent tools publish support.

### ESM everywhere

NestJS 12 scaffolds as native ESM (`"type": "module"`, `nodenext`), and Prisma
7's `prisma-client` generator emits ESM TypeScript. The API follows that, which
means relative imports carry a `.js` extension.

### One `.env` at the repository root

Docker Compose, Prisma, the API and Vite all read the same file, so a
credential is defined once. `npm run setup` generates it from `.env.example`
with random secrets; nothing in the repository contains a usable password, and
Compose has no fallback credentials. Both apps validate their environment with
Zod at start-up and refuse to boot on invalid or placeholder values. Only
`VITE_`-prefixed variables can reach the browser bundle.

### Prisma 7 with the `pg` driver adapter

The generated client is written to `apps/api/src/generated/prisma` (git-ignored,
rebuilt on `npm install`). The schema intentionally contains no models yet:
each phase adds its own tables through its own migration instead of
front-loading a speculative schema. Tenant isolation strategy (including
PostgreSQL row-level security) is decided in Phase 4 alongside the first
tenant-owned tables.

### API conventions fixed from day one

- Routes are served under `/api/v<version>/…` (URI versioning, default `1`).
- Every response uses one envelope:
  `{ success: true, data, meta }` or `{ success: false, error: { code, message, details? }, meta }`.
- Unknown errors are logged server-side and returned as a generic 500; internal
  messages never reach clients.
- Every response carries a server-generated `X-Request-Id`; client-supplied ids
  are ignored.
- Helmet security headers, a CORS allow-list (no wildcard), and a global
  whitelist-mode `ValidationPipe` are applied in `configureApp`, which the e2e
  tests share with `main.ts` so tests run the production HTTP pipeline.

### Health endpoints

- `GET /api/v1/health/live` — liveness; no dependencies touched.
- `GET /api/v1/health` — readiness; probes PostgreSQL and Redis with a 2s
  timeout each and answers `503` when either is down. Failure reasons are
  logged, not returned.

### Development ports

API `4000`, web `5180`, PostgreSQL `5434`, Redis `6381`; all configurable in
`.env`, and infrastructure ports bind to `127.0.0.1` only. The web dev server
proxies `/api` to the API so the browser sees a single origin, matching the
production topology where Nginx fronts both.

## Deferred

| Item                                   | Phase |
| -------------------------------------- | ----- |
| Auth secrets, JWT, RBAC, rate limiting | 4     |
| S3-compatible object storage           | 6     |
| BullMQ workers                         | 9/12  |
| Playwright end-to-end suite            | 15    |
| Production Dockerfiles and Nginx       | 15    |
