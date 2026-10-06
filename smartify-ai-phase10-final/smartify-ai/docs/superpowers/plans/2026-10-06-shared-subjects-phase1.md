# Shared Subjects Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every `Grade` an explicit list of the `Subject`s it offers, so Arabic and Social Studies can be authored once under the Egyptian grades and offered to British, American, and Local Custom grades without duplicating content, price, or entitlement.

**Architecture:** Add a `GradeSubject` offering table. `Subject.gradeId` keeps its value but its meaning becomes "content home" — the grade whose curriculum authored the units, textbook mapping, and price. Every subject is offered by its own home grade, so Phase 1 changes no API response and no student-visible behavior; it only moves the "is this subject available to this grade" rule from `subject.gradeId` to `GradeSubject`, in one shared helper.

**Tech Stack:** TypeScript, NestJS 10, Prisma 5 + PostgreSQL, Jest (ts-jest) with hand-rolled in-memory Prisma mocks, pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-10-06-shared-subjects-design.md`

## Environment corrections and Task 0 (added 2026-10-06, after inspecting the environment)

This block **supersedes** Preconditions items 2 and 3 and Task 2 steps 4 and 6, which were written before anything was run. Everything below was verified by running the commands.

### What the environment actually is

- PostgreSQL runs as a **native Windows service** (`postgresql-x64-18`, Automatic, listening on `localhost:5432`, database `smartify`) — not Docker. `pnpm infra:up` is **not** needed and must not be run: the Docker daemon is not running.
- `DATABASE_URL` exists **only** in `apps/backend/.env`. There is no root `.env` and no `packages/database/.env`, so Prisma needs it exported explicitly. Never print its value:

```powershell
$env:DATABASE_URL = ((Get-Content apps/backend/.env | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1) -replace '^\s*DATABASE_URL\s*=\s*','').Trim('"')
```

- `prisma` 5.22.0 and its schema engine are installed and working. Nothing is broken.
- **Prisma cannot run under a sandbox that denies writes inside `node_modules`.** The symptom is a misleading `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "prisma" not found` followed by a copyfile `EPERM`. Run the execution session with the project directory as its workspace root.

### The local migration history has diverged from the repository

Measured with `prisma migrate status`:

```
last common migration:                        20260920185548_free_trial_and_referral_v1
present locally, not applied:                 20260925141543_add_student_school_info
applied to the database, absent locally:      20260925190000_add_unit_grounding_progress
                                              20260926000000_add_student_school_info
```

The cause is the several full copies of this project on disk (`_subject-discovery/`, `_tmp-resumable-grounding/`, `_tmp-release-resumable-grounding/`), each of which generated a differently-timestamped migration for the same change.

**Consequence:** `prisma migrate dev` cannot be used here. It needs a consistent history plus a shadow database, and against this database it demands a reset. Migrations below must therefore be written by hand and applied with `prisma migrate deploy`.

### Task 0: Reconcile the local migration history (no data loss)

Do this before Task 1. Nothing here writes to application data.

- [ ] **Step 1: Capture the true delta between the live database and the committed schema** (read-only):

```powershell
$env:DATABASE_URL = ((Get-Content apps/backend/.env | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1) -replace '^\s*DATABASE_URL\s*=\s*','').Trim('"')
pnpm --filter @smartify/database exec prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel packages/database/prisma/schema.prisma --script
```

Expected: the objects the database is missing relative to the schema — the Student-school-info table and columns, and anything else. **Bring this output back for review before continuing**; the next step depends on exactly what it contains.

- [ ] **Step 2: Create the two missing local migration folders** so the history describes what the database already has. Their names must match the `_prisma_migrations` rows exactly:

```
packages/database/prisma/migrations/20260925190000_add_unit_grounding_progress/migration.sql
packages/database/prisma/migrations/20260926000000_add_student_school_info/migration.sql
```

Fill each with the SQL that actually produced those changes — taken from the Step 1 diff and from the repository's own `20260925141543_add_student_school_info/migration.sql` (the same change under a different timestamp). Do not invent SQL you cannot verify.

- [ ] **Step 3: Tell Prisma those two are already applied** — they are, the database has the objects:

```powershell
pnpm --filter @smartify/database exec prisma migrate resolve --applied 20260925190000_add_unit_grounding_progress
pnpm --filter @smartify/database exec prisma migrate resolve --applied 20260926000000_add_student_school_info
```

- [ ] **Step 4: Resolve the local-only School migration.** `20260925141543_add_student_school_info` describes the same change as the now-aligned `20260926000000_add_student_school_info`. Use Step 1's diff to decide:

  - **The database already has those objects** (the diff never mentions the School table or its columns): mark the local duplicate applied so it is not re-run:
    `pnpm --filter @smartify/database exec prisma migrate resolve --applied 20260925141543_add_student_school_info`
  - **The database is missing them**: leave it pending and let Task 2's `migrate deploy` apply it.

- [ ] **Step 5: Verify the history is consistent:**

```powershell
pnpm --filter @smartify/database exec prisma migrate status
```

Expected: `Database schema is up to date!`, with no "not found locally" list. If it still diverges, stop and ask — do not reset the database.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/migrations
git commit -m "chore(db): reconcile local migration history with the database"
```

### Task 2 corrections

Task 2 steps 1-3 (the schema edits) and steps 5, 7, 8 are unchanged. Steps 4 and 6 are replaced by the following.

- **Step 4 (replaced): write the migration folder by hand.** Create `packages/database/prisma/migrations/<UTC timestamp>_add_grade_subject_offering/migration.sql`, using the current UTC time in `YYYYMMDDHHMMSS` form and making it later than every existing folder, containing:

```sql
-- CreateTable
CREATE TABLE "GradeSubject" (
    "id" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeSubject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GradeSubject_gradeId_isActive_idx" ON "GradeSubject"("gradeId", "isActive");

-- CreateIndex
CREATE INDEX "GradeSubject_subjectId_idx" ON "GradeSubject"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeSubject_gradeId_subjectId_key" ON "GradeSubject"("gradeId", "subjectId");

-- AddForeignKey
ALTER TABLE "GradeSubject" ADD CONSTRAINT "GradeSubject_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeSubject" ADD CONSTRAINT "GradeSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

followed by the backfill and the `DO $$ ... $$` guard from step 5.

- **Step 6 (replaced): apply it without a shadow database and without a reset:**

```powershell
pnpm --filter @smartify/database exec prisma migrate deploy
pnpm --filter @smartify/database exec prisma generate
```

`migrate deploy` applies pending local migrations and never resets. Confirm with `prisma migrate status`, then run Task 3's PostgreSQL test — that test is the real proof the backfill is complete.

## Scope of this plan

This plan implements **Phase 0 and Phase 1** of the spec only.

Phase 2 (creating the shared offerings, re-pointing `StudentSubject` / `LessonTrial` / `Subscription.selectedSubjectIds`, withdrawing duplicates) and Phase 4 (seed cleanup) are **deliberately not planned here**. They are data-dependent — the spec's Open question 1 — and cannot be planned without the Phase 0 report that Task 1 produces. A second plan covers them once that report exists.

Everything in this plan is additive. After Task 12 the application must behave exactly as it does today, with one latent bug fixed (the dashboard's grade-scoped content filter, Task 11).

## Global Constraints

- `Subject.gradeId` is the **content home**. Its value never changes for an existing subject, and no content query may scope by a *student's* grade.
- **Learner context** (grade/curriculum shown to a student, and their progress) always comes from `StudentProfile.grade`. **Content context** (AI prompt, grounding source, tutor cache key) always comes from `subject.grade`.
- Every "is this subject available to this grade" lookup goes through `gradeOfferingWhere()` / `findOfferedSubjects()` / `findOfferedSubject()` from `apps/backend/src/common/grade-subject.util.ts`. No service queries `gradeSubject` directly except the helper, the invariant checker, and the admin tooling.
- **Never widen an empty id list into "no filter".** `subjectIds: []` must keep producing `subjectId: { in: [] }` (zero rows), never an unfiltered list.
- Never delete rows. Deactivate (`isActive: false`).
- Every existing API response shape stays byte-identical. Frontend contracts do not change in this plan.
- Run all pnpm commands from the monorepo root `smartify-ai-phase10-final/smartify-ai` unless a step says otherwise.
- `apps/backend/railway-postgres-vars.json` is untracked and must never be committed or printed.
- `*.postgres.spec.ts` files connect to a **real** database. They must refuse any host that is not `localhost`, `127.0.0.1`, or `[::1]`, and must be read-only in this plan.

## Preconditions

Complete these before Task 1. They are not tasks — they are the state the repository must be in for any of this to be safe.

1. **Commit or stash the in-flight School-directory work.** `git status --short` currently shows 11 modified files and an untracked migration directory `packages/database/prisma/migrations/20260925141543_add_student_school_info/`. Creating a new migration on top of uncommitted schema edits mixes two features in one migration history. Commit or stash it first.
2. **Confirm the local database matches the migrations:**

```bash
pnpm --filter @smartify/database exec prisma migrate status
```

3. **Bring up a local database if needed, and regenerate the client:**

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:generate
```

4. **Add the credential dump to `.gitignore`** (it is currently untracked, so one careless `git add -A` would publish it):

```bash
printf '\n# Railway Postgres connection vars — never commit\napps/backend/railway-postgres-vars.json\n' >> .gitignore
git add .gitignore
git commit -m "chore: ignore railway postgres vars dump"
```

## File structure

Created:

