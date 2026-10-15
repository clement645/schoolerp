# Backup and recovery

Two things hold an installation's data: the **PostgreSQL database** and the
**stored files** (photographs, student documents, logos). Redis holds only
rate-limit counters and needs no backup.

## Taking a backup

```bash
scripts/backup.sh
```

Writes `backups/<UTC timestamp>/` with `database.dump` (PostgreSQL custom
format), `storage.tar.gz` and `SHA256SUMS`. The directory is readable by its
owner only: it contains personal data.

The script targets the production stack. For another stack:

```bash
COMPOSE_FILE=docker-compose.yml ENV_FILE=.env scripts/backup.sh
```

If files are kept in an external S3 service rather than the bundled gateway,
only the database is dumped; protect the bucket with versioning or
replication there.

### Schedule and retention

Run it daily from cron, and **copy each backup off the host** — a backup that
lives only on the machine it protects is not a backup. A reasonable start:
daily for 14 days, weekly for 3 months, encrypted at rest wherever it is kept.

```cron
15 2 * * * cd /srv/edumaster && scripts/backup.sh >> /var/log/edumaster-backup.log 2>&1
```

## Checking that a backup can be restored

```bash
scripts/verify-backup.sh backups/20261013T200000Z
```

Verifies the checksums, restores the dump into a scratch database, counts
tables, row-level security policies and key rows, lists the file archive, and
drops the scratch database. It does not touch live data. Run it regularly: an
untested backup is a hope.

## Restoring

```bash
scripts/restore.sh backups/20261013T200000Z
```

**This replaces the current database and stored files.** Everything recorded
since the backup was taken is lost. The script asks for confirmation, stops
the application, restores both, and starts it again (which also applies any
migrations newer than the backup).

Restoring onto a new host: deploy as in [deployment.md](deployment.md) with
the **same** `.env.production` secrets, copy the backup directory over, then
run `scripts/restore.sh`. Sessions do not survive (people sign in again);
everything else does.

The script recreates the `edumaster_app` database role before restoring.
Roles are not part of a database dump, and the tenant-isolation policies refer
to that role.

## What was tested

On the production compose stack: a backup was taken, data was then changed
(learners renamed, a tenant added), and the backup restored. Afterwards the
changed rows were back to their backed-up values, all 48 row-level security
policies and the tenant role were present, a school administrator could sign
in and list their learners, and a stored photograph was served.

Not tested: restoring onto a different PostgreSQL major version, and
point-in-time recovery (this procedure restores to the moment of the backup
only; continuous archiving of the write-ahead log would be needed for more).
