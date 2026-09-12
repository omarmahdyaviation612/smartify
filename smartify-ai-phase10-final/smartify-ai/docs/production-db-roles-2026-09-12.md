# Production PostgreSQL role design (restricted, non-superuser)

Status: designed and tested locally against isolated Docker databases
(`smartify_roletest`, `smartify_roletest2` — both dropped after verification,
never the real dev DB). Not yet applied to any real environment. This
document is the procedure to follow when provisioning a real production
(or staging) database; it intentionally contains no real credentials.

## Why

The development backend has historically connected as a PostgreSQL
superuser-style role. Production must not run routine application traffic
as a superuser — a single SQL-injection-class bug or a leaked connection
string would otherwise grant an attacker the ability to create/drop
databases, create roles, or bypass row-level security entirely. Postgres
supports separating "the role that can change schema" from "the role that
serves live traffic," and Prisma does not require superuser rights for
either.

## The two roles

### 1. Migration role (`*_migrator`)

Used ONLY during controlled releases (CI/CD migration step or an operator
running `prisma migrate deploy` by hand). Never used by the running
application.

```sql
CREATE ROLE smartify_migrator WITH LOGIN PASSWORD '<generated-secret>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
```

**Critical ownership requirement**: this role must OWN the database (or at
minimum own every table Prisma manages), not merely hold privilege grants.
`ALTER TABLE` (which every Prisma migration needs for `ADD COLUMN`, `DROP
COLUMN`, adding constraints, etc.) requires table ownership in Postgres —
`GRANT ALL PRIVILEGES ON ALL TABLES` alone is NOT sufficient and will fail
with `must be owner of table X`. This was confirmed directly during local
testing: a role that was only granted privileges (not ownership) could not
`ALTER TABLE`, while a role that owned the database (created via `CREATE
DATABASE ... OWNER smartify_migrator`) could.

For a brand-new production database:

```sql
CREATE DATABASE smartify_production OWNER smartify_migrator;
```

For an EXISTING database currently owned by a different (e.g. superuser)
role, ownership must be transferred once, as a reviewed, low-traffic
maintenance step:

```sql
ALTER DATABASE smartify_production OWNER TO smartify_migrator;
-- and for each existing table/sequence, e.g. via a generated script:
-- ALTER TABLE "<name>" OWNER TO smartify_migrator;
-- ALTER SEQUENCE "<name>" OWNER TO smartify_migrator;
```

`smartify_migrator`'s connection string is used only for:
`prisma migrate deploy`, `prisma migrate status`, `prisma migrate resolve`.
It is never set as the application's runtime `DATABASE_URL`.

### 2. Application runtime role (`*_app`)

Used by the running NestJS backend at all times. Confirmed by grepping all
raw SQL in the backend (`admin-ai-config.service.ts`,
`admin-payments.service.ts`, `ai-usage.service.ts`, `health.controller.ts`)
that the application only ever performs DML (SELECT/INSERT/UPDATE/DELETE,
plus a trivial `SELECT 1` health check) — never DDL. So the runtime role
needs no schema-modification rights at all.

```sql
CREATE ROLE smartify_app WITH LOGIN PASSWORD '<generated-secret>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE smartify_production TO smartify_app;
```

Run the remaining grants **as the migrator role** (or whichever role owns
the schema), after the schema exists (i.e. after the first `prisma migrate
deploy`):

```sql
GRANT USAGE ON SCHEMA public TO smartify_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO smartify_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO smartify_app;

-- So future tables/sequences created by a later migration are
-- automatically granted to the app role without a manual re-grant step:
ALTER DEFAULT PRIVILEGES FOR ROLE smartify_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smartify_app;
ALTER DEFAULT PRIVILEGES FOR ROLE smartify_migrator IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO smartify_app;
```

`smartify_app`'s connection string becomes the application's `DATABASE_URL`
in production.

## What the app role is verified NOT able to do

Confirmed locally (isolated test database, since dropped) that the
app role, with only the grants above, is correctly rejected for:

- `CREATE TABLE ...` → `permission denied for schema public`
- `DROP TABLE "User"` → `must be owner of table User`
- `CREATE ROLE ... SUPERUSER` → `permission denied to create role`
- `CREATE DATABASE ...` → `permission denied to create database`

## What the app role is verified able to do

Confirmed locally via a direct Prisma Client script covering every write
pattern the application actually performs: User create/read, Curriculum/
Grade/Subject create, StudentProfile create, AIConversation + AIMessage
create, AIUsage insert, PricingPlan + Subscription create, and
InstapayPaymentSubmission create + update (the admin-review shape). All
succeeded under the restricted `smartify_app` grant set — no additional
privileges were needed.

## Release procedure

1. Deploy step (CI/CD or operator), using `smartify_migrator`'s connection
   string as `DATABASE_URL`: run `prisma migrate deploy`.
2. If the migration created any new tables/sequences, the `ALTER DEFAULT
   PRIVILEGES` statements above already cover them automatically — no
   manual re-grant needed as long as `smartify_migrator` was the role that
   ran the migration.
3. Runtime step: the application processes use `smartify_app`'s connection
   string as `DATABASE_URL`, unrelated to the migration step, running as a
   separate deploy stage/process/credential from step 1.

## Local development

This document is a design/procedure for a **future** production
environment. Local development continues to use the existing working
`DATABASE_URL` unchanged — nothing here has been applied to any real
database (dev or otherwise). Do not repoint the local `.env` at a
restricted role unless explicitly asked; this is a deferred production
hardening step, not an immediate local change.