| File | Responsibility |
| --- | --- |
| `apps/backend/src/scripts/shared-subjects-inventory.ts` | Phase 0 read-only report: every Arabic/Social Studies subject, its content home, and what depends on it |
| `apps/backend/src/scripts/shared-subjects-inventory.spec.ts` | Proves the report groups duplicates and that the collector cannot write |
| `apps/backend/src/common/grade-subject-invariants.ts` | Pure invariant checker for the offering table |
| `apps/backend/src/common/grade-subject-invariants.spec.ts` | Fake-db tests for each violation kind |
| `apps/backend/src/common/grade-subject-invariants.postgres.spec.ts` | Read-only, local-only proof that the real database satisfies the invariants |
| `apps/backend/src/common/grade-subject.util.ts` | The ONE place the offering rule lives |
| `apps/backend/src/common/grade-subject.util.spec.ts` | Tests for that rule, including the empty-list trap |
| `apps/backend/src/common/content-scoping.guard.spec.ts` | Fails if a service re-introduces a content query scoped by the student's grade |
| `packages/database/prisma/migrations/<ts>_add_grade_subject_offering/migration.sql` | The table plus its backfill |
| `apps/backend/src/admin/curriculum/admin-curriculum.service.spec.ts` | Created only if Task 10's check shows it is absent |

Modified:

| File | Change |
| --- | --- |
| `packages/database/prisma/schema.prisma` | `GradeSubject` model and its two back-relations |
| `apps/backend/src/onboarding/onboarding.service.ts` + spec | Offering validation |
| `apps/backend/src/billing/billing.service.ts` + spec | Offering validation in `getAvailableSubjects` and `resolvePendingSubscription` |
| `apps/backend/src/trial/trial.service.ts` + spec | Offering validation in `selectSubjects` |
| `apps/backend/src/referral/referral.service.ts` + spec | Offering lookup in `getEligibleRewardSubjects` and `applyReward` |
| `apps/backend/src/curricula/curricula.service.ts` + spec | Public catalog and structure sample read through offerings |
| `apps/backend/src/admin/curriculum/admin-curriculum.service.ts` + spec | `getCurriculumStatus` and `listSubjects` read through offerings, `shared` flag |
| `apps/backend/src/dashboard/dashboard.service.ts` + spec | Drop the student-grade content filter |

---

### Task 1: Phase 0 read-only inventory

**Files:**
- Create: `apps/backend/src/scripts/shared-subjects-inventory.ts`
- Test: `apps/backend/src/scripts/shared-subjects-inventory.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SHARED_SUBJECT_NAMES: readonly ["Arabic", "Social Studies"]`, `parseIdList(raw: unknown): string[]`, `collectInventory(db: PrismaClient): Promise<InventoryReport>`. The report's shape is what Phase 2's plan is written from.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/scripts/shared-subjects-inventory.spec.ts`:

```ts
import { collectInventory, parseIdList, SHARED_SUBJECT_NAMES } from "./shared-subjects-inventory";

const FORBIDDEN = /^(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$queryRawUnsafe)$/;

/** Any write method on any model throws, so "read-only" is enforced, not asserted. */
function readOnly(models: Record<string, any>) {
  return new Proxy(models, {
    get(target, modelName: string) {
      const model = target[modelName];
      if (!model) return undefined;
      return new Proxy(model, {
        get(m, method: string) {
          if (FORBIDDEN.test(method)) throw new Error(`read-only inventory must not call ${modelName}.${method}`);
          return m[method];
        },
      });
    },
  });
}

function models(overrides: Record<string, any> = {}) {
  return {
    subject: {
      findMany: jest.fn(async () => overrides.subjects ?? [
        {
          id: "sub-ar-eg5", nameEn: "Arabic", nameAr: "اللغة العربية", isActive: true,
          sourceFile: "egypt moe/grade 5/arabic.pdf", priceEGP: 150,
          grade: { id: "g-eg-5", nameEn: "Grade 5", level: 5, isActive: true, curriculum: { code: "EG_NATIONAL", nameEn: "Egyptian National" } },
          _count: { studentSubjects: 12 },
        },
        {
          id: "sub-ar-uk6", nameEn: "Arabic", nameAr: "اللغة العربية", isActive: true,
          sourceFile: null, priceEGP: null,
          grade: { id: "g-uk-6", nameEn: "Year 6", level: 6, isActive: true, curriculum: { code: "BRITISH_INTL", nameEn: "British International" } },
          _count: { studentSubjects: 4 },
        },
        {
          id: "sub-ar-us5", nameEn: "Arabic", nameAr: "اللغة العربية", isActive: true,
          sourceFile: null, priceEGP: null,
          grade: { id: "g-us-5", nameEn: "Grade 5", level: 5, isActive: true, curriculum: { code: "AMERICAN_INTL", nameEn: "American International" } },
          _count: { studentSubjects: 0 },
        },
      ]),
    },
    unit: {
      findMany: jest.fn(async () => overrides.units ?? [
        { id: "u1", subjectId: "sub-ar-eg5", nameEn: "Unit 1", groundingNotesJson: { concepts: [] } },
        { id: "u2", subjectId: "sub-ar-eg5", nameEn: "Unit 2", groundingNotesJson: null },
      ]),
    },
    topic: {
      findMany: jest.fn(async () => overrides.topics ?? [
        { id: "t1", unitId: "u1", teachingStepsJson: { steps: [] } },
        { id: "t2", unitId: "u2", teachingStepsJson: null },
      ]),
    },
    lesson: { findMany: jest.fn(async () => overrides.lessons ?? [{ id: "l1", topicId: "t1" }]) },
    lessonTrial: { findMany: jest.fn(async () => overrides.trials ?? [{ id: "tr1", subjectIds: ["sub-ar-uk6", "sub-ar-us5"] }]) },
    subscription: { findMany: jest.fn(async () => overrides.subscriptions ?? [{ id: "s1", selectedSubjectIds: ["sub-ar-eg5"] }]) },
  };
}

test("groups duplicate subjects by name so the decision surface is explicit", async () => {
  const report = await collectInventory(readOnly(models()) as any);
  expect(report.subjectNames).toEqual([...SHARED_SUBJECT_NAMES]);
  expect(report.byName.Arabic).toHaveLength(3);
  expect(report.byName.Arabic[0]).toMatchObject({
    subjectId: "sub-ar-eg5", curriculumCode: "EG_NATIONAL", gradeLevel: 5,
    unitCount: 2, groundedUnitCount: 1, topicCount: 2, generatedTopicCount: 1,
    lessonCount: 1, studentSubjectCount: 12, trialRefCount: 0, subscriptionRefCount: 1,
  });
  expect(report.byName.Arabic[1]).toMatchObject({
    subjectId: "sub-ar-uk6", curriculumCode: "BRITISH_INTL", gradeLevel: 6,
    unitCount: 0, lessonCount: 0, studentSubjectCount: 4, trialRefCount: 1, subscriptionRefCount: 0,
  });
  expect(report.totals).toMatchObject({ subjectCount: 3, subjectsWithContent: 1, unitCount: 2, topicCount: 2, lessonCount: 1 });
});

test("the collector cannot write, even by accident", async () => {
  const db = readOnly(models()) as any;
  await collectInventory(db);
  expect(() => db.subject.deleteMany()).toThrow(/read-only/);
  expect(() => db.subject.updateMany()).toThrow(/read-only/);
});

