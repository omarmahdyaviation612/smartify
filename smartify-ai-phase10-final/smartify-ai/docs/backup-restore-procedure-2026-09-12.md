# Backup / restore recovery procedure

Status: rehearsed end-to-end against an isolated copy of the real dev
database on 2026-09-12. Not yet rehearsed against a real production
database (none exists yet). Contains no credentials — every command below
uses placeholders.

## What was proven

1. A logical backup of the live Postgres 18.6 database, taken with
   version-matched `pg_dump` (custom format, `-Fc`), restores cleanly into
   a separate, isolated database.
2. `prisma migrate status` reports "up to date" against the restored copy
   with zero manual intervention.
3. Every row count (Users, StudentProfiles, Subscriptions, AIUsage,
   AIConversation, AIMessage, InstapayPaymentSubmission,
   TutorQuestionPackPurchase) matched the source exactly.
4. Foreign-key relationships survive restore intact: zero orphaned
   `AIMessage` rows, zero orphaned `AIConversation` rows, every
   `StudentProfile` still linked to its `User` (and its Clerk `clerkUserId`
   preserved).
5. The real backend application (unmodified code, actual service classes —
   `OnboardingService`, `CurriculaService`, `TutorService`, `BillingService`)
   boots against the restored copy and correctly serves profile,
   curriculum, Tutor conversation, and billing/subscription reads.
6. The rehearsal never wrote to the source database at any point — verified
   by re-checking every row count on the source immediately afterward.

## Backup

Requires `pg_dump` version-matched to the target server (a client older
than the server refuses to run). If the server is a newer major version
than any locally installed client, run a matching version via Docker
rather than upgrading the local client:

```
docker run --rm -v "<local-backup-dir>:/dump" postgres:<matching-major>-alpine \
  pg_dump "<DATABASE_URL>" -Fc -f /dump/smartify_backup.pgdump
```

- Format: custom (`-Fc`) — compressed, supports selective/parallel restore,
  restorable with `pg_restore` regardless of the exact minor version.
- Rehearsal measurement: ~110 KB, ~2 seconds, for the current dev dataset
  (3 users). Production backup time/size will scale with real data volume —
  re-measure once real data exists, this is not a production estimate.

## Restore (into an ISOLATED database — never over a live one)

```
createdb <isolated-restore-db-name>
docker run --rm -e PGPASSWORD="<password>" -v "<local-backup-dir>:/dump" postgres:<matching-major>-alpine \
  pg_restore -h <host> -p <port> -U <role> -d <isolated-restore-db-name> \
    --no-owner --no-privileges /dump/smartify_backup.pgdump
```

- `--no-owner --no-privileges`: restores data/schema without trying to
  recreate the exact source role/ownership, so it works into any target
  role.
- A `SET transaction_timeout = 0;` warning against a Postgres <17 target is
  expected and harmless (a newer client emits a session parameter an older
  server doesn't recognize) — confirmed by full data-integrity checks in
  the rehearsal above, not just assumed.

## Migration step

After restore, verify (never blindly re-apply):

```
DATABASE_URL="<restored-db-url>" npx prisma migrate status
```

Expect "Database schema is up to date!" if the backup was taken after the
same migrations were applied to the source. If not, run:

```
DATABASE_URL="<restored-db-url>" npx prisma migrate deploy
```

## Runtime role grants

If restoring into a database that will run under the restricted
application role (see [production-db-roles-2026-09-12.md](production-db-roles-2026-09-12.md)),
re-apply the runtime-role grants — a `pg_restore --no-owner --no-privileges`
does not carry the source database's grants over:

```
GRANT USAGE ON SCHEMA public TO <app-role>;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO <app-role>;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO <app-role>;
```

## App restart

Point the backend's `DATABASE_URL` at the restored database and restart
the process. `loadBackendEnv`'s fail-fast validation (production mode)
will refuse to boot against an obviously-wrong value (localhost/placeholder
host) — a deliberate safeguard against restoring into the wrong target by
mistake.

## Verification checks (run every time, in this order)

1. `GET /health/live` — process is up.
2. `GET /health/ready` — process can reach ITS configured database
   (confirms `DATABASE_URL` actually points where intended).
3. `npx prisma migrate status` — schema matches expectations.
4. Row counts for key tables against the last known-good snapshot.
5. Zero orphaned `AIMessage`/`AIConversation`/`Subscription` rows (a
   `LEFT JOIN ... WHERE <fk> IS NULL` count of 0).
6. A real read through the application's own service layer (profile,
   curriculum, Tutor conversation, billing/subscription) — proves the ORM
   layer, not just raw SQL, is compatible with the restored data.

## Cleanup

Always drop the isolated restore database and delete the local dump file
once verification is complete — a stray copy of user data (even from a
non-production dev database) should not be left lying around indefinitely.
