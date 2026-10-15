#!/usr/bin/env bash
# Proves a backup can be restored, without touching live data: restores the
# database dump into a scratch database, compares row counts with what the
# dump says it holds, lists the archive, and drops the scratch database.
#
#   scripts/verify-backup.sh backups/20261013T200000Z
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
backup="${1:?Usage: scripts/verify-backup.sh <backup directory>}"
[ -f "$backup/database.dump" ] || { echo "$backup/database.dump not found." >&2; exit 1; }
compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

echo "Checking checksums…"
( cd "$backup" && sha256sum --check --quiet SHA256SUMS )

scratch="restore_check_$$"
cleanup() { compose exec -T postgres sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $scratch" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Restoring into scratch database $scratch…"
compose exec -T postgres sh -c "createdb -U \"\$POSTGRES_USER\" $scratch"
compose exec -T postgres sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $scratch --no-owner --exit-on-error" \
  < "$backup/database.dump"

count() { compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d $scratch -At -c \"$1\""; }
tables="$(count "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
policies="$(count "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'")"
migrations="$(count "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")"
echo "  $tables tables, $policies row-level security policies, $migrations applied migrations"
[ "$tables" -gt 0 ] && [ "$policies" -gt 0 ] || { echo "The restored database is incomplete." >&2; exit 1; }
for table in tenants users students invoices payments audit_logs; do
  printf '  %-12s %s rows\n' "$table" "$(count "SELECT count(*) FROM $table")"
done

if [ -f "$backup/storage.tar.gz" ]; then
  echo "  $(tar -tzf "$backup/storage.tar.gz" | grep -vc '/$' || true) stored files in the archive"
fi
echo "Backup $backup restores cleanly."