test("parseIdList tolerates a JSON string, a JSON array, and junk", () => {
  expect(parseIdList('["a","b"]')).toEqual(["a", "b"]);
  expect(parseIdList(["a", 1, null, "b"])).toEqual(["a", "b"]);
  expect(parseIdList(null)).toEqual([]);
  expect(parseIdList("not json")).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend
npx jest scripts/shared-subjects-inventory.spec.ts
```

Expected: FAIL — `Cannot find module './shared-subjects-inventory'`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/scripts/shared-subjects-inventory.ts`:

```ts
// READ-ONLY. Default: inventory only. No writes, no migrations, no R2, no AI.
//
// Phase 0 of docs/superpowers/specs/2026-10-06-shared-subjects-design.md:
// before any shared offering can be created, we need to know how many
// Arabic / Social Studies Subjects already exist per curriculum and whether
// the non-Egyptian ones carry content. An empty duplicate can be withdrawn
// mechanically; a non-empty one needs a human decision, so this report is
// the decision surface, not an implementation detail.
import { PrismaClient } from "@smartify/database";

export const SHARED_SUBJECT_NAMES = ["Arabic", "Social Studies"] as const;

/** `Subscription.selectedSubjectIds` is a Json column and `LessonTrial.subjectIds` is a JSON string — both are read defensively. */
export function parseIdList(raw: unknown): string[] {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export type InventorySubject = {
  subjectId: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
  curriculumCode: string;
  curriculumNameEn: string;
  gradeId: string;
  gradeNameEn: string;
  gradeLevel: number;
  priceEGP: number | null;
  sourceFile: string | null;
  unitCount: number;
  groundedUnitCount: number;
  topicCount: number;
  generatedTopicCount: number;
  lessonCount: number;
  studentSubjectCount: number;
  trialRefCount: number;
  subscriptionRefCount: number;
};

export type InventoryReport = {
  generatedAt: string;
  subjectNames: string[];
  byName: Record<string, InventorySubject[]>;
  totals: {
    subjectCount: number;
    subjectsWithContent: number;
    unitCount: number;
    topicCount: number;
    lessonCount: number;
  };
};

export async function collectInventory(db: PrismaClient): Promise<InventoryReport> {
  const subjects = await db.subject.findMany({
    where: { nameEn: { in: [...SHARED_SUBJECT_NAMES] } },
    select: {
      id: true,
      nameEn: true,
      nameAr: true,
      isActive: true,
      sourceFile: true,
      priceEGP: true,
      grade: { select: { id: true, nameEn: true, level: true, curriculum: { select: { code: true, nameEn: true } } } },
      _count: { select: { studentSubjects: true } },
    },
    orderBy: [{ nameEn: "asc" }, { grade: { curriculum: { code: "asc" } } }, { grade: { level: "asc" } }],
  });

  const subjectIds = subjects.map((s) => s.id);
  const units = subjectIds.length
    ? await db.unit.findMany({ where: { subjectId: { in: subjectIds } }, select: { id: true, subjectId: true, groundingNotesJson: true } })
    : [];
  const unitIds = units.map((u) => u.id);
  const topics = unitIds.length
    ? await db.topic.findMany({ where: { unitId: { in: unitIds } }, select: { id: true, unitId: true, teachingStepsJson: true } })
    : [];
  const topicIds = topics.map((t) => t.id);
  const lessons = topicIds.length
    ? await db.lesson.findMany({ where: { topicId: { in: topicIds } }, select: { id: true, topicId: true } })
    : [];
  const trials = await db.lessonTrial.findMany({ select: { id: true, subjectIds: true } });
  const subscriptions = await db.subscription.findMany({ select: { id: true, selectedSubjectIds: true } });

  const unitToSubject = new Map(units.map((u) => [u.id, u.subjectId]));
  // Keyed by TOPIC id (not unit id): the topic loop looks up a topic's own id,
  // and the lesson loop looks up lesson.topicId — both are topic ids.
  const topicToSubject = new Map(topics.map((t) => [t.id, unitToSubject.get(t.unitId)!]));

  const perSubject = new Map<string, InventorySubject>();
  const byName: Record<string, InventorySubject[]> = {};
  for (const name of SHARED_SUBJECT_NAMES) byName[name] = [];

  for (const subject of subjects) {
    const row: InventorySubject = {
      subjectId: subject.id,
      nameEn: subject.nameEn,
      nameAr: subject.nameAr,
      isActive: subject.isActive,
      curriculumCode: subject.grade.curriculum.code,
      curriculumNameEn: subject.grade.curriculum.nameEn,
      gradeId: subject.grade.id,
      gradeNameEn: subject.grade.nameEn,
      gradeLevel: subject.grade.level,
      priceEGP: subject.priceEGP == null ? null : Number(subject.priceEGP),
      sourceFile: subject.sourceFile,
      unitCount: 0,
      groundedUnitCount: 0,
      topicCount: 0,
      generatedTopicCount: 0,
      lessonCount: 0,
      studentSubjectCount: subject._count.studentSubjects,
      trialRefCount: 0,
      subscriptionRefCount: 0,
    };
    perSubject.set(subject.id, row);
    (byName[subject.nameEn] ??= []).push(row);
  }

  for (const unit of units) {
    const row = perSubject.get(unit.subjectId);
    if (!row) continue;
    row.unitCount += 1;
    if (unit.groundingNotesJson != null) row.groundedUnitCount += 1;
  }
  for (const topic of topics) {
    const row = perSubject.get(topicToSubject.get(topic.id) ?? "");
    if (!row) continue;
    row.topicCount += 1;
    if (topic.teachingStepsJson != null) row.generatedTopicCount += 1;
  }
  for (const lesson of lessons) {
    const row = perSubject.get(topicToSubject.get(lesson.topicId) ?? "");
    if (row) row.lessonCount += 1;
  }
  for (const trial of trials) {
    for (const id of parseIdList(trial.subjectIds)) {
      const row = perSubject.get(id);
      if (row) row.trialRefCount += 1;
    }
  }
  for (const subscription of subscriptions) {
    for (const id of parseIdList(subscription.selectedSubjectIds)) {
      const row = perSubject.get(id);
      if (row) row.subscriptionRefCount += 1;
    }
  }

  const rows = [...perSubject.values()];
  return {
    generatedAt: new Date().toISOString(),
    subjectNames: [...SHARED_SUBJECT_NAMES],
    byName,
    totals: {
      subjectCount: rows.length,
      subjectsWithContent: rows.filter((r) => r.unitCount > 0 || r.topicCount > 0 || r.lessonCount > 0).length,
      unitCount: rows.reduce((n, r) => n + r.unitCount, 0),
      topicCount: rows.reduce((n, r) => n + r.topicCount, 0),
      lessonCount: rows.reduce((n, r) => n + r.lessonCount, 0),
    },
  };
}

async function main() {
  const db = new PrismaClient();
  try {
    const report = await collectInventory(db);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/backend
npx jest scripts/shared-subjects-inventory.spec.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/scripts/shared-subjects-inventory.ts apps/backend/src/scripts/shared-subjects-inventory.spec.ts
git commit -m "feat(scripts): read-only shared-subjects inventory for phase 0"
```

---

### Task 2: `GradeSubject` model, migration, and backfill

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_add_grade_subject_offering/migration.sql` (generated, then edited)

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma model `GradeSubject` with fields `id`, `gradeId`, `subjectId`, `isActive`, `createdAt`, the unique constraint `@@unique([gradeId, subjectId])`, and the client delegate `db.gradeSubject`. Every pre-existing `Subject` has exactly one offering pointing at its own `gradeId`.

- [ ] **Step 1: Add the back-relation on `Grade`**

In `packages/database/prisma/schema.prisma`, in `model Grade`, replace:

```prisma
  subjects        Subject[]
  studentProfiles StudentProfile[]
```

with:

```prisma
  subjects        Subject[]
  // Grades that OFFER this grade's subjects are found through
  // GradeSubject.subjectId — see Subject.gradeOfferings.
  offeredSubjects GradeSubject[]
  studentProfiles StudentProfile[]
```

- [ ] **Step 2: Add the back-relation on `Subject`**

In `model Subject`, replace:

```prisma
  units           Unit[]
  studentSubjects StudentSubject[]
```

with:

```prisma
  units           Unit[]
  // GradeSubject is what a student/admin sees for their own grade.
  // `gradeId` above is this Subject's CONTENT HOME (where its units,
  // textbook mapping, and price are authored) — for a shared subject that
  // is the Egyptian reference grade, while other curricula's grades offer
  // it through these rows.
  gradeOfferings  GradeSubject[]
  studentSubjects StudentSubject[]
```

- [ ] **Step 3: Add the model**

Insert immediately after `model Subject`'s closing brace (just before `model StudentSubject`):

```prisma
/// A grade offers a subject. Subject.gradeId is the CONTENT HOME (where
/// units, textbook mapping, and price are authored — always the Egyptian
/// reference grade for shared subjects); GradeSubject is what a student or
/// admin sees for their own grade. Every subject has at least its own home
/// grade as an offering, so the read path has exactly one shape.
model GradeSubject {
  id        String   @id @default(cuid())
  gradeId   String
  grade     Grade    @relation(fields: [gradeId], references: [id])
  subjectId String
  subject   Subject  @relation(fields: [subjectId], references: [id])
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())

  @@unique([gradeId, subjectId])
  @@index([gradeId, isActive])
  @@index([subjectId])
}
```

- [ ] **Step 4: Generate the migration without applying it**

```bash
pnpm --filter @smartify/database exec prisma migrate dev --create-only --name add_grade_subject_offering
```

Expected: a new directory `packages/database/prisma/migrations/<timestamp>_add_grade_subject_offering/` containing `migration.sql` that creates the table, the unique index, and the two indexes. Nothing is applied yet.

- [ ] **Step 5: Append the backfill to the generated SQL**

Append to the end of the generated `migration.sql`:

```sql
-- Backfill (2026-10-06): every Subject must be offered by its own content-home
-- grade. This is what makes Phase 1 behavior-identical to the pre-change
-- application: every existing subject stays exactly as reachable as it was.
-- Subject.gradeId is the CONTENT HOME and is never modified here.
INSERT INTO "GradeSubject" ("id", "gradeId", "subjectId", "isActive", "createdAt")
SELECT gen_random_uuid()::text, s."gradeId", s."id", true, NOW()
FROM "Subject" s
ON CONFLICT ("gradeId", "subjectId") DO NOTHING;

-- Fail loudly rather than shipping a half-backfilled table. Prisma runs each
-- migration inside a transaction on PostgreSQL, so raising here rolls the
-- whole migration back.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Subject" s
    WHERE NOT EXISTS (SELECT 1 FROM "GradeSubject" gs WHERE gs."subjectId" = s."id")
  ) THEN
    RAISE EXCEPTION 'GradeSubject backfill incomplete: some Subjects have no offering';
  END IF;
END $$;
```

If the target PostgreSQL is older than 13, add `CREATE EXTENSION IF NOT EXISTS pgcrypto;` as the first line of the appended block — `gen_random_uuid()` is built in from 13 onward, and the column has no database-side default because Prisma generates `cuid()` in the application.

- [ ] **Step 6: Apply it**

```bash
pnpm db:migrate
```

Expected: the migration applies cleanly; no exception from the `DO` block. If the guard raises, the `Subject` table changed concurrently — re-run the backfill rather than forcing it.

- [ ] **Step 7: Confirm the client knows the new model**

```bash
pnpm db:generate
cd apps/backend && npx tsc --noEmit
```

Expected: `db.gradeSubject` exists on the generated client and the backend still compiles.

- [ ] **Step 8: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): add GradeSubject offering table with full backfill"
```

---

### Task 3: Invariant checker

**Files:**
- Create: `apps/backend/src/common/grade-subject-invariants.ts`
- Test: `apps/backend/src/common/grade-subject-invariants.spec.ts`
- Test: `apps/backend/src/common/grade-subject-invariants.postgres.spec.ts`

**Interfaces:**
- Consumes: the `GradeSubject` model from Task 2.
- Produces: `findInvariantViolations(db: PrismaClient): Promise<InvariantViolation[]>` and the `InvariantViolation` union. The Phase 2 plan reuses this before and after the entitlement re-pointing.

What this checker does and does not prove: `GRADE_OFFERS_TWO_HOMES_FOR_SAME_SUBJECT` catches two active rows for the same subject *name* offered to one grade — an accidental duplicate. It is not a name-based heuristic for "British Year 6 Arabic and Egyptian Grade 5 Arabic are the same subject"; that correspondence is human-reviewed in Phase 2, not inferred here.

- [ ] **Step 1: Write the failing fake-db test**

Create `apps/backend/src/common/grade-subject-invariants.spec.ts`:

