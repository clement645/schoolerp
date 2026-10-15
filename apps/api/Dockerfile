# syntax=docker/dockerfile:1
# Build from the repository root:
#   docker build -f apps/api/Dockerfile -t edumaster-api .

# ── Dependencies and build ────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /repo
ENV NPM_CONFIG_FETCH_RETRIES=5 NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 NPM_CONFIG_FETCH_TIMEOUT=300000

# Manifests first, so dependency layers are reused until they change.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Lifecycle scripts are skipped: the workspace's own post-install step needs
# the sources, which are copied afterwards so this layer stays cached.
RUN --mount=type=cache,target=/root/.npm npm ci --workspace @edumaster/api --include-workspace-root --ignore-scripts --no-audit --no-fund

COPY apps/api apps/api
# Generates the database client; also fetches the engine `migrate` needs.
RUN npm run prisma:generate --workspace @edumaster/api
RUN npm run build --workspace @edumaster/api

# ── Database migrations (one-shot job) ───────────────────────────────────────
# Keeps the Prisma CLI, which the runtime image does not need.
FROM build AS migrate
WORKDIR /repo/apps/api
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ── Production dependencies only ─────────────────────────────────────────────
FROM node:24-alpine AS dependencies
WORKDIR /repo
ENV NPM_CONFIG_FETCH_RETRIES=5 NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 NPM_CONFIG_FETCH_TIMEOUT=300000
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci --workspace @edumaster/api --include-workspace-root --omit=dev --ignore-scripts --no-audit --no-fund \
 && mkdir -p apps/api/node_modules

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000
WORKDIR /repo/apps/api

COPY --from=dependencies --chown=node:node /repo/node_modules /repo/node_modules
COPY --from=dependencies --chown=node:node /repo/apps/api/node_modules /repo/apps/api/node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
# Fonts embedded in generated PDFs (SIL Open Font License, see assets/fonts/OFL.txt).
COPY --chown=node:node apps/api/assets ./assets
COPY --chown=node:node apps/api/package.json ./

# Never run as root.
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.API_PORT+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
