#!/usr/bin/env bash
# Backs up an EduMaster Pro installation: the database and the stored files.
#
#   scripts/backup.sh                         # the production stack
#   COMPOSE_FILE=docker-compose.yml ENV_FILE=.env scripts/backup.sh   # development
#
# Writes backups/<UTC timestamp>/ containing:
#   database.dump    PostgreSQL custom-format dump (restore with pg_restore)
#   storage.tar.gz   every uploaded file (photos, documents, logos)
#   SHA256SUMS       checksums of both, verified before any restore
#
# Copy the directory off the host afterwards: a backup that lives only on the
# machine it protects is not a backup. See docs/backup-and-recovery.md.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_ROOT="${BACKUP_ROOT:-backups}"

[ -f "$ENV_FILE" ] || { echo "Environment file $ENV_FILE not found." >&2; exit 1; }
compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

umask 077 # backups hold personal data: readable by the owner only
target="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$target"
trap 'echo "Backup failed; removing incomplete $target" >&2; rm -rf "$target"' ERR

echo "Dumping the database…"
compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' \
  > "$target/database.dump"

echo "Archiving stored files…"
storage="$(compose ps -q storage || true)"
if [ -n "$storage" ]; then
  # The gateway image has no shell; a helper container reads its volume.
  docker run --rm --volumes-from "$storage:ro" --entrypoint tar postgres:17-alpine \
    -czf - -C /data . > "$target/storage.tar.gz"
else
  echo "  no storage container in this stack: files live in an external S3 service" >&2
  echo "  and must be backed up there (versioning or replication)." >&2
fi

( cd "$target" && sha256sum -- * > SHA256SUMS )
trap - ERR
echo "Backup written to $target"
du -sh "$target" | cut -f1
