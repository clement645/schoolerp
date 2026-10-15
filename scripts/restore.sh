#!/usr/bin/env bash
# Restores an EduMaster Pro installation from a backup made by backup.sh.
#
#   scripts/restore.sh backups/20261013T200000Z
#
# THIS REPLACES THE CURRENT DATABASE AND STORED FILES. Everything recorded
# since the backup was taken is lost. The API and web containers are stopped
# while it runs. Take a fresh backup first if the current data has any value.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
backup="${1:?Usage: scripts/restore.sh <backup directory> [--yes]}"
[ -f "$backup/database.dump" ] || { echo "$backup/database.dump not found." >&2; exit 1; }
compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

echo "Checking checksums…"
( cd "$backup" && sha256sum --check --quiet SHA256SUMS )

if [ "${2:-}" != "--yes" ]; then
  echo "This will REPLACE the database and stored files of the stack in $COMPOSE_FILE"
  echo "with the backup in $backup."
  read -r -p "Type 'restore' to continue: " answer
  [ "$answer" = "restore" ] || { echo "Cancelled."; exit 1; }
fi

echo "Stopping the application…"
compose stop web api >/dev/null 2>&1 || true

echo "Restoring the database…"
compose exec -T postgres sh -c '
  set -e
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" \
    -c "CREATE DATABASE \"$POSTGRES_DB\""
  # Roles are not part of a database dump. The tenant role must exist before
  # the grants and policies that mention it are restored.
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -q -c "
    DO \$\$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '"'"'edumaster_app'"'"') THEN
        CREATE ROLE edumaster_app NOLOGIN;
      END IF;
    END \$\$;
    GRANT edumaster_app TO CURRENT_USER;"
'
compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' \
  < "$backup/database.dump"

if [ -f "$backup/storage.tar.gz" ]; then
  storage="$(compose ps -aq storage || true)"
  if [ -n "$storage" ]; then
    echo "Restoring stored files…"
    compose stop storage >/dev/null
    docker run --rm -i --volumes-from "$storage" --entrypoint sh postgres:17-alpine \
      -c 'find /data -mindepth 1 -delete && tar -xzf - -C /data' < "$backup/storage.tar.gz"
    compose start storage >/dev/null
  else
    echo "No storage container in this stack; restore files in your S3 service." >&2
  fi
fi

echo "Starting the application…"
# `up` runs the migrate job first, bringing an older backup up to date.
compose up -d >/dev/null
echo "Restore complete."