```ts
import { findInvariantViolations } from "./grade-subject-invariants";

function db(overrides: { offerings?: any[]; subjects?: any[]; studentSubjects?: any[] }) {
  return {
    gradeSubject: { findMany: jest.fn(async () => overrides.offerings ?? []) },
    subject: { findMany: jest.fn(async () => overrides.subjects ?? []) },
    studentSubject: { findMany: jest.fn(async () => overrides.studentSubjects ?? []) },
  } as any;
}

const offered = (subjectId: string, gradeId: string, extra: any = {}) => ({
  id: `off-${subjectId}-${gradeId}`, gradeId, subjectId, isActive: true, subject: { isActive: true }, ...extra,
});

test("a healthy catalog has no violations", async () => {
  const violations = await findInvariantViolations(db({
    subjects: [{ id: "s1", nameEn: "Arabic", gradeId: "g-eg", isActive: true }],
    offerings: [offered("s1", "g-eg")],
    studentSubjects: [{ studentId: "st1", subjectId: "s1", student: { gradeId: "g-eg" } }],
  }));
  expect(violations).toEqual([]);
});

test("flags a subject that no grade offers", async () => {
  const violations = await findInvariantViolations(db({
    subjects: [{ id: "s1", nameEn: "Arabic", gradeId: "g-eg", isActive: true }],
    offerings: [],
  }));
  expect(violations).toEqual([
    { kind: "SUBJECT_WITHOUT_HOME_OFFERING", subjectId: "s1", nameEn: "Arabic", gradeId: "g-eg" },
  ]);
});

test("flags an active offering that points at an inactive subject", async () => {
  const violations = await findInvariantViolations(db({
    subjects: [{ id: "s1", nameEn: "Arabic", gradeId: "g-eg", isActive: false }],
    offerings: [{ ...offered("s1", "g-eg"), subject: { isActive: false } }],
  }));
  expect(violations).toEqual([
    { kind: "OFFERING_POINTS_AT_INACTIVE_SUBJECT", offeringId: "off-s1-g-eg", subjectId: "s1" },
  ]);
});

test("flags an entitlement the student's own grade does not offer", async () => {
  const violations = await findInvariantViolations(db({
    subjects: [{ id: "s1", nameEn: "Arabic", gradeId: "g-eg", isActive: true }],
    offerings: [offered("s1", "g-eg")],
    studentSubjects: [{ studentId: "st1", subjectId: "s1", student: { gradeId: "g-uk" } }],
  }));
  expect(violations).toEqual([
    { kind: "ENTITLEMENT_NOT_OFFERED_FOR_STUDENT_GRADE", studentId: "st1", subjectId: "s1", gradeId: "g-uk" },
  ]);
});

test("flags one grade offering two active rows for the same subject name", async () => {
  // Two Arabic rows under the same Egyptian grade, both offered there: an
  // accidental duplicate that would render twice in the student's list.
  const violations = await findInvariantViolations(db({
    subjects: [
      { id: "s1", nameEn: "Arabic", gradeId: "g-eg", isActive: true },
      { id: "s2", nameEn: "Arabic", gradeId: "g-eg", isActive: true },
    ],
    offerings: [offered("s1", "g-eg"), offered("s2", "g-eg")],
  }));
  expect(violations).toEqual([
    { kind: "GRADE_OFFERS_TWO_HOMES_FOR_SAME_SUBJECT", gradeId: "g-eg", nameEn: "Arabic", subjectIds: ["s1", "s2"] },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend
npx jest common/grade-subject-invariants.spec.ts
```

Expected: FAIL — `Cannot find module './grade-subject-invariants'`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/common/grade-subject-invariants.ts`:

```ts
import { PrismaClient } from "@smartify/database";

/**
 * Grade offering invariants (2026-10-06). Read-only by construction: three
 * findMany calls and set arithmetic, no writes of any kind.
 *
 * The invariants exist because Phase 1 makes "a grade offers a subject" the
 * only availability rule. If any of them is false, a student can end up
 * holding an entitlement nothing lists, or a grade can list the same subject
 * twice — both of which fail silently in the UI rather than loudly.
 */
export type InvariantViolation =
  | { kind: "SUBJECT_WITHOUT_HOME_OFFERING"; subjectId: string; nameEn: string; gradeId: string }
  | { kind: "GRADE_OFFERS_TWO_HOMES_FOR_SAME_SUBJECT"; gradeId: string; nameEn: string; subjectIds: string[] }
  | { kind: "OFFERING_POINTS_AT_INACTIVE_SUBJECT"; offeringId: string; subjectId: string }
  | { kind: "ENTITLEMENT_NOT_OFFERED_FOR_STUDENT_GRADE"; studentId: string; subjectId: string; gradeId: string };

