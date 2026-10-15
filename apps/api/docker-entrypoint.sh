#!/bin/sh
# Starts the API. With MIGRATE_ON_START=true, pending database migrations are
# applied first; this is for hosts that offer no separate release step (for
# example Render's free plan). Prisma takes an advisory lock while migrating,
# so instances starting together do not apply a migration twice.
set -e

if [ "${MIGRATE_ON_START:-false}" = "true" ]; then
  echo "Applying database migrations…"
  node /repo/node_modules/prisma/build/index.js migrate deploy
fi

exec node dist/main.js
