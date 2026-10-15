# syntax=docker/dockerfile:1
# Build from the repository root:
#   docker build -f apps/web/Dockerfile -t edumaster-web .

FROM node:24-alpine AS build
WORKDIR /repo
ENV NPM_CONFIG_FETCH_RETRIES=5 NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 NPM_CONFIG_FETCH_TIMEOUT=300000
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci --workspace @edumaster/web --include-workspace-root --ignore-scripts --no-audit --no-fund

COPY apps/web apps/web
# The browser calls the API on its own origin; Nginx forwards it.
ENV VITE_API_BASE_URL=/api/v1
RUN npm run build --workspace @edumaster/web

# Unprivileged Nginx: listens on 8080 and runs as a non-root user.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
COPY deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

# Where the API is reached from this container.
ENV API_UPSTREAM=api:4000
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
