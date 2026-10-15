# Deployment

A single-host deployment with Docker Compose: Nginx serving the web
application and forwarding `/api` to the API, with PostgreSQL, Redis and
S3-compatible storage beside them.

## Requirements

- A Linux host with Docker Engine and Compose v2
- A domain name and a way to terminate TLS in front of the stack (a load
  balancer, or Caddy/Nginx/Traefik on the host)
- 2 CPU cores and 4 GB of memory as a starting point

## 1. Configure

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Replace every `change-me-*` value with a long random secret
(`openssl rand -base64 36`) and set `PUBLIC_URL` to the address people will
use, including `https://`. The API refuses to start while a placeholder
remains, and validates every other setting at start-up.

| Setting                | Notes                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `PUBLIC_URL`           | Exact browser origin; used for CORS.                                                                                           |
| `WEB_BIND`, `WEB_PORT` | Where the web container listens on the host. Defaults to `127.0.0.1:8080`, for a TLS proxy on the same host.                   |
| `TRUST_PROXY_HOPS`     | `1` for the bundled Nginx. Add one for each further proxy that sets `X-Forwarded-For` (so `2` behind a TLS proxy on the host). |
| `COOKIE_SECURE`        | Keep `true`. The session cookie is then sent over HTTPS only.                                                                  |
| `S3_*`                 | The bundled gateway by default. To use an external store, set `S3_ENDPOINT` and remove the `storage` service.                  |
| `MPESA_*`              | Leave empty to run without M-Pesa. Set all of them to enable it.                                                               |

## 2. Start

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

This builds the images, applies database migrations (the `migrate` job), then
starts the API and the web container. If the build host cannot reach package
registries through Docker's bridge network, add `DOCKER_BUILD_NETWORK=host`
to `.env.production`.

Check it:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
curl -s http://127.0.0.1:8080/api/v1/health
```

`/api/v1/health` reports the database, Redis and storage individually and
answers `503` if any is down. `/api/v1/health/live` only says the process is
up. `/healthz` on the web container checks Nginx itself.

## 3. Create the platform administrator

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec \
  -e SUPERADMIN_EMAIL=you@example.com -e SUPERADMIN_PASSWORD='a long passphrase' \
  api node dist/cli/create-super-admin.js
```

Sign in, create a tenant under **Platform → Tenants**, and hand its
administrator their temporary password. They are made to replace it on first
sign-in.

## 4. Put TLS in front

The stack speaks plain HTTP on `WEB_BIND:WEB_PORT`. Terminate TLS in front of
it and forward to that address. The proxy must:

- redirect HTTP to HTTPS and send `Strict-Transport-Security`;
- pass the `Host` header through;
- set `X-Forwarded-For` to the client address (and you then set
  `TRUST_PROXY_HOPS=2`).

Example with Caddy on the host:

```
school.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

## M-Pesa

1. Create an app in the Safaricom developer portal and obtain the consumer
   key and secret, short code and passkey.
2. Set `MPESA_CALLBACK_BASE_URL` to this installation's public HTTPS address
   and `MPESA_CALLBACK_SECRET` to at least 32 random URL-safe characters
   (`openssl rand -hex 24`). Safaricom will call
   `<base>/api/v1/finance/mpesa/callback/<secret>`.
3. Set `MPESA_ENVIRONMENT=production`. Production refuses to start against the
   sandbox, so that test payments can never credit real accounts.

The integration has been tested against a stand-in for Safaricom only (see
ADR 0009). **Before relying on it, run a small real payment end to end** and
confirm the receipt appears under **Payments → M-Pesa requests**.

## Upgrading

```bash
scripts/backup.sh                     # always first
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Migrations are applied automatically before the new API starts. To roll back
code, check out the previous version and run the same command; to roll back
data, restore the backup (migrations are forward-only).

## Operations

- **Logs:** `docker compose -f docker-compose.prod.yml logs -f api`. Requests
  carry an `X-Request-Id`, which also appears in error responses.
- **Audit trail:** **Administration → Audit Logs** in the application.
- **Rate limits:** `RATE_LIMIT_PER_MINUTE` (general) and
  `RATE_LIMIT_LOGIN_PER_MINUTE` (password endpoints), per client address.
- **API documentation:** off in production; set `SWAGGER_ENABLED=true` to
  expose `/api/docs` temporarily.
- **Backups:** see [backup-and-recovery.md](backup-and-recovery.md).

## Netlify + a hosted API

The web application can be hosted on Netlify; the API cannot (it is a
long-running server that renders PDFs, accepts uploads and holds database
transactions). Run the API image (`apps/api/Dockerfile`, target `runtime`) on
a container host — Render, Railway, Fly.io or a VPS — and let Netlify forward
`/api` to it. `netlify.toml` and `scripts/netlify-routes.mjs` do this.

| Piece      | Where                   | Notes                                                                                                                                                                   |
| ---------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web        | Netlify                 | Set `API_ORIGIN` (the API's https address) in the site's environment.                                                                                                   |
| API        | Container host          | Environment as in `.env.production.example`. `CORS_ORIGINS` = the Netlify address. `TRUST_PROXY_HOPS=2` (Netlify, then the host's load balancer). `COOKIE_SECURE=true`. |
| Migrations | Once per release        | Run the `migrate` target, or `npx prisma migrate deploy` with `DATABASE_URL`, against a **direct** (non-pooled) connection.                                             |
| PostgreSQL | e.g. Neon               | Works: the owner role can create the `edumaster_app` role the migrations need. Put the API in the same region as the database.                                          |
| Redis      | any TLS Redis           | `rediss://` URLs are supported, including endpoints that route by TLS server name.                                                                                      |
| Files      | any S3-compatible store | Required: Cloudflare R2, AWS S3, Backblaze B2…                                                                                                                          |

Because the browser only ever talks to the Netlify address, the session
cookie stays first-party and the content-security policy can stay `'self'`.

## What this deployment does not include

High availability, automatic TLS, log shipping, metrics and alerting are left
to the hosting environment. See ADR 0012 for known security gaps.
