# Smartify AI — Deployment & Operations

This document is written procedure, not a verified runbook — none of the steps below have been executed against a real Postgres instance in this environment (no live database exists here). Treat this as "what to do," and verify each step once real infrastructure is available, before relying on it during an actual incident.

## Migrations — reproducible from an empty database

```bash
cd packages/database
pnpm exec prisma migrate deploy   # applies all committed migrations in order, in production
# or, for local/dev iteration:
pnpm exec prisma migrate dev      # generates + applies a new migration from schema.prisma changes
```

`prisma migrate deploy` is the production-safe command — it never generates new migrations or prompts interactively, it only applies what's already committed under `packages/database/prisma/migrations/`. Because Prisma migrations are plain, ordered SQL files checked into the repo, running this against a genuinely empty database reconstructs the full schema from scratch, in order. This project has not yet run `prisma migrate dev` for the first time in a real environment (no `migrations/` directory has been generated — see "What hasn't been exercised" below), so this claim of reproducibility is based on Prisma's own guarantees about how migration files work, not on having watched it happen here.

## Seeding a clean database

```bash
pnpm db:seed
```

Runs `packages/database/prisma/seed.ts` — idempotent via `upsert` for every row it creates (curricula, pricing plans, AI/payment provider config, system config), so re-running it against a partially-seeded database is safe and won't create duplicates. Placeholder curriculum content is clearly labeled `[PLACEHOLDER]` throughout, per the Phase 2 decision.

## Backup

Documented procedure (standard Postgres tooling, not a Smartify-specific script):

```bash
pg_dump --format=custom --file=smartify_backup_$(date +%Y%m%d_%H%M%S).dump "$DATABASE_URL"
```

- Run on a schedule (daily minimum for a production system handling billing data) via cron, a managed provider's automated backup feature (Supabase/RDS/Neon all offer this), or a CI scheduled job.
- Store backups somewhere other than the same host as the database (S3, GCS, or the managed provider's own backup storage).
- **Sensitive data note**: backups will contain student PII (names, ages) and billing data (`Subscription`, `AIUsage.costUsd`) — encrypt backups at rest and restrict access accordingly. This is a real operational responsibility, not a nice-to-have.

## Restore

```bash
pg_restore --clean --if-exists --dbname="$DATABASE_URL" smartify_backup_YYYYMMDD_HHMMSS.dump
```

- `--clean --if-exists` drops existing objects before recreating them, so this is destructive to whatever's currently in the target database — always restore to a fresh/staging database first to verify the backup is good before ever pointing this at production.
- After restoring, run `prisma migrate deploy` again to confirm the restored schema matches the latest migration state (a backup taken before a schema change would otherwise leave the database on an older schema version than the deployed application code expects).

## Rollback (application deployment)

Documented procedure — no automated rollback tooling exists in this project yet:

1. **Application code**: redeploy the previous known-good build/commit (standard for whatever hosting is used — e.g. Vercel's "redeploy previous deployment" for the frontend, or redeploying the prior container image/build artifact for the NestJS backend).
2. **Database migrations**: Prisma migrations are forward-only by design — there is no `prisma migrate down`. Rolling back a schema change means either:
   - Writing and applying a new migration that reverses the change (the standard, safe approach — treat "undo" as a new forward migration, not a rewind), or
   - Restoring from a pre-migration backup, if the migration was destructive and a new reversing migration isn't feasible (data-loss risk — last resort, not routine).
3. **Before rolling back**, confirm whether any data was written under the new schema/code that the old version wouldn't understand (e.g. new `AIDailyUsageCounter`/`WebhookEventLog` rows from this phase) — a naive code-only rollback without a corresponding schema consideration can leave the older code silently ignoring or erroring on newer data shapes.

This procedure has not been rehearsed in this project. A real "game day" rollback drill against a staging environment is recommended before depending on it during a real incident.

## Secrets & source control

- `.gitignore` excludes `.env`, `.env.*` (with `.env.example` explicitly re-allowed), plus `*.pem`/`*.key`/`*.p12`/`*.pfx` and common local-DB artifacts.
- Every `.env.example` file in this repo contains placeholder values only (`sk_test_xxx`, empty strings) — confirmed by inspection; no real credential has ever been placed in this project.
- `PaymentProviderConfig`/`AIProviderConfig` database rows deliberately hold only non-secret routing/display data (provider key, model name, cost-per-token *rates*, not API keys) — actual secrets live exclusively in environment variables, never in the database, per the Phase 2 "never expose payment/API secrets" rule.

## What hasn't been exercised

Everything above is procedure written from Prisma's/Postgres's documented behavior and standard practice, not from having actually run it in this project — there has never been a live Postgres instance available in this environment. Before going live: actually run a full migrate-from-empty → seed → backup → restore-to-staging → confirm cycle once, and time how long it takes, since "documented" and "rehearsed" are different levels of confidence.