export async function findInvariantViolations(db: PrismaClient): Promise<InvariantViolation[]> {
  const offerings = await db.gradeSubject.findMany({
    select: { id: true, gradeId: true, subjectId: true, isActive: true, subject: { select: { isActive: true } } },
  });
  const subjects = await db.subject.findMany({
    select: { id: true, nameEn: true, gradeId: true, isActive: true },
  });
  const entitlements = await db.studentSubject.findMany({
    select: { studentId: true, subjectId: true, student: { select: { gradeId: true } } },
  });

  const violations: InvariantViolation[] = [];
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const offeredPairs = new Set(offerings.filter((o) => o.isActive).map((o) => `${o.gradeId}:${o.subjectId}`));
  // Grouped by CONTENT HOME (subject.gradeId): two rows under one grade that
  // both borrow content from the same home are the duplicate shape.
  const duplicates = new Map<string, { gradeId: string; nameEn: string; subjectIds: string[] }>();

  for (const offering of offerings) {
    if (offering.isActive && !offering.subject.isActive) {
      violations.push({ kind: "OFFERING_POINTS_AT_INACTIVE_SUBJECT", offeringId: offering.id, subjectId: offering.subjectId });
    }
    if (!offering.isActive) continue;
    const subject = subjectById.get(offering.subjectId);
    if (!subject) continue;
    const key = `${offering.gradeId}\u0000${subject.nameEn}\u0000${subject.gradeId}`;
    const group = duplicates.get(key) ?? { gradeId: offering.gradeId, nameEn: subject.nameEn, subjectIds: [] };
    group.subjectIds.push(offering.subjectId);
    duplicates.set(key, group);
  }

  for (const subject of subjects) {
    if (!subject.isActive) continue;
    if (!offeredPairs.has(`${subject.gradeId}:${subject.id}`)) {
      violations.push({ kind: "SUBJECT_WITHOUT_HOME_OFFERING", subjectId: subject.id, nameEn: subject.nameEn, gradeId: subject.gradeId });
    }
  }

  for (const group of duplicates.values()) {
    if (group.subjectIds.length < 2) continue;
    violations.push({ ...group, subjectIds: [...group.subjectIds].sort() });
  }

  for (const entitlement of entitlements) {
    const gradeId = entitlement.student.gradeId;
    if (!offeredPairs.has(`${gradeId}:${entitlement.subjectId}`)) {
      violations.push({
        kind: "ENTITLEMENT_NOT_OFFERED_FOR_STUDENT_GRADE",
        studentId: entitlement.studentId,
        subjectId: entitlement.subjectId,
        gradeId,
      });
    }
  }

  return violations;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/backend
npx jest common/grade-subject-invariants.spec.ts
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Add the read-only, local-only PostgreSQL test**

Create `apps/backend/src/common/grade-subject-invariants.postgres.spec.ts`:

```ts
/**
 * Read-only proof that the REAL database satisfies the GradeSubject
 * invariants after Task 2's backfill. This file never writes: it calls
 * findInvariantViolations() and nothing else, and refuses to connect to
 * anything that is not a local database.
 *
 * Excluded from the default jest run by jest.config.js's
 * testPathIgnorePatterns — run it explicitly:
 *   pnpm --filter @smartify/backend exec jest --testPathIgnorePatterns=/node_modules/ \
 *     --testPathPattern=grade-subject-invariants.postgres.spec.ts
 */
import * as path from "node:path";
import * as dotenv from "dotenv";
import { PrismaClient } from "@smartify/database";
import { findInvariantViolations } from "./grade-subject-invariants";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

describe("grade offering invariants — read-only, real PostgreSQL", () => {
  let db: PrismaClient;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (expected apps/backend/.env or the shell environment)");
    const host = new URL(url).hostname;
    if (!ALLOWED_HOSTS.has(host)) throw new Error(`Refusing to run against non-local host: ${host}`);
    db = new PrismaClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("every active subject has its home offering, and no grade offers two rows for one subject", async () => {
    expect(await findInvariantViolations(db)).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the PostgreSQL test**

```bash
pnpm --filter @smartify/backend exec jest --testPathIgnorePatterns=/node_modules/ --testPathPattern=grade-subject-invariants.postgres.spec.ts
```

Expected: PASS against local PostgreSQL. If it reports `SUBJECT_WITHOUT_HOME_OFFERING`, Task 2's backfill did not cover every subject — investigate before continuing.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/common/grade-subject-invariants.ts apps/backend/src/common/grade-subject-invariants.spec.ts apps/backend/src/common/grade-subject-invariants.postgres.spec.ts
git commit -m "feat(backend): grade offering invariant checker with read-only postgres test"
```

---

### Task 4: The offering rule, in one place

**Files:**
- Create: `apps/backend/src/common/grade-subject.util.ts`
- Test: `apps/backend/src/common/grade-subject.util.spec.ts`

**Interfaces:**
- Consumes: `GradeSubject` from Task 2.
- Produces:
  - `gradeOfferingWhere(gradeId: string, subjectIds?: string[])`
  - `findOfferedSubjects(db: PrismaClient, gradeId: string, subjectIds?: string[]): Promise<Subject[]>`
  - `findOfferedSubject(db: PrismaClient, gradeId: string, subjectId: string): Promise<Subject | null>`
  - Tasks 5-10 consume all three.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/common/grade-subject.util.spec.ts`:

```ts
import { findOfferedSubject, findOfferedSubjects, gradeOfferingWhere } from "./grade-subject.util";

function dbWith(rows: any[]) {
  const gradeSubject = {
    findMany: jest.fn(async ({ where }: any) =>
      rows
        .filter((r) => r.gradeId === where.gradeId)
        .filter((r) => (where.subjectId ? where.subjectId.in.includes(r.subjectId) : true))
        .filter((r) => r.isActive === where.isActive)
        .map((r) => ({ subject: r.subject })),
    ),
    findFirst: jest.fn(async ({ where }: any) =>
      rows
        .filter((r) => r.gradeId === where.gradeId && where.subjectId.in.includes(r.subjectId) && r.isActive === where.isActive)
        .map((r) => ({ subject: r.subject }))[0] ?? null,
    ),
  };
  return { gradeSubject } as any;
}

const arabic = { id: "subject-arabic-eg5", nameEn: "Arabic", nameAr: "اللغة العربية", gradeId: "grade-eg-5", isActive: true };
const math = { id: "subject-math-uk6", nameEn: "Mathematics", nameAr: "الرياضيات", gradeId: "grade-uk-6", isActive: true };

// British Year 6 offers Egyptian Grade 5 Arabic: the offering's grade and the
// subject's content home are deliberately different grades.
const OFFERINGS = [
  { gradeId: "grade-uk-6", subjectId: arabic.id, isActive: true, subject: arabic },
  { gradeId: "grade-uk-6", subjectId: math.id, isActive: true, subject: math },
  { gradeId: "grade-eg-5", subjectId: arabic.id, isActive: true, subject: arabic },
];

test("returns only the subjects the grade actually offers", async () => {
  const db = dbWith(OFFERINGS);
  const subjects = await findOfferedSubjects(db, "grade-uk-6");
  expect(subjects.map((s) => s.id).sort()).toEqual([arabic.id, math.id]);
});

test("a shared subject is returned for a grade that does not own its content home", async () => {
  const db = dbWith(OFFERINGS);
  const subjects = await findOfferedSubjects(db, "grade-uk-6", [arabic.id]);
  expect(subjects).toEqual([arabic]);
  expect(arabic.gradeId).toBe("grade-eg-5");
});

test("an empty id list means no subjects — never every subject of the grade", async () => {
  const db = dbWith(OFFERINGS);
  expect(gradeOfferingWhere("grade-uk-6", [])).toEqual({
    gradeId: "grade-uk-6",
    isActive: true,
    subject: { isActive: true },
    subjectId: { in: [] },
  });
  expect(await findOfferedSubjects(db, "grade-uk-6", [])).toEqual([]);
});

test("omitting the id list lists the whole grade", async () => {
  expect(gradeOfferingWhere("grade-uk-6")).toEqual({ gradeId: "grade-uk-6", isActive: true, subject: { isActive: true } });
});

test("findOfferedSubject resolves a single offering, and null when the grade does not offer it", async () => {
  const db = dbWith(OFFERINGS);
  expect(await findOfferedSubject(db, "grade-uk-6", arabic.id)).toEqual(arabic);
  expect(await findOfferedSubject(db, "grade-eg-5", math.id)).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend
npx jest common/grade-subject.util.spec.ts
```

Expected: FAIL — `Cannot find module './grade-subject.util'`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/common/grade-subject.util.ts`:

```ts
import { PrismaClient } from "@smartify/database";

/**
 * Grade offering V1 (2026-10-06) — the ONE place the "is this Subject
 * available to this Grade" rule lives. A Subject's own `gradeId` is its
 * CONTENT HOME (where its units, textbook mapping, and price are authored);
 * a Grade OFFERS a Subject through GradeSubject, which may point at a
 * Subject whose content home is a different curriculum's grade. Every call
 * site that used to filter `subject.gradeId = the student's grade` must go
 * through here instead, so the rule can never drift between call sites.
 *
 * `subjectIds` is passed through as an `in` filter even when EMPTY, so an
 * empty selection keeps meaning "no subjects" — never "no filter at all",
 * which would silently list a whole grade's catalog.
 */
export function gradeOfferingWhere(gradeId: string, subjectIds?: string[]) {
  return {
    gradeId,
    isActive: true,
    subject: { isActive: true },
    ...(subjectIds !== undefined ? { subjectId: { in: subjectIds } } : {}),
  };
}

/** Subjects this grade offers, as plain Subject rows so callers keep their existing response shape. */
export async function findOfferedSubjects(db: PrismaClient, gradeId: string, subjectIds?: string[]) {
  const offerings = await db.gradeSubject.findMany({
    where: gradeOfferingWhere(gradeId, subjectIds),
    include: { subject: true },
    orderBy: { subject: { nameEn: "asc" } },
  });
  return offerings.map((offering) => offering.subject);
}

/** A single offering lookup, used where a caller previously did `subject.findFirst({ id, gradeId })`. */
export async function findOfferedSubject(db: PrismaClient, gradeId: string, subjectId: string) {
  const offering = await db.gradeSubject.findFirst({
    where: gradeOfferingWhere(gradeId, [subjectId]),
    include: { subject: true },
  });
  return offering?.subject ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/backend
npx jest common/grade-subject.util.spec.ts
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/common/grade-subject.util.ts apps/backend/src/common/grade-subject.util.spec.ts
git commit -m "feat(backend): single source of truth for grade/subject availability"
```

---

### Task 5: Onboarding validates against offerings

**Files:**
- Modify: `apps/backend/src/onboarding/onboarding.service.ts:31-36`
- Test: `apps/backend/src/onboarding/onboarding.service.spec.ts`

**Interfaces:**
- Consumes: `findOfferedSubjects` from Task 4.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Update the harness and add the failing test**

In `apps/backend/src/onboarding/onboarding.service.spec.ts`, replace line 25:

```ts
        subject: { findMany: jest.fn().mockResolvedValue(overrides.subjects ?? [subjectInGrade1]) },
```

with:

```ts
        // Availability is now an OFFERING question (GradeSubject), not a
        // property of the Subject row: a shared subject's own gradeId is its
        // content home, which may be a different curriculum's grade entirely.
        gradeSubject: {
          findMany: jest.fn().mockImplementation(async ({ where }: any) =>
            (overrides.subjects ?? [subjectInGrade1])
              .filter((s: any) => (where.subjectId ? where.subjectId.in.includes(s.id) : true))
              .map((s: any) => ({ subject: s })),
          ),
        },
        subject: { findMany: jest.fn().mockResolvedValue([]) },
```

Then add this test inside the `describe("OnboardingService", ...)` block:

```ts
  it("accepts a shared subject whose content home is a different curriculum's grade", async () => {
    // British Grade 1 offers Egyptian Grade 1 Arabic. The Subject's own
    // gradeId is the EG grade — its content home — and is NOT the student's
    // grade. The old subject.findMany({ gradeId: studentGrade }) form rejected
    // exactly this case.
    const sharedArabic = { id: "subject-arabic-eg1", gradeId: "grade-eg-1", isActive: true };
    const prisma = makePrismaMock({ subjects: [sharedArabic] });
    const service = new OnboardingService(prisma, mockQuestionGenerator);

    await service.saveProfile("user-1", { ...baseInput, subjectIds: [sharedArabic.id] });

    expect(prisma.client.gradeSubject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ gradeId: "grade-1", subjectId: { in: [sharedArabic.id] } }) }),
    );
    expect(prisma.client.studentSubject.createMany).toHaveBeenCalledWith({
      data: [{ studentId: "student-1", subjectId: sharedArabic.id }],
    });
  });
```

The existing rejection tests keep their meaning unchanged: they request a subject id that the offering mock does not return, so the length check still rejects them.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend
npx jest onboarding/onboarding.service.spec.ts
```

Expected: FAIL on the new test — `gradeSubject.findMany` is never called, because the service still queries `subject`.

- [ ] **Step 3: Change the service**

In `apps/backend/src/onboarding/onboarding.service.ts`, add the import:

```ts
import { findOfferedSubjects } from "../common/grade-subject.util";
```

and replace:

```ts
    const subjects = await this.prisma.client.subject.findMany({
      where: { id: { in: input.subjectIds }, gradeId: grade.id },
    });
    if (subjects.length !== input.subjectIds.length) {
      throw new BadRequestException("One or more subjects are invalid for the selected grade.");
    }
```

with:

```ts
    // Availability is an OFFERING question: `grade` may offer a Subject whose
    // content home is another curriculum's grade (shared Arabic / Social
    // Studies). Validation and the response shape are otherwise unchanged.
    const subjects = await findOfferedSubjects(this.prisma.client, grade.id, input.subjectIds);
    if (subjects.length !== input.subjectIds.length) {
      throw new BadRequestException("One or more subjects are invalid for the selected grade.");
    }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/backend
npx jest onboarding/onboarding.service.spec.ts
```

Expected: PASS — the new test plus every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/onboarding/onboarding.service.ts apps/backend/src/onboarding/onboarding.service.spec.ts
git commit -m "feat(onboarding): validate subject selection against grade offerings"
```

---

### Task 6: Billing validates against offerings

**Files:**
- Modify: `apps/backend/src/billing/billing.service.ts:66-78` and `:143`
- Test: `apps/backend/src/billing/billing.service.spec.ts`

**Interfaces:**
- Consumes: `findOfferedSubjects` from Task 4.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Update the harness and correct the stale comment**

In `apps/backend/src/billing/billing.service.spec.ts`, replace line 44:

```ts
        subject: { findMany: jest.fn().mockResolvedValue(overrides.subjects ?? []) },
```

with:

```ts
        gradeSubject: {
          findMany: jest.fn().mockImplementation(async ({ where }: any) =>
            (overrides.subjects ?? [])
              .filter((s: any) => (where.subjectId ? where.subjectId.in.includes(s.id) : true))
              .map((s: any) => ({ subject: s })),
          ),
        },
        subject: { findMany: jest.fn().mockResolvedValue([]) },
```

Find every other subject mock in this file and give it the same treatment:

```bash
grep -n "subject:" apps/backend/src/billing/billing.service.spec.ts
```

Each remaining `subject.findMany` *availability* mock (notably the one around line 277) becomes a `gradeSubject.findMany` returning `{ subject }` rows. Lookups by id alone — `subject.findMany({ where: { id: { in: selectedSubjectIds } } })` for display in `getCurrentSubscription` — stay on `subject`.

Replace the now-wrong comment on line 80:

```ts
    // subject.findMany is grade-scoped in the query itself — returning fewer subjects than requested means one didn't match.
