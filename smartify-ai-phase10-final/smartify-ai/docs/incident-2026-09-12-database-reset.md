# Incident: development database reset (2026-09-12)

Status: investigated, reconstructed (development data only), prevention
mechanism implemented and rehearsed. Contains no credentials.

## What happened

Sometime during Phase 6 development work on 2026-09-12, the local
Windows-native PostgreSQL 18.6 instance (`localhost:5432`, database
`smartify`) lost all rows in every application table. The table/schema
structure itself remained intact, and the `_prisma_migrations` tracking
table was gone entirely — a fingerprint consistent with a schema
drop-and-recreate rather than a `DROP DATABASE` or an external Postgres
incident.

## Observed outcome

- Every application table (User, StudentProfile, Curriculum, Unit, Topic,
  Lesson, LessonSession, StudentProgress, LessonDraft, LessonVisualAsset,
  AIUsage, …) confirmed at 0 rows via raw SQL (not just the Prisma ORM).
- `_prisma_migrations` did not exist (`to_regclass('public._prisma_migrations')`
  returned NULL).
- The database's own PostgreSQL logs (`log_statement` was not configured,
  so only erroring statements are captured) show three distinct bursts of
  3–4 `checkpoint starting: immediate force wait` entries, each with an
  anomalous ~6 MB WAL "distance" (vs. the day's normal 10–50 KB), at
  18:42:14–19, 20:27:17–19, and 20:51:47–48 (EEST). The first two line up
  exactly with two auto-generated, successful `prisma migrate dev`
  migration folders that did **not** lose data; the third has no
  corresponding successful migration and occurs ~30 seconds before the
  first confirmed evidence that `_prisma_migrations` was gone.

## Recovery investigations performed

1. **Windows Volume Shadow Copies** — `vssadmin list shadows` (run
   elevated, by the user) returned "No items found that satisfy the
   query." No Windows-level snapshot recovery is available.
2. **Historical Docker PostgreSQL instance** (`smartify-ai-postgres-1`,
   `postgres:16-alpine`, historical host port 5433, from `compose.yaml`) —
   inspected safely via a byte-level copy of its volume
   (`smartify-ai_smartify-postgres`, read-only source mount) into a
   disposable volume, started as an isolated container on a throwaway
   port, and queried read-only. Result: schema predates the interactive
   lesson engine entirely (migration history stops at
   `20260911145021_add_instapay_submissions`); every table that does
   exist is empty; its own logs show only permission/security smoke-tests
   (all correctly denied) and one synthetic test insert that itself failed
   on a foreign-key violation. **No recovery value.** The original
   container/volume were never started or modified — only a read-only
   copy was inspected, then deleted.
3. No other PostgreSQL instance, port, container, or backup/dump file was
   found anywhere on the machine. No PITR is possible
   (`wal_level=replica`, `archive_mode=off`, no archiving ever configured,
   and the only remaining WAL segments post-date the incident itself).

## Final conclusion

The lost development/runtime data — real `User`/`StudentProfile` rows, the
QA account, `LessonSession`/`StudentProgress` history, the `AIUsage`
ledger, the Phase 4 generated image bytes, and the exact Phase 5
`LessonDraft` row — is **unrecoverable**. The curriculum hierarchy and the
three Grade-1 Math pilot topics (Addition, Subtraction, Comparing Numbers)
were reconstructed deterministically from committed seed scripts
(`packages/database/prisma/seed.ts`, `seed-pilot-lesson.js`,
`seed-pilot-lessons-phase4.js`, all from commit `5145c6d` and later) — this
is regeneration of known, reviewed content, not recovery of lost data.

## Suspected cause

**LIKELY, not confirmed.** The database's `log_statement` setting was not
configured, so no destructive SQL statement was ever captured in the logs
— only its indirect WAL/checkpoint fingerprint. The timing and shape of
that fingerprint is consistent with a `prisma migrate dev` invocation
(specifically, one run non-interactively that hit Prisma's
"non-interactive environment" error) having performed a schema
drop-and-recreate before failing, based on:

- the same checkpoint-burst signature appearing on two other, confirmed-
  successful `migrate dev` runs that did **not** lose data, and
- the third and final burst having no corresponding successful migration
  and occurring immediately before `_prisma_migrations` was first
  observed missing.

This is a timing/pattern correlation, not a captured statement — it is
recorded here as the leading hypothesis, not as proven fact.

## Prevention rules established (see also Part D/E below)

**NO DEVELOPMENT MIGRATION WITHOUT A VERIFIED PRE-MIGRATION BACKUP.**

- `prisma migrate dev` must not be run directly against a development
  database that holds valuable data. Use `pnpm db:migrate:safe` instead
  (`packages/database/prisma/migrate-safe.ts`), which:
  1. Validates the target (`DATABASE_URL` host must be `localhost` /
     `127.0.0.1` / `::1`, database name must be `smartify`, and
     `NODE_ENV` must not be `production`).
  2. Takes a timestamped `pg_dump` backup
     (`backups/postgres/smartify_pre_migration_<timestamp>.pgdump`).
  3. Verifies the backup file exists and is non-zero.
  4. Only then runs `prisma migrate dev`.
  5. Fails closed at every step: if target validation fails, if `pg_dump`
     is unavailable, or if the backup command itself fails or produces a
     zero-byte file, the migration is never run.
- This is a **development** safety net, not a production backup strategy
  — see [backup-restore-procedure-2026-09-12.md](backup-restore-procedure-2026-09-12.md)
  for the separate, already-rehearsed production-style backup/restore
  procedure.
- Destructive or reset-capable Prisma commands (`migrate dev`, `migrate
  reset`, `db push --force-reset`) must never be run against a database
  containing valuable development/user data without explicit confirmation
  **and** a verified backup taken immediately beforehand. An interactive
  CLI confirmation prompt must never be relied on as the only safety
  mechanism — it can be silently bypassed or skipped entirely in a
  non-interactive environment, which is what is suspected to have
  happened here.
