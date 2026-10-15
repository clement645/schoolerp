# EduMaster Pro

Multi-tenant school management platform: academics, examinations, attendance,
finance, and parent/student portals.

> **Status:** all 15 phases of the roadmap are built. See
> [What is and is not included](#what-is-and-is-not-included) for the gaps.

Students and teachers · classes, subjects and grading · examinations with a
shared marks sheet · results, analytics and PDF report cards · attendance ·
fees, invoices, payments and M-Pesa · parent and student portals ·
announcements, messages and notifications · timetable and calendar.

## Stack

|         |                                                              |
| ------- | ------------------------------------------------------------ |
| Web     | Vue 3, TypeScript, Vite, Tailwind CSS, Pinia, TanStack Query |
| API     | NestJS 12, TypeScript, Prisma 7, Zod-validated configuration |
| Data    | PostgreSQL 17, Redis 8, S3-compatible object storage         |
| Tooling | npm workspaces, ESLint, Prettier, Vitest, GitHub Actions     |

## Prerequisites

- Node.js ≥ 24.12 (`.nvmrc`)
- Docker with Compose v2

## Getting started

```bash
npm run setup       # create .env with generated credentials (never overwrites)
npm install         # install workspaces and generate the Prisma client
npm run infra:up    # start PostgreSQL, Redis and object storage
npm run db:deploy   # apply database migrations
npm run dev         # API on :4000, web on :5180
```

After pulling changes, run `npm run setup` again: it adds any new variables
to your `.env` without touching existing values.

### First sign-in

Create the platform administrator once (the password is read from the
environment, so it is never stored in a file):

```bash
SUPERADMIN_EMAIL=you@example.com SUPERADMIN_PASSWORD='a long passphrase' \
  npm run create-super-admin -w @edumaster/api
```

Sign in at http://localhost:5180, add a tenant under **Platform → Tenants**,
then sign in as that tenant's administrator to manage its users and set up the
school under **School Settings**, **Subjects** and **Classes**.

| URL                                 |                             |
| ----------------------------------- | --------------------------- |
| http://localhost:5180               | Web app                     |
| http://127.0.0.1:4000/api/v1/health | API readiness               |
| http://127.0.0.1:4000/api/docs      | Swagger UI (non-production) |

Ports are configurable in `.env`.

## Scripts

| Command              | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `npm run dev`        | Run API and web in watch mode                       |
| `npm run build`      | Production build of both apps                       |
| `npm run lint`       | ESLint across the monorepo                          |
| `npm run format`     | Format with Prettier (`format:check` to verify)     |
| `npm run typecheck`  | Strict TypeScript checks for both apps              |
| `npm test`           | Unit and component tests                            |
| `npm run test:e2e`   | API tests on real PostgreSQL (own `_test` database) |
| `npm run e2e`        | Browser tests of critical workflows (Playwright)    |
| `npm run db:migrate` | Create and apply a migration in development         |
| `npm run db:deploy`  | Apply pending migrations                            |
| `npm run infra:down` | Stop infrastructure (data volumes are kept)         |

## Layout

```
apps/
  api/            NestJS API
    prisma/       schema and migrations
    src/
      cli/        operational commands (create-super-admin)
      common/     auth guards, filters, interceptors, HTTP helpers
      config/     environment schema
      modules/    feature modules
      prisma/     database access
      redis/      Redis client
    test/         end-to-end tests
  web/            Vue application
    src/
      config/     environment schema
      components/ shared UI kit and layout
      features/   feature-oriented UI
      navigation/ router/ services/ stores/ styles/ types/ utils/
deploy/nginx/     production web server configuration
docs/             deployment, backup and recovery guides
docs/adr/         architecture decision records
e2e/              browser tests (Playwright)
scripts/          setup, backup, restore
```

## Configuration

All configuration comes from environment variables; see `.env.example` for
the full list. Both apps validate their environment at start-up and refuse to
run with missing, malformed, or placeholder values.

Architecture decisions are recorded in [`docs/adr`](docs/adr).

## Browser tests

```bash
npm run infra:up
npx playwright install chromium     # once; or set PLAYWRIGHT_CHROMIUM_PATH
npm run e2e
```

They start the API and the web application themselves, against the
`<database>_test` database, and provision a fresh school for each spec.

## Deployment

See [docs/deployment.md](docs/deployment.md) and
[docs/backup-and-recovery.md](docs/backup-and-recovery.md).

## What is and is not included

Built and tested: everything listed at the top.

Not built, or not verified — details in the ADRs:

- **M-Pesa has not been run against Safaricom.** It is tested against a
  stand-in gateway only; no payment is ever simulated (ADR 0009).
- **AI Compare** is not implemented; its tab is shown as unavailable.
- **No e-mail or SMS**: notifications are in-app only, and passwords are
  reset by an administrator (ADR 0011, 0012).
- **No background jobs**: BullMQ is not used.
- No virus scanning of uploads; no MFA; no load testing (ADR 0012).
- Generated PDFs cover Latin, Greek and Cyrillic text; other scripts (for
  example Chinese or Arabic) print as `?` (ADR 0007).
- A tenant's first school is created with it; there is no screen for adding
  a second.
- The CI workflow has not been run on GitHub.