```

with:

```ts
    // gradeSubject is what scopes availability now — returning fewer subjects than requested means the grade doesn't offer one of them.
```

- [ ] **Step 2: Add the failing test**

Add this test alongside the other checkout tests:

```ts
  it("lists a shared subject offered by the student's grade, priced from its content home", async () => {
    // The subject's own gradeId is the Egyptian grade (its content home); the
    // student's grade is grade-A. Under the old rule this subject was invisible.
    const sharedArabic = { id: "subject-arabic-eg5", gradeId: "grade-eg-5", isActive: true, nameEn: "Arabic", nameAr: "اللغة العربية", priceEGP: 150 };
    const prisma = makePrismaMock({ subjects: [sharedArabic] });
    const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

    await expect(service.getAvailableSubjects("user-1")).resolves.toEqual([
      { id: sharedArabic.id, nameEn: "Arabic", nameAr: "اللغة العربية", priceEGP: 150 },
    ]);
    expect(prisma.client.gradeSubject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ gradeId: "grade-A" }) }),
    );
  });
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd apps/backend
npx jest billing/billing.service.spec.ts
```

Expected: FAIL on the new test — `gradeSubject.findMany` is never called.

- [ ] **Step 4: Change the service**

In `apps/backend/src/billing/billing.service.ts`, add:

```ts
import { findOfferedSubjects } from "../common/grade-subject.util";
```

Replace `getAvailableSubjects`' query (lines 68-71):

```ts
    const subjects = await this.prisma.client.subject.findMany({
      where: { gradeId: profile.gradeId, isActive: true },
      orderBy: { nameEn: "asc" },
    });
```

with:

```ts
    // Every Subject this grade OFFERS — including shared Arabic / Social
    // Studies whose content home is the Egyptian grade. priceEGP is always
    // read from the content-home Subject row, so the price is unified across
    // every system that offers it.
    const subjects = await findOfferedSubjects(this.prisma.client, profile.gradeId);
```

Replace the validation query in `resolvePendingSubscription` (line 143):

```ts
    const subjects = await this.prisma.client.subject.findMany({ where: { id: { in: selectedSubjectIds }, gradeId: profile.gradeId, isActive: true } });
```

with:

```ts
    const subjects = await findOfferedSubjects(this.prisma.client, profile.gradeId, selectedSubjectIds);
```

Nothing else in that method changes: the unpriced check, the `monthlyTotalEGP` sum, and the `Subscription` upsert all keep operating on the returned Subject rows.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/backend
npx jest billing/billing.service.spec.ts
```

Expected: PASS — including the pre-existing "rejects checkout for a subject outside the student's own grade" and "rejects checkout for a subject that has no priceEGP" tests, which now exercise the offering rule.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/billing/billing.service.ts apps/backend/src/billing/billing.service.spec.ts
git commit -m "feat(billing): offer-based subject validation and listing"
```

---

### Task 7: Trial selection validates against offerings

The method is `selectSubjects(userId, subjectIds)` — not `markSelection`.

**Files:**
- Modify: `apps/backend/src/trial/trial.service.ts:48-53`
- Test: `apps/backend/src/trial/trial.service.spec.ts`

**Interfaces:**
- Consumes: `findOfferedSubjects` from Task 4.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Update the harness and add the failing test**

In `apps/backend/src/trial/trial.service.spec.ts`, `makeHarness` currently mocks `subject.findMany` (lines 35-40) for the selection check, while `getState` reads subjects by id (service line 79). Split the mock so the two are distinguishable — replace the `subject` block with:

```ts
        gradeSubject: {
          findMany: jest.fn().mockImplementation(async ({ where }: any) => {
            const ids: string[] = where.subjectId.in;
            return subjects
              .filter((s) => ids.includes(s.id) && s.isActive === where.isActive)
              .map((s) => ({ subject: s }));
          }),
        },
        subject: {
          findMany: jest.fn().mockImplementation(async ({ where }: any) => {
            const ids: string[] = where.id.in;
            return subjects.filter((s) => ids.includes(s.id));
          }),
        },
```

Note what changed and what did not: the `gradeId === where.gradeId` filter is gone from the offering mock (an offering's grade is the student's grade, not the subject's content home), and `getState`'s by-id lookup stays on `subject`.

Then add this test inside `describe("selectSubjects", ...)`:

```ts
    it("accepts two subjects the grade offers, including one whose content home is another grade", async () => {
      // The subject's own gradeId is grade-2 (its content home); the student's
      // grade is grade-1. The old grade-scoped query rejected this outright.
      const h = makeHarness({
        subjects: [
          { id: "subject-math", gradeId: "grade-1", isActive: true },
          { id: "subject-arabic-eg5", gradeId: "grade-2", isActive: true },
        ],
      });

      const result = await h.service.selectSubjects("user-1", ["subject-math", "subject-arabic-eg5"]);

      expect(result.selected).toBe(true);
      expect(h.prisma.client.gradeSubject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ gradeId: "grade-1" }) }),
      );
    });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend
npx jest trial/trial.service.spec.ts
```

Expected: FAIL on the new test — `gradeSubject.findMany` is never called.

- [ ] **Step 3: Change the service**

In `apps/backend/src/trial/trial.service.ts`, add:

```ts
import { findOfferedSubjects } from "../common/grade-subject.util";
```

and replace:

```ts
    const subjects = await this.prisma.client.subject.findMany({
      where: { id: { in: unique }, gradeId: profile.gradeId, isActive: true },
    });
    if (subjects.length !== 2) {
      throw new BadRequestException("One or more selected subjects are not available for your grade.");
    }
```

with:

```ts
    const subjects = await findOfferedSubjects(this.prisma.client, profile.gradeId, unique);
    if (subjects.length !== 2) {
      throw new BadRequestException("One or more selected subjects are not available for your grade.");
    }
```

`getState` (line 79) keeps its `subject.findMany({ where: { id: { in: subjectIds } } })` — it resolves display names for already-granted ids and must not be offering-filtered.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/backend
npx jest trial/trial.service.spec.ts
```

Expected: PASS — the new test plus the pre-existing "exactly two different subjects", "rejects a subject outside the student's own grade" and concurrency tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/trial/trial.service.ts apps/backend/src/trial/trial.service.spec.ts
git commit -m "feat(trial): offer-based free-trial subject selection"
```

---

### Task 8: Referral listing and reward application use offerings

**Files:**
- Modify: `apps/backend/src/referral/referral.service.ts:121` and `:140`
- Test: `apps/backend/src/referral/referral.service.spec.ts`

**Interfaces:**
- Consumes: `findOfferedSubjects`, `findOfferedSubject` from Task 4.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Update the harness and add the failing test**

In `apps/backend/src/referral/referral.service.spec.ts`, the `subject` mock (lines 37-40) serves two different questions. Replace it with:

```ts
        gradeSubject: {
          findMany: async ({ where }: any) =>
            subjects
              .filter((s) => (where.subjectId?.in ? where.subjectId.in.includes(s.id) : true) && s.isActive === where.isActive)
              .map((s) => ({ subject: s })),
          findFirst: async ({ where }: any) =>
            subjects
              .filter((s) => where.subjectId.in.includes(s.id) && s.isActive === where.isActive)
              .map((s) => ({ subject: s }))[0] ?? null,
        },
        subject: {
          // getState resolves display names for ids already granted — by id
          // alone, deliberately not offering-filtered.
          findMany: async ({ where }: any) => subjects.filter((s) => (where.id?.in ? where.id.in.includes(s.id) : true)),
        },
```

Then enumerate the remaining uses so nothing silently depends on the old mock:

```bash
grep -n "subject" apps/backend/src/referral/referral.service.spec.ts
```

Then add this test:

```ts
    it("offers a shared subject to a grade that does not own its content home", async () => {
      // The referrer's grade is grade-1; shared Arabic's content home is
      // grade-eg-5. Under the old rule it never appeared here at all.
      const h = makeHarness();
      const sharedArabic = { id: "subject-arabic-eg5", gradeId: "grade-eg-5", isActive: true, nameEn: "Arabic", nameAr: "العربية" };
      h.subjects.push(sharedArabic);

      const eligible = await h.service.getEligibleRewardSubjects("user-referrer");

      expect(eligible).toContainEqual({ id: sharedArabic.id, nameEn: "Arabic", nameAr: "العربية" });
    });
```

This requires `makeHarness` to return the `subjects` fixture array alongside the existing `service`/`prisma` values. Add `subjects` to the harness's return object; the array is the same one both mocks above are built from.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend
npx jest referral/referral.service.spec.ts
```

Expected: FAIL on the new test — the service still lists subjects by `subject.gradeId`.

- [ ] **Step 3: Change the service**

In `apps/backend/src/referral/referral.service.ts`, add:

```ts
import { findOfferedSubject, findOfferedSubjects } from "../common/grade-subject.util";
```

Replace line 121:

```ts
    const subjects = await this.prisma.client.subject.findMany({ where: { gradeId: profile.gradeId, isActive: true }, orderBy: { nameEn: "asc" } });
```

with:

```ts
    const subjects = await findOfferedSubjects(this.prisma.client, profile.gradeId);
```

Replace line 140:

```ts
    const subject = await this.prisma.client.subject.findFirst({ where: { id: subjectId, gradeId: profile.gradeId, isActive: true } });
```

with:

```ts
    const subject = await findOfferedSubject(this.prisma.client, profile.gradeId, subjectId);
```

The rest of `applyReward` — the error message, the `expiresAt` stacking rule, the conditional `updateMany` — is unchanged. A referral granted for shared Arabic is now valid in every system that offers it.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/backend
npx jest referral/referral.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/referral/referral.service.ts apps/backend/src/referral/referral.service.spec.ts
git commit -m "feat(referral): offer-based eligible subjects and reward application"
```

---

### Task 9: Public catalog reads through offerings

`apps/backend/src/curricula/curricula.service.spec.ts` **already exists** and its fixtures feed `grades[].subjects` directly, so they must be converted to the offering shape or the mapping below will throw on `undefined`.

**Files:**
- Modify: `apps/backend/src/curricula/curricula.service.ts`
- Test: `apps/backend/src/curricula/curricula.service.spec.ts`

**Interfaces:**
- Consumes: `GradeSubject` rows shaped `{ isActive, subject }`.
- Produces: the same response shape as today — `grades[].subjects[]` — so no frontend change is needed.

- [ ] **Step 1: Convert the existing fixtures**

```bash
grep -n "subjects:\|describe(\|getStructureSample" apps/backend/src/curricula/curricula.service.spec.ts
```

Every fixture property that currently reads `subjects: [ { id, nameEn, ... } ]` must become the offering shape. For example, the fixture on line 32:

```ts
{ id: "g1", nameEn: "Grade 1", nameAr: "الأول", level: 1, subjects: [] },
```

becomes:

```ts
{ id: "g1", nameEn: "Grade 1", nameAr: "الأول", level: 1, offeredSubjects: [] },
```

and the fixture on line 41:

```ts
{ id: "g1", nameEn: "Grade 1", nameAr: "الأول", level: 1, subjects: [{ id: "s1", nameEn: "Mathematics", nameAr: "الرياضيات", icon: "calculator" }] },
```

becomes:

```ts
{ id: "g1", nameEn: "Grade 1", nameAr: "الأول", level: 1, offeredSubjects: [{ isActive: true, subject: { id: "s1", nameEn: "Mathematics", nameAr: "الرياضيات", icon: "calculator" } }] },
```

Do not touch the `where`-clause assertion on line 23 — the `where` is unchanged by this task, and that assertion is the Phase 10C data-contract test.

- [ ] **Step 2: Add the failing test**

Append inside the existing `describe`:

```ts
  it("a shared subject appears under the grade that offers it, with the existing response shape", async () => {
    const sharedArabic = { id: "subject-arabic-eg5", nameEn: "Arabic", nameAr: "اللغة العربية", icon: "language" };
    const { service } = makeService(() => [
      {
        id: "uk", code: "BRITISH_INTL", nameEn: "British", nameAr: "بريطاني", country: "GB",
        grades: [{
          id: "g-uk-6", nameEn: "Year 6", nameAr: "السنة ٦", level: 6,
          offeredSubjects: [
            { isActive: true, subject: sharedArabic },
            { isActive: true, subject: { id: "s-math", nameEn: "Mathematics", nameAr: "الرياضيات", icon: "calculator" } },
          ],
        }],
      },
    ]);

    const result = await service.getPublicCatalog();
    const grade = result[0].grades[0];

    expect(grade.subjects.map((s: any) => s.id)).toEqual([sharedArabic.id, "s-math"]);
    expect(grade).not.toHaveProperty("offeredSubjects");
  });

  it("the structure sample resolves its subject through the offering", async () => {
    // getStructureSample is the only other reader in this service; keep both
    // in one describe so a change to either query is caught here.
    const prisma = {
      client: {
        curriculum: {
          findFirst: jest.fn(async () => ({
            nameEn: "British", nameAr: "بريطاني",
            grades: [{
              nameEn: "Year 6", nameAr: "السنة ٦",
              offeredSubjects: [{
                subject: {
                  nameEn: "Arabic", nameAr: "اللغة العربية",
                  units: [{ nameEn: "Unit 1", nameAr: "الوحدة ١", topics: [] }],
                },
              }],
            }],
          })),
        },
      },
    };
    const service = new CurriculaService(prisma as any);

    const sample = await service.getStructureSample("BRITISH_INTL");

    expect(sample.subject).toEqual({ nameEn: "Arabic", nameAr: "اللغة العربية" });
    expect(sample.unit).toEqual({ nameEn: "Unit 1", nameAr: "الوحدة ١" });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd apps/backend
npx jest curricula/curricula.service.spec.ts
```

Expected: FAIL — `grade.subjects` is undefined, because the service still selects `subjects`.

- [ ] **Step 4: Rewrite the two queries**

In `apps/backend/src/curricula/curricula.service.ts`, replace the `grades` selection inside `getPublicCatalog` (lines 31-45) with:

```ts
        grades: {
          where: { isActive: true },
          orderBy: { level: "asc" },
          select: {
            id: true,
            nameEn: true,
            nameAr: true,
            level: true,
            // Availability is an OFFERING: a grade may offer a Subject whose
            // content home is another curriculum's grade (shared Arabic /
            // Social Studies). Mapped back to `subjects` below so the public
            // response shape is unchanged.
            offeredSubjects: {
              where: { isActive: true, subject: { isActive: true } },
              orderBy: { subject: { nameEn: "asc" } },
              select: { subject: { select: { id: true, nameEn: true, nameAr: true, icon: true } } },
            },
          },
        },
```

Change the method's opening so the query result is captured, and map it before returning:

```ts
  async getPublicCatalog() {
    const curricula = await this.prisma.client.curriculum.findMany({
      where: { isActive: true, grades: { some: { isActive: true } } },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        country: true,
        grades: {
          /* ...the block above... */
        },
      },
    });

    return curricula.map((curriculum) => ({
      ...curriculum,
      grades: curriculum.grades.map((grade) => {
        const { offeredSubjects, ...rest } = grade;
        return { ...rest, subjects: offeredSubjects.map((offering) => offering.subject) };
      }),
    }));
  }
```

In `getStructureSample`, replace the nested `subjects` block (lines 68-83) with:

```ts
            offeredSubjects: {
              where: { isActive: true, subject: { isActive: true } },
              orderBy: { subject: { nameEn: "asc" } },
              take: 1,
              select: {
                subject: {
                  select: {
                    nameEn: true,
                    nameAr: true,
                    units: {
                      take: 1,
                      orderBy: { order: "asc" },
                      include: { topics: { orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" } } } } },
                    },
                  },
                },
              },
            },
```

and replace:

```ts
    const subject = grade?.subjects[0];
```

with:

```ts
    const subject = grade?.offeredSubjects[0]?.subject;
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd apps/backend
npx jest curricula/curricula.service.spec.ts
```

Expected: PASS — the two new tests plus every pre-existing Phase 10C catalog test.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/curricula/curricula.service.ts apps/backend/src/curricula/curricula.service.spec.ts
git commit -m "feat(curricula): public catalog and structure sample read grade offerings"
```

---

### Task 10: Admin curriculum reads through offerings

The tree method is `getCurriculumStatus()` — it takes no arguments and walks every curriculum. The service has five constructor dependencies.

**Files:**
- Modify: `apps/backend/src/admin/curriculum/admin-curriculum.service.ts:279-288` and `:440-442`
- Test: `apps/backend/src/admin/curriculum/admin-curriculum.service.spec.ts` (create if absent)

**Interfaces:**
- Consumes: `findOfferedSubjects` from Task 4.
- Produces: `listSubjects` returns offered subjects; `getCurriculumStatus()` keeps `grades[].subjects[]` and adds `shared: boolean` per subject.

- [ ] **Step 1: Check whether the spec exists**

```bash
ls apps/backend/src/admin/curriculum/
grep -n "grade.subjects\|\.subjects\b" apps/backend/src/admin/curriculum/admin-curriculum.service.ts
```

The second command locates the single place that consumes `grade.subjects` when building the `getCurriculumStatus()` response — that is the consumer the new shape must be threaded through.

- [ ] **Step 2: Write the failing test**

Create `apps/backend/src/admin/curriculum/admin-curriculum.service.spec.ts` if it is absent, with this content (append the two tests if it already exists, reusing its existing harness):

```ts
import { AdminCurriculumService } from "./admin-curriculum.service";
import { findOfferedSubjects } from "../../common/grade-subject.util";

jest.mock("../../common/grade-subject.util", () => ({ findOfferedSubjects: jest.fn() }));

const SHARED = { id: "subject-arabic-eg5", nameEn: "Arabic", nameAr: "اللغة العربية", gradeId: "grade-eg-5", isActive: true };

function makeService(prisma: any) {
  return new AdminCurriculumService(prisma, {} as any, {} as any, {} as any, {} as any);
}

test("listSubjects returns the grade's offerings, not only its own subjects", async () => {
  (findOfferedSubjects as jest.Mock).mockResolvedValue([SHARED]);
  const prisma = { client: {} } as any;

  await expect(makeService(prisma).listSubjects("grade-uk-6")).resolves.toEqual([SHARED]);
  expect(findOfferedSubjects).toHaveBeenCalledWith(prisma.client, "grade-uk-6");
});

test("getCurriculumStatus flags a subject whose content home is a different grade", async () => {
  const prisma = {
    client: {
      curriculum: {
        findMany: jest.fn(async () => [
          {
            id: "c-uk", code: "BRITISH_INTL", nameEn: "British", nameAr: "بريطاني", isActive: true,
            grades: [{
              id: "grade-uk-6", nameEn: "Year 6", nameAr: "السنة ٦", level: 6, isActive: true,
              offeredSubjects: [{ isActive: true, subject: { ...SHARED, sourceFile: null, priceEGP: null, units: [] } }],
            }],
          },
        ]),
      },
    },
  } as any;

  const status = await makeService(prisma).getCurriculumStatus();
  const subject = status[0].grades[0].subjects[0];

  expect(subject).toMatchObject({ id: SHARED.id, shared: true });
  expect(status[0].grades[0]).not.toHaveProperty("offeredSubjects");
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd apps/backend
npx jest admin/curriculum/admin-curriculum.service.spec.ts
```

Expected: FAIL — `listSubjects` still calls `subject.findMany`, and the tree has no `shared` flag.

- [ ] **Step 4: Change the service**

In `apps/backend/src/admin/curriculum/admin-curriculum.service.ts`, add:

```ts
import { findOfferedSubjects } from "../../common/grade-subject.util";
```

Replace `listSubjects` (lines 440-442):

```ts
  listSubjects(gradeId: string) {
    return this.prisma.client.subject.findMany({ where: { gradeId } });
  }
```

with:

```ts
  listSubjects(gradeId: string) {
    // Includes shared subjects whose content home is another curriculum's
    // grade — the admin must see exactly what a student of this grade sees.
    return findOfferedSubjects(this.prisma.client, gradeId);
  }
```

In `getCurriculumStatus()`, replace the nested `subjects` block (lines 279-288) with:

```ts
            // `shared` is derived below: a subject whose content home
            // (subject.gradeId) is not this grade was authored elsewhere and
            // is merely offered here.
            offeredSubjects: {
              orderBy: { subject: { nameEn: "asc" } },
              select: {
                isActive: true,
                subject: {
                  select: {
                    id: true, nameEn: true, nameAr: true, isActive: true, sourceFile: true, priceEGP: true, gradeId: true,
                    units: {
                      orderBy: { order: "asc" },
                      select: {
                        id: true, nameEn: true, nameAr: true, order: true, sourcePageStart: true, sourcePageEnd: true,
                        sourceFileOverride: true, groundingNotesJson: true, groundingGeneratedAt: true, groundingVersion: true,
                        groundingModel: true, groundingPromptVersion: true,
                        topics: {
                          orderBy: { order: "asc" },
                          select: {
                            id: true, nameEn: true, nameAr: true, order: true, teachingStepsJson: true, generationSource: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
```

Then, at the single consumer of `grade.subjects` located in Step 1, replace its source with the mapped offering rows:

```ts
        const { offeredSubjects, ...gradeRest } = grade;
        return {
          ...gradeRest,
          subjects: offeredSubjects.map(({ isActive, subject }) => {
            const { units, ...subjectRest } = subject;
            return { ...subjectRest, isActive: isActive && subject.isActive, shared: subject.gradeId !== grade.id, units };
          }),
        };
```

Keep every other field the existing consumer produced (the derived status booleans from `deriveTopicStatus`, and so on) — this edit changes only where the subjects array comes from and adds the `shared` flag.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/backend
npx jest admin/curriculum/admin-curriculum.service.spec.ts
```

Expected: PASS — both tests.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/admin/curriculum/admin-curriculum.service.ts apps/backend/src/admin/curriculum/admin-curriculum.service.spec.ts
git commit -m "feat(admin): curriculum status and subject list read grade offerings"
```

---

### Task 11: Fix the dashboard's grade-scoped content filter

This is the one behavior change in the plan, and it lands here because with Task 2's backfill it is provably a no-op for today's data: every subject is still offered by its own home grade, so removing the extra grade clause cannot change which topics today's students see. What it fixes is the case Phase 2 creates — a student whose grade offers a subject authored under a different grade.

**Files:**
- Modify: `apps/backend/src/dashboard/dashboard.service.ts:64-81`
- Test: `apps/backend/src/dashboard/dashboard.service.spec.ts`

**Interfaces:**
- Consumes: `GradeSubject` availability (already the only availability rule by this point).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Extend the harness and add the failing regression test**

`makeService` in `apps/backend/src/dashboard/dashboard.service.spec.ts` currently builds its profile with a hard-coded `gradeId: "grade-1-eg"`. Extend its options so the regression case can use a British grade:

```ts
  function makeService(opts: {
    profile?: any;
    selectedSubjectIds?: string[];
    gradeId?: string;
  }) {
    const profile = "profile" in opts ? opts.profile : {
      /* ...unchanged... */
      gradeId: opts.gradeId ?? "grade-1-eg",
      /* ...unchanged... */
    };
```

Then append this test inside the describe block:

```ts
  // British Grade 1 owns no Arabic of its own: the Arabic Subject's content
  // home is grade-1-eg. Under the old `subject: { gradeId: profile.gradeId }`
  // clause this topic was filtered out and the student saw an empty Arabic
  // section — with no error anywhere.
  it("lists a shared subject's topics for a student whose grade merely offers it", async () => {
    (SUBJECTS as any)["subject-arabic-eg1"] = { gradeId: "grade-1-eg" };
    (UNITS as any)["unit-arabic-eg1"] = { subjectId: "subject-arabic-eg1" };
    ALL_TOPICS.push({
      id: "topic-arabic-eg1", unitId: "unit-arabic-eg1", nameEn: "Arabic Reading", order: 1,
      teachingStepsJson: [{ type: "INTRO" }],
    } as any);

    const { service } = makeService({ selectedSubjectIds: ["subject-arabic-eg1"], gradeId: "grade-1-uk" });
    const summary = await service.getSummary("user-1");

    expect(summary.pilotLessons.map((l: any) => l.topicId)).toContain("topic-arabic-eg1");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend
npx jest dashboard/dashboard.service.spec.ts
```

Expected: FAIL — the topic is filtered out by `subject: { gradeId: profile.gradeId }`.

- [ ] **Step 3: Change the service**

In `apps/backend/src/dashboard/dashboard.service.ts`, replace the comment block and query at lines 64-81 with:

```ts
    // Scoped strictly to the student's own selected subjects. Availability is
    // an OFFERING question (GradeSubject) — a shared subject's content home
    // may be a different curriculum's grade entirely, so this must NOT also
    // filter on `subject.gradeId`. Doing that returned an empty list with no
    // error for exactly the students the shared-subject work exists to serve.
    // `subjectIds` empty (no subjects selected yet) naturally yields zero
    // topics via `{ in: [] }` — fail-closed by construction, not by a special
    // case.
    //
    // Prisma's JSON-column null filters need the Prisma.JsonNull sentinel,
    // not a plain `null`, to distinguish SQL NULL from a JSON "null" value —
    // simplest to just filter in JS instead of fighting that at the query
    // level; cheap at this scale either way.
    const allTopics = await this.prisma.client.topic.findMany({
      where: { unit: { subjectId: { in: subjectIds } } },
      include: { unit: true },
      orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    });
```

Only the `subject: { gradeId: profile.gradeId }` clause and the sentence defending it are removed; the JSON-null comment is preserved.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/backend
npx jest dashboard/dashboard.service.spec.ts
```

Expected: PASS — the new regression test and every pre-existing Phase 10C scoping test.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/dashboard/dashboard.service.ts apps/backend/src/dashboard/dashboard.service.spec.ts
git commit -m "fix(dashboard): scope content by owned subjects, not the student's grade"
```

---

### Task 12: Guard the rule, then verify the whole plan

**Files:**
- Create: `apps/backend/src/common/content-scoping.guard.spec.ts`

**Interfaces:**
- Consumes: the source tree.
- Produces: a failing build if anyone re-introduces a content query scoped by the student's grade.

- [ ] **Step 1: Write the guard test**

Create `apps/backend/src/common/content-scoping.guard.spec.ts`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Learner context comes from StudentProfile.grade; CONTENT context comes from
 * subject.grade (the content home). Mixing them is the failure mode that makes
 * a shared subject silently render empty, so it is guarded structurally rather
 * than left to reviewer memory.
 *
 * Add a path to ALLOWED only with a written reason — every current service is
 * clean.
 */
const ALLOWED = new Set<string>([]);
const SRC = path.resolve(__dirname, "..");

test("no service scopes CONTENT by the student's own grade", () => {
  const offenders = (fs.readdirSync(SRC, { recursive: true }) as string[])
    .filter((relative) => relative.endsWith(".service.ts"))
    .filter((relative) => {
      if (ALLOWED.has(relative.replace(/\\/g, "/"))) return false;
      return /subject:\s*\{\s*gradeId:/.test(fs.readFileSync(path.join(SRC, relative), "utf8"));
    });

  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run it**

```bash
cd apps/backend
npx jest common/content-scoping.guard.spec.ts
```

Expected: PASS. If it fails, the named file still scopes content by the student's grade — fix it before continuing; do not add it to `ALLOWED`.

- [ ] **Step 3: Run the backend suite**

```bash
pnpm --filter @smartify/backend test
```

Expected: PASS. Any failure here is a call site depending on the old shape — fix the call site, not the test.

- [ ] **Step 4: Type check and lint**

```bash
pnpm --filter @smartify/backend exec tsc --noEmit
pnpm --filter @smartify/database exec tsc --noEmit
pnpm --filter @smartify/backend lint
```

Expected: no errors.

- [ ] **Step 5: Re-run the read-only PostgreSQL invariants**

```bash
pnpm --filter @smartify/backend exec jest --testPathIgnorePatterns=/node_modules/ --testPathPattern=grade-subject-invariants.postgres.spec.ts
```

Expected: PASS — the database still satisfies every invariant after all the code changes.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/common/content-scoping.guard.spec.ts
git commit -m "test(backend): guard learner-context vs content-context separation"
```

---

## Verifying the plan is complete

After Task 12, confirm all of this by hand. Each item maps to a spec section; Phase 2 is explicitly not covered here.

- [ ] **Spec Data model:** `GradeSubject` exists with `@@unique([gradeId, subjectId])`, both back-relations, and one offering per pre-existing subject (Task 2 plus Task 3's PostgreSQL test).
- [ ] **Spec Rules that must not drift:** enforced by the guard test (Task 12).
- [ ] **Spec Read path changes:** every row of that table is a task — onboarding (5), billing (6), referral (8), trial (7), `curricula.service.ts` (9), `admin-curriculum.service.ts` (10), `dashboard.service.ts` (11). `practice` / `quizzes` / `tutor` / `tutor-question-packs` / `parent` are verified unchanged and covered by the full suite (Task 12).
- [ ] **Spec Entitlement and pricing:** Phase 1 reads price from the content-home subject (Task 6) and stores content-home ids (unchanged code paths). Nothing else to do until Phase 2.
- [ ] **Spec Migration Phase 0:** Task 1.
- [ ] **Spec Migration Phase 1:** Tasks 2-11, with the dashboard fix (Task 11) landing where it is provably a no-op.
- [ ] **Spec Testing:** offering-validation tests (5-8), the dashboard regression (11), the context guard (12), invariant checks as both a fake-db spec and a real database spec (3).
- [ ] **Not in this plan, by design:** the reviewed mapping file, the `shared-subjects:link` script, entitlement re-pointing, duplicate withdrawal, the admin link/withdraw endpoints and the shared-subjects view, seed cleanup. All of that is Phase 2/4 and needs the Phase 0 report from Task 1.
