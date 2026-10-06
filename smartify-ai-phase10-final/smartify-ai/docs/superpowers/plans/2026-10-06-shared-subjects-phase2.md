# Shared Subjects Phase 2 Implementation Plan — link, withdraw, verify

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every non-Egyptian grade offer the Egyptian Arabic Language and Social Studies subjects that already exist and already carry content, withdraw the empty placeholder duplicates the seed created, and prove that a British student now sees the real Egyptian content.

**Architecture:** Nothing is copied and nothing is re-uploaded. A script reads the database, decides which grades should offer the existing Egyptian subjects, writes `GradeSubject` rows pointing at them, and deactivates the empty duplicates. `Subject.gradeId` (the content home) is never changed.

**Tech Stack:** TypeScript, Prisma 5 + PostgreSQL 18 (native Windows service, `localhost:5432`), Jest with hand-rolled in-memory Prisma mocks.

**Spec:** `docs/superpowers/specs/2026-10-06-shared-subjects-design.md`

**Requires:** `docs/superpowers/plans/2026-10-06-shared-subjects-phase1.md` complete — `GradeSubject` exists, every subject has a home offering, and every read site goes through `findOfferedSubjects` / `findOfferedSubject`.

## Scope of this plan

In scope: the reviewed mapping, the dry-run gate, the apply, the entitlement re-pointing, the seed cleanup, and end-to-end verification.

**Deferred to Phase 2b (not planned here):** the admin link/withdraw endpoints, the "shared subjects" admin view, and wiring the link script into the admin UI. The goal of this plan is that students see the content; admin convenience for editing the mapping afterwards is separable and must not gate that.

## What the database actually contains (measured 2026-10-06, local `smartify`)

This plan is written from real data, not from the spec's assumptions. Re-run Task 2's dry run before applying, and run Task 1's inventory script from the Phase 1 plan against production — this snapshot is the **local** database.

| Curriculum | Subject | Levels | Units | Topics | Entitlements | sourceFile |
| --- | --- | --- | --- | --- | --- | --- |
| `EG_NATIONAL` | Arabic Language | 1-6 | 3-4 | 12-28 | 0 | set (see the warning below) |
| `EG_NATIONAL` | Social Studies | 4-6 | 3 | 11-14 | 0 | set |
| `BRITISH_INTL` | Arabic | 1-6 | **0** | **0** | **0** | `(none)` |
| `BRITISH_INTL` | Social Studies | 4-6 | **0** | **0** | **0** | `(none)` |
| `AMERICAN_INTL` | — | none | — | — | — | no grades at all |
| `LOCAL` | — | none | — | — | — | no grades at all |

Note the naming: the Egyptian rows are `Arabic Language`, the seeded British placeholders are `Arabic`. **The two names must never be treated as interchangeable**, because `Social Studies` legitimately appears under both curricula with the identical name — so every identification below is by `(name, curriculum)`, never by name alone.

Three consequences that shape this plan:

1. **The non-Egyptian Arabic and Social Studies rows are empty placeholders** created by `seed.ts` (their grades are still named `[PLACEHOLDER] Grade N`), so withdrawing them destroys no content.
2. **No student holds any Arabic or Social Studies entitlement anywhere in this database.** The re-pointing step therefore moves zero rows here — but it is still written and tested, because production may differ and an unguarded version would silently drop a student's access.
3. `AMERICAN_INTL` and `LOCAL` have **no grades**, so there is nothing to link for them yet. The script reports that rather than failing.

## Global Constraints

- **The level mapping is decided: `British level N → Egyptian level N`, no offset** (2026-10-06 decision). It lives in one exported constant, `LEVEL_OFFSET = 0`, never inline arithmetic.
- **Content blocks; entitlements move.** A duplicate holding units or topics is never withdrawn and never linked over. A duplicate holding only entitlements is withdrawn **and** its entitlements are re-pointed to the reference subject; if any entitlement cannot be moved, the whole (grade, subject) pair is blocked instead.
- `Subject.gradeId` is the content home and is **never** modified by this plan.
- Never delete a `Subject`. Deactivate it (`isActive: false`).
- `StudentSubject` rows are never deleted **except** when deduplicating two rows for the same student and the same target subject — the one case the spec allows, and it is counted and reported per row.
- Every apply is idempotent and safe to re-run.
- Every apply is preceded by a dry run whose output is reviewed.
- `apps/backend/railway-postgres-vars.json` is untracked and must never be committed or printed.
- Run commands from the monorepo root `smartify-ai-phase10-final/smartify-ai`.

### Preconditions

```powershell
# Prisma needs DATABASE_URL exported explicitly — it exists only in apps/backend/.env.
$env:DATABASE_URL = ((Get-Content apps/backend/.env | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1) -replace '^\s*DATABASE_URL\s*=\s*','').Trim('"')

pnpm --filter @smartify/database exec prisma migrate status       # must be consistent
pnpm --filter @smartify/backend exec jest common/grade-subject.util.spec.ts   # Phase 1 landed
git status --short                                                # clean working tree
```

For the direct `psql` checks later in this plan, export the same credentials once. Note the **single-quoted** PowerShell strings — `psql` SQL needs literal double quotes around identifiers, and inside a single-quoted PowerShell string they need no escaping:

```powershell
$envFile = 'apps/backend/.env'
$url = ((Get-Content $envFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1) -replace '^\s*DATABASE_URL\s*=\s*','').Trim('"')
if ($url -match '^postgres(ql)?://([^:]+):([^@]*)@([^:/]+)(:(\d+))?/([^?]+)') {
  $env:PGUSER = $matches[2]; $env:PGPASSWORD = $matches[3]; $env:PGHOST = $matches[4]
  if ($matches[6]) { $env:PGPORT = $matches[6] } else { $env:PGPORT = '5432' }
  $env:PGDATABASE = $matches[7]
}
$env:PSQL = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
```

Never print `$env:PGPASSWORD`.

Do not run `prisma migrate dev` in this repository; it demands a reset on this database. See Task 0 of the Phase 1 plan.

## File structure

| File | Responsibility |
| --- | --- |
| `apps/backend/src/scripts/shared-subjects-map.ts` | Pure planning logic: turns a database snapshot into links, withdrawals, entitlement re-points, and blocked rows. No database access. |
| `apps/backend/src/scripts/shared-subjects-map.spec.ts` | Tests for that logic, including every blocking rule and the link-skipping rule |
| `apps/backend/src/scripts/shared-subjects-link.ts` | CLI: loads the snapshot, prints the dry run, or applies it inside one transaction and writes a report plus a reverse map |
| `apps/backend/src/scripts/shared-subjects-link.spec.ts` | Tests the apply path against a fake database, including entitlement collisions |
| `apps/backend/src/scripts/shared-subjects-verify.ts` | Post-apply read-only verification: invariants, grounding resolvability, offering presence |
| `apps/backend/src/scripts/shared-subjects-verify.spec.ts` | Tests the verification's judgements against fixtures |
| `packages/database/prisma/seed.ts` | Stop seeding non-Egyptian Arabic and Social Studies |

---

### Task 1: The mapping and the planning logic

**Files:**
- Create: `apps/backend/src/scripts/shared-subjects-map.ts`
- Test: `apps/backend/src/scripts/shared-subjects-map.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SHARED_SUBJECTS`, `SHARED_SUBJECT_NAMES`, `DUPLICATE_SUBJECT_NAMES`, `REFERENCE_CURRICULUM_CODE`, `TARGET_CURRICULUM_CODES`, `LEVEL_OFFSET`, the `Snapshot` / `SharedSubjectsPlan` types, and `planSharedSubjects(snapshot: Snapshot): SharedSubjectsPlan`. Tasks 2 and 3 consume all of them.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/scripts/shared-subjects-map.spec.ts`:

```ts
import { LEVEL_OFFSET, planSharedSubjects, type Snapshot } from "./shared-subjects-map";

/** Mirrors the measured local database: populated Egyptian subjects, empty British duplicates. */
function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    grades: [
      { id: "g-eg-2", level: 2, curriculumCode: "EG_NATIONAL" },
      { id: "g-eg-4", level: 4, curriculumCode: "EG_NATIONAL" },
      { id: "g-uk-2", level: 2, curriculumCode: "BRITISH_INTL" },
      { id: "g-uk-4", level: 4, curriculumCode: "BRITISH_INTL" },
    ],
    subjects: [
      { id: "s-eg-ar-2", nameEn: "Arabic Language", gradeId: "g-eg-2", isActive: true, unitCount: 4, topicCount: 19, entitlementCount: 0 },
      { id: "s-eg-ss-4", nameEn: "Social Studies", gradeId: "g-eg-4", isActive: true, unitCount: 3, topicCount: 14, entitlementCount: 0 },
      { id: "s-uk-ar-2", nameEn: "Arabic", gradeId: "g-uk-2", isActive: true, unitCount: 0, topicCount: 0, entitlementCount: 0 },
      { id: "s-uk-ss-4", nameEn: "Social Studies", gradeId: "g-uk-4", isActive: true, unitCount: 0, topicCount: 0, entitlementCount: 0 },
    ],
    offerings: [],
    entitlements: [],
    ...overrides,
  };
}

test("LEVEL_OFFSET is 0 — British level N maps to Egyptian level N", () => {
  expect(LEVEL_OFFSET).toBe(0);
});

test("links every target grade to the reference subject at the same level", () => {
  const plan = planSharedSubjects(snapshot());
  expect(plan.links).toEqual([
    { gradeId: "g-uk-2", subjectId: "s-eg-ar-2", curriculumCode: "BRITISH_INTL", level: 2, nameEn: "Arabic Language" },
    { gradeId: "g-uk-4", subjectId: "s-eg-ss-4", curriculumCode: "BRITISH_INTL", level: 4, nameEn: "Social Studies" },
  ]);
  expect(plan.blocked).toEqual([]);
});

test("withdraws an empty non-reference duplicate", () => {
  const plan = planSharedSubjects(snapshot());
  expect(plan.withdrawals).toEqual([
    { subjectId: "s-uk-ar-2", gradeId: "g-uk-2", nameEn: "Arabic", curriculumCode: "BRITISH_INTL", level: 2, reason: "EMPTY_DUPLICATE" },
    { subjectId: "s-uk-ss-4", gradeId: "g-uk-4", nameEn: "Social Studies", curriculumCode: "BRITISH_INTL", level: 4, reason: "EMPTY_DUPLICATE" },
  ]);
});

test("blocks a duplicate that carries content, and does not link over it", () => {
  const plan = planSharedSubjects(snapshot({
    subjects: snapshot().subjects.map((s) => (s.id === "s-uk-ar-2" ? { ...s, unitCount: 1, topicCount: 3 } : s)),
  }));
  expect(plan.withdrawals.map((w) => w.subjectId)).toEqual(["s-uk-ss-4"]);
  expect(plan.blocked).toEqual([
    { subjectId: "s-uk-ar-2", nameEn: "Arabic", curriculumCode: "BRITISH_INTL", level: 2, reason: "HAS_CONTENT", unitCount: 1, topicCount: 3, entitlementCount: 0 },
  ]);
  // Linking over a duplicate that cannot be withdrawn would show the student two
  // Arabics — one carrying the real content, one empty.
  expect(plan.links.map((l) => l.gradeId)).toEqual(["g-uk-4"]);
});

test("re-points a student's entitlement instead of blocking, because entitlements move with the withdrawal", () => {
  const plan = planSharedSubjects(snapshot({
    subjects: snapshot().subjects.map((s) => (s.id === "s-uk-ar-2" ? { ...s, entitlementCount: 1 } : s)),
    entitlements: [
      { studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: null, studentGradeLevel: 2, studentCurriculumCode: "BRITISH_INTL" },
    ],
  }));
  expect(plan.blocked).toEqual([]);
  expect(plan.entitlementRepoints).toEqual([
    { studentId: "st-1", fromSubjectId: "s-uk-ar-2", toSubjectId: "s-eg-ar-2" },
  ]);
  expect(plan.withdrawals.map((w) => w.subjectId)).toContain("s-uk-ar-2");
});

test("blocks instead of withdrawing when an entitlement cannot be moved to a reference subject", () => {
  const plan = planSharedSubjects(snapshot({
    subjects: snapshot().subjects.map((s) => (s.id === "s-uk-ar-2" ? { ...s, entitlementCount: 1 } : s)),
    // The student's own level has no Egyptian Arabic, so there is nothing to move the grant to.
    entitlements: [
      { studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: null, studentGradeLevel: 6, studentCurriculumCode: "BRITISH_INTL" },
    ],
  }));
  expect(plan.blocked.map((b) => b.reason)).toEqual(["CANNOT_REPOINT"]);
  expect(plan.withdrawals.map((w) => w.subjectId)).not.toContain("s-uk-ar-2");
  expect(plan.entitlementRepoints).toEqual([]);
  expect(plan.links.map((l) => l.gradeId)).not.toContain("g-uk-2");
});

test("is idempotent: an existing offering produces no duplicate link", () => {
  const plan = planSharedSubjects(snapshot({
    offerings: [{ gradeId: "g-uk-2", subjectId: "s-eg-ar-2", isActive: true }],
  }));
  expect(plan.links.map((l) => l.gradeId)).toEqual(["g-uk-4"]);
  expect(plan.withdrawals.map((w) => w.subjectId)).toContain("s-uk-ar-2");
});

test("reports a target curriculum that has no grades rather than failing", () => {
  const plan = planSharedSubjects(snapshot({
    grades: snapshot().grades.filter((g) => g.curriculumCode !== "BRITISH_INTL"),
  }));
  expect(plan.links).toEqual([]);
  expect(plan.notes).toEqual([
    { code: "NO_GRADES", curriculumCode: "BRITISH_INTL" },
    { code: "NO_GRADES", curriculumCode: "AMERICAN_INTL" },
    { code: "NO_GRADES", curriculumCode: "LOCAL" },
  ]);
});

test("notes a level with no reference subject and leaves that grade's duplicate alone", () => {
  const plan = planSharedSubjects(snapshot());
  // British level 2 has no Egyptian Social Studies, and British level 4 has no Egyptian Arabic.
  expect(plan.notes).toEqual([
    { code: "NO_REFERENCE_SUBJECT", curriculumCode: "BRITISH_INTL", level: 2 },
    { code: "NO_REFERENCE_SUBJECT", curriculumCode: "BRITISH_INTL", level: 4 },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend
npx jest scripts/shared-subjects-map.spec.ts
```

Expected: FAIL — `Cannot find module './shared-subjects-map'`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/scripts/shared-subjects-map.ts`:

```ts
/**
 * Shared subjects Phase 2 (2026-10-06) — pure planning logic, no database
 * access, so every rule below is testable without a connection.
 *
 * Nothing is copied. The Egyptian Arabic Language / Social Studies subjects
 * keep their content, their price, and their textbook mapping; this module
 * only decides which other grades should OFFER them, which duplicates of them
 * must be withdrawn, and where a student's entitlement moves when one is.
 */
export const SHARED_SUBJECTS = [
  // canonical = the Egyptian subject's name (its content home).
  // aliases   = every name a duplicate of it has been known to carry. The
  //             seeded non-Egyptian placeholders say "Arabic", the Egyptian
  //             row says "Arabic Language"; "Social Studies" is identical in
  //             both, which is exactly why identification is by
  //             (name, curriculum) and never by name alone.
  { canonical: "Arabic Language", aliases: ["Arabic Language", "Arabic"] },
  { canonical: "Social Studies", aliases: ["Social Studies"] },
] as const;

export const SHARED_SUBJECT_NAMES: string[] = SHARED_SUBJECTS.map((s) => s.canonical);
export const DUPLICATE_SUBJECT_NAMES: string[] = [...new Set(SHARED_SUBJECTS.flatMap((s) => [...s.aliases]))];
export const REFERENCE_CURRICULUM_CODE = "EG_NATIONAL";
export const TARGET_CURRICULUM_CODES = ["BRITISH_INTL", "AMERICAN_INTL", "LOCAL"] as const;

/**
 * British level N ↔ Egyptian level N (2026-10-06 decision). The seeded British
 * grades are still `[PLACEHOLDER] Grade N`, so this is a product decision, not
 * a derived one — it lives here, in one place, asserted by a test.
 */
export const LEVEL_OFFSET = 0;

export type Snapshot = {
  grades: Array<{ id: string; level: number; curriculumCode: string }>;
  subjects: Array<{
    id: string;
    nameEn: string;
    gradeId: string;
    isActive: boolean;
    unitCount: number;
    topicCount: number;
    entitlementCount: number;
  }>;
  offerings: Array<{ gradeId: string; subjectId: string; isActive: boolean }>;
  entitlements: Array<{
    studentId: string;
    subjectId: string;
    expiresAt: Date | null;
    studentGradeLevel: number;
    studentCurriculumCode: string;
  }>;
};

export type Link = { gradeId: string; subjectId: string; curriculumCode: string; level: number; nameEn: string };
export type Withdrawal = {
  subjectId: string;
  gradeId: string;
  nameEn: string;
  curriculumCode: string;
  level: number;
  reason: "EMPTY_DUPLICATE";
};
export type Blocked = {
  subjectId: string;
  nameEn: string;
  curriculumCode: string;
  level: number;
  reason: "HAS_CONTENT" | "CANNOT_REPOINT";
  unitCount: number;
  topicCount: number;
  entitlementCount: number;
};
export type EntitlementRepoint = { studentId: string; fromSubjectId: string; toSubjectId: string };

export type SharedSubjectsPlan = {
  links: Link[];
  withdrawals: Withdrawal[];
  blocked: Blocked[];
  entitlementRepoints: EntitlementRepoint[];
  notes: Array<{ code: "NO_GRADES" | "NO_REFERENCE_SUBJECT"; curriculumCode: string; level?: number }>;
};

const key = (level: number, nameEn: string) => `${level}\u0000${nameEn}`;

export function planSharedSubjects(snapshot: Snapshot): SharedSubjectsPlan {
  const gradeById = new Map(snapshot.grades.map((g) => [g.id, g]));
  const plan: SharedSubjectsPlan = { links: [], withdrawals: [], blocked: [], entitlementRepoints: [], notes: [] };

  // Canonical subjects, keyed by (reference level, canonical name).
  const referenceByLevelAndName = new Map<string, string>();
  for (const subject of snapshot.subjects) {
    const grade = gradeById.get(subject.gradeId);
    if (!grade || grade.curriculumCode !== REFERENCE_CURRICULUM_CODE || !subject.isActive) continue;
    if (!SHARED_SUBJECT_NAMES.includes(subject.nameEn)) continue;
    referenceByLevelAndName.set(key(grade.level, subject.nameEn), subject.id);
  }

  const offered = new Set(snapshot.offerings.filter((o) => o.isActive).map((o) => `${o.gradeId}\u0000${o.subjectId}`));

  for (const curriculumCode of TARGET_CURRICULUM_CODES) {
    const grades = snapshot.grades.filter((g) => g.curriculumCode === curriculumCode);
    if (grades.length === 0) {
      plan.notes.push({ code: "NO_GRADES", curriculumCode });
      continue;
    }

    for (const grade of grades) {
      const targetLevel = grade.level + LEVEL_OFFSET;
      // Only this grade's own subjects can be duplicates of a shared subject —
      // the reference rows live under the reference curriculum and are never
      // in this list.
      const activeHere = snapshot.subjects.filter((s) => s.gradeId === grade.id && s.isActive);

      for (const shared of SHARED_SUBJECTS) {
        const referenceSubjectId = referenceByLevelAndName.get(key(targetLevel, shared.canonical));
        if (!referenceSubjectId) {
          plan.notes.push({ code: "NO_REFERENCE_SUBJECT", curriculumCode, level: targetLevel });
          continue;
        }

        const duplicate = activeHere.find((s) => (shared.aliases as readonly string[]).includes(s.nameEn));
        const blockedBase = {
          subjectId: duplicate?.id ?? referenceSubjectId,
          nameEn: duplicate?.nameEn ?? shared.canonical,
          curriculumCode,
          level: grade.level,
          unitCount: duplicate?.unitCount ?? 0,
          topicCount: duplicate?.topicCount ?? 0,
          entitlementCount: duplicate?.entitlementCount ?? 0,
        };

        if (duplicate && (duplicate.unitCount > 0 || duplicate.topicCount > 0)) {
          plan.blocked.push({ ...blockedBase, reason: "HAS_CONTENT" });
          continue;
        }

        // Entitlements on a withdrawable duplicate must all be movable, or the
        // withdrawal would silently drop a student's access.
        const repoints: EntitlementRepoint[] = [];
        if (duplicate) {
          let cannotRepoint = false;
          for (const entitlement of snapshot.entitlements.filter((e) => e.subjectId === duplicate.id)) {
            const destination = referenceByLevelAndName.get(key(entitlement.studentGradeLevel + LEVEL_OFFSET, shared.canonical));
            if (!destination) {
              cannotRepoint = true;
              break;
            }
            repoints.push({ studentId: entitlement.studentId, fromSubjectId: duplicate.id, toSubjectId: destination });
          }
          if (cannotRepoint) {
            plan.blocked.push({ ...blockedBase, reason: "CANNOT_REPOINT" });
            continue;
          }
        }

        if (!offered.has(`${grade.id}\u0000${referenceSubjectId}`)) {
          plan.links.push({ gradeId: grade.id, subjectId: referenceSubjectId, curriculumCode, level: grade.level, nameEn: shared.canonical });
        }
        if (duplicate) {
          plan.withdrawals.push({
            subjectId: duplicate.id, gradeId: grade.id, nameEn: duplicate.nameEn,
            curriculumCode, level: grade.level, reason: "EMPTY_DUPLICATE",
          });
          plan.entitlementRepoints.push(...repoints);
        }
      }
    }
  }

  return plan;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/backend
npx jest scripts/shared-subjects-map.spec.ts
```

Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/scripts/shared-subjects-map.ts apps/backend/src/scripts/shared-subjects-map.spec.ts
git commit -m "feat(scripts): pure shared-subject linking and withdrawal planning"
```

---

### Task 2: The link script — dry run, apply, report, reverse map

**Files:**
- Create: `apps/backend/src/scripts/shared-subjects-link.ts`
- Test: `apps/backend/src/scripts/shared-subjects-link.spec.ts`

**Interfaces:**
- Consumes: everything Task 1 exports.
- Produces: `loadSnapshot(db)`, `renderDryRun(plan)`, `applyPlan(db, plan)` (refuses while anything is blocked), `reverseMapFor(plan)`, and a CLI accepting `--dry-run` (default) and `--apply`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/scripts/shared-subjects-link.spec.ts`:

```ts
import { applyPlan, loadSnapshot, renderDryRun } from "./shared-subjects-link";
import { planSharedSubjects, type Snapshot } from "./shared-subjects-map";

type State = { offerings: any[]; subjects: any[]; entitlements: any[] };

function fakeDb(state: State) {
  const tx = {
    gradeSubject: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const exists = state.offerings.find(
          (o) => o.gradeId === where.gradeId_subjectId.gradeId && o.subjectId === where.gradeId_subjectId.subjectId,
        );
        if (exists) {
          exists.isActive = true;
          return exists;
        }
        const row = { id: `off-${create.gradeId}-${create.subjectId}`, ...create, isActive: true };
        state.offerings.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const o of state.offerings) {
          if (o.gradeId === where.gradeId && o.subjectId === where.subjectId) {
            o.isActive = data.isActive;
            count += 1;
          }
        }
        return { count };
      }),
      findMany: jest.fn(async () => state.offerings),
    },
    subject: {
      update: jest.fn(async ({ where, data }: any) => {
        const s = state.subjects.find((x) => x.id === where.id)!;
        Object.assign(s, data);
        return s;
      }),
    },
    studentSubject: {
      findUnique: jest.fn(async ({ where }: any) =>
        state.entitlements.find(
          (e) => e.studentId === where.studentId_subjectId.studentId && e.subjectId === where.studentId_subjectId.subjectId,
        ) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const e = state.entitlements.find(
          (x) => x.studentId === where.studentId_subjectId.studentId && x.subjectId === where.studentId_subjectId.subjectId,
        )!;
        if (data.subjectId) e.subjectId = data.subjectId;
        if ("expiresAt" in data) e.expiresAt = data.expiresAt;
        return e;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const i = state.entitlements.findIndex(
          (x) => x.studentId === where.studentId_subjectId.studentId && x.subjectId === where.studentId_subjectId.subjectId,
        );
        return state.entitlements.splice(i, 1)[0];
      }),
    },
  };
  return { client: tx, $transaction: (fn: any) => fn(tx) } as any;
}

const SNAPSHOT: Snapshot = {
  grades: [
    { id: "g-eg-2", level: 2, curriculumCode: "EG_NATIONAL" },
    { id: "g-uk-2", level: 2, curriculumCode: "BRITISH_INTL" },
  ],
  subjects: [
    { id: "s-eg-ar-2", nameEn: "Arabic Language", gradeId: "g-eg-2", isActive: true, unitCount: 4, topicCount: 19, entitlementCount: 0 },
    { id: "s-uk-ar-2", nameEn: "Arabic", gradeId: "g-uk-2", isActive: true, unitCount: 0, topicCount: 0, entitlementCount: 0 },
  ],
  offerings: [],
  entitlements: [],
};

/** Mirrors the real database after Phase 1's backfill: every subject has a home offering. */
function initialState(subjects: Snapshot["subjects"]): State {
  return {
    offerings: [
      { id: "off-g-eg-2-s-eg-ar-2", gradeId: "g-eg-2", subjectId: "s-eg-ar-2", isActive: true },
      { id: "off-g-uk-2-s-uk-ar-2", gradeId: "g-uk-2", subjectId: "s-uk-ar-2", isActive: true },
    ],
    subjects: JSON.parse(JSON.stringify(subjects)),
    entitlements: [],
  };
}

test("dry run reports what would change and never writes", async () => {
  const state = initialState(SNAPSHOT.subjects);
  const db = fakeDb(state);

  const text = renderDryRun(planSharedSubjects(SNAPSHOT));

  expect(text).toContain("links: 1");
  expect(text).toContain("withdrawals: 1");
  expect(text).toContain("blocked: 0");
  expect(db.client.gradeSubject.upsert).not.toHaveBeenCalled();
  expect(state.subjects.find((s: any) => s.id === "s-uk-ar-2").isActive).toBe(true);
});

test("apply links the offering, deactivates the empty duplicate, and is idempotent", async () => {
  const state = initialState(SNAPSHOT.subjects);
  const db = fakeDb(state);
  const plan = planSharedSubjects(SNAPSHOT);

  const first = await applyPlan(db, plan);
  expect(first.offeringsCreated).toBe(1);
  expect(first.offeringsDeactivated).toBe(1);
  expect(first.subjectsDeactivated).toBe(1);
  expect(state.offerings.find((o: any) => o.subjectId === "s-uk-ar-2").isActive).toBe(false);
  expect(state.offerings.filter((o: any) => o.subjectId === "s-eg-ar-2" && o.isActive)).toHaveLength(1);
  expect(state.subjects.find((s: any) => s.id === "s-uk-ar-2").isActive).toBe(false);

  // Re-running the same plan must not create a second offering.
  const second = await applyPlan(db, planSharedSubjects({ ...SNAPSHOT, offerings: state.offerings as any }));
  expect(second.offeringsCreated).toBe(0);
  expect(state.offerings.filter((o: any) => o.subjectId === "s-eg-ar-2")).toHaveLength(1);
});

test("apply refuses to run at all while anything is blocked", async () => {
  const blockedSubjects = SNAPSHOT.subjects.map((s) => (s.id === "s-uk-ar-2" ? { ...s, unitCount: 2 } : s));
  const blockedSnapshot: Snapshot = { ...SNAPSHOT, subjects: blockedSubjects };
  const state = initialState(blockedSubjects);
  const db = fakeDb(state);

  await expect(applyPlan(db, planSharedSubjects(blockedSnapshot))).rejects.toThrow(/blocked/i);
  expect(db.client.gradeSubject.upsert).not.toHaveBeenCalled();
});

test("a collision keeps the more permissive entitlement and removes the redundant row", async () => {
  const snapshot: Snapshot = {
    ...SNAPSHOT,
    entitlements: [
      { studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: new Date("2026-11-01T00:00:00Z"), studentGradeLevel: 2, studentCurriculumCode: "BRITISH_INTL" },
    ],
  };
  const state = initialState(snapshot.subjects);
  state.entitlements = [
    { studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: new Date("2026-11-01T00:00:00Z") },
    { studentId: "st-1", subjectId: "s-eg-ar-2", expiresAt: null },
  ];
  const db = fakeDb(state);

  const result = await applyPlan(db, planSharedSubjects(snapshot));

  expect(result.entitlementsRepointed).toBe(0);
  expect(result.entitlementsDeduplicated).toBe(1);
  expect(state.entitlements).toEqual([{ studentId: "st-1", subjectId: "s-eg-ar-2", expiresAt: null }]);
});

test("a non-colliding entitlement is moved, not duplicated", async () => {
  const snapshot: Snapshot = {
    ...SNAPSHOT,
    entitlements: [
      { studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: null, studentGradeLevel: 2, studentCurriculumCode: "BRITISH_INTL" },
    ],
  };
  const state = initialState(snapshot.subjects);
  state.entitlements = [{ studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: null }];
  const db = fakeDb(state);

  const result = await applyPlan(db, planSharedSubjects(snapshot));

  expect(result.entitlementsRepointed).toBe(1);
  expect(result.entitlementsDeduplicated).toBe(0);
  expect(state.entitlements).toEqual([{ studentId: "st-1", subjectId: "s-eg-ar-2", expiresAt: null }]);
});

test("loadSnapshot reads counts and student levels into the shape the planner understands", async () => {
  const db = {
    grade: { findMany: jest.fn(async () => [
      { id: "g-eg-2", level: 2, curriculum: { code: "EG_NATIONAL" } },
      { id: "g-uk-2", level: 2, curriculum: { code: "BRITISH_INTL" } },
    ]) },
    subject: { findMany: jest.fn(async () => [
      { id: "s-eg-ar-2", nameEn: "Arabic Language", gradeId: "g-eg-2", isActive: true, _count: { studentSubjects: 0 }, units: [{ _count: { topics: 19 } }] },
      { id: "s-uk-ar-2", nameEn: "Arabic", gradeId: "g-uk-2", isActive: true, _count: { studentSubjects: 0 }, units: [] },
    ]) },
    gradeSubject: { findMany: jest.fn(async () => []) },
    studentSubject: { findMany: jest.fn(async () => [
      { studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: null, student: { grade: { level: 2, curriculum: { code: "BRITISH_INTL" } } } },
    ]) },
  } as any;

  const snapshot = await loadSnapshot(db);

  expect(snapshot.grades).toEqual([
    { id: "g-eg-2", level: 2, curriculumCode: "EG_NATIONAL" },
    { id: "g-uk-2", level: 2, curriculumCode: "BRITISH_INTL" },
  ]);
  expect(snapshot.subjects).toEqual([
    { id: "s-eg-ar-2", nameEn: "Arabic Language", gradeId: "g-eg-2", isActive: true, unitCount: 1, topicCount: 19, entitlementCount: 0 },
    { id: "s-uk-ar-2", nameEn: "Arabic", gradeId: "g-uk-2", isActive: true, unitCount: 0, topicCount: 0, entitlementCount: 0 },
  ]);
  expect(snapshot.entitlements).toEqual([
    { studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: null, studentGradeLevel: 2, studentCurriculumCode: "BRITISH_INTL" },
  ]);
});

test("subject identification uses (name, curriculum), never name alone", async () => {
  // "Social Studies" exists under BOTH curricula with the identical name, so the
  // query must separate the reference rows from the duplicates by curriculum.
  const db = {
    grade: { findMany: jest.fn(async () => []) },
    subject: { findMany: jest.fn(async ({ where }: any) => {
      expect(where.OR).toEqual([
        { nameEn: { in: ["Arabic Language", "Social Studies"] }, grade: { curriculum: { code: "EG_NATIONAL" } } },
        { nameEn: { in: ["Arabic Language", "Arabic", "Social Studies"] }, grade: { curriculum: { code: { not: "EG_NATIONAL" } } } },
      ]);
      return [];
    }) },
    gradeSubject: { findMany: jest.fn(async () => []) },
    studentSubject: { findMany: jest.fn(async () => []) },
  } as any;

  await loadSnapshot(db);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend
npx jest scripts/shared-subjects-link.spec.ts
```

Expected: FAIL — `Cannot find module './shared-subjects-link'`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/scripts/shared-subjects-link.ts`:

```ts
// Shared subjects Phase 2 (2026-10-06). Dry run by default; --apply writes.
//
// Links non-Egyptian grades to the Egyptian Arabic Language / Social Studies
// subjects that already exist and already carry content, and withdraws the
// empty placeholder duplicates the seed created. Nothing is copied: the
// reference subjects keep their units, topics, price, and textbook mapping.
import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "@smartify/database";
import {
  DUPLICATE_SUBJECT_NAMES,
  LEVEL_OFFSET,
  REFERENCE_CURRICULUM_CODE,
  SHARED_SUBJECT_NAMES,
  planSharedSubjects,
  type SharedSubjectsPlan,
  type Snapshot,
} from "./shared-subjects-map";

export async function loadSnapshot(db: PrismaClient): Promise<Snapshot> {
  const grades = await db.grade.findMany({ select: { id: true, level: true, curriculum: { select: { code: true } } } });

  const subjects = await db.subject.findMany({
    where: {
      OR: [
        { nameEn: { in: SHARED_SUBJECT_NAMES }, grade: { curriculum: { code: REFERENCE_CURRICULUM_CODE } } },
        { nameEn: { in: DUPLICATE_SUBJECT_NAMES }, grade: { curriculum: { code: { not: REFERENCE_CURRICULUM_CODE } } } },
      ],
    },
    select: {
      id: true,
      nameEn: true,
      gradeId: true,
      isActive: true,
      _count: { select: { studentSubjects: true } },
      units: { select: { _count: { select: { topics: true } } } },
    },
  });

  const offerings = await db.gradeSubject.findMany({ select: { gradeId: true, subjectId: true, isActive: true } });

  const entitlements = await db.studentSubject.findMany({
    select: {
      studentId: true,
      subjectId: true,
      expiresAt: true,
      student: { select: { grade: { select: { level: true, curriculum: { select: { code: true } } } } } },
    },
  });

  return {
    grades: grades.map((g) => ({ id: g.id, level: g.level, curriculumCode: g.curriculum.code })),
    subjects: subjects.map((s) => ({
      id: s.id,
      nameEn: s.nameEn,
      gradeId: s.gradeId,
      isActive: s.isActive,
      unitCount: s.units.length,
      topicCount: s.units.reduce((n, u) => n + u._count.topics, 0),
      entitlementCount: s._count.studentSubjects,
    })),
    offerings,
    entitlements: entitlements.map((e) => ({
      studentId: e.studentId,
      subjectId: e.subjectId,
      expiresAt: e.expiresAt,
      studentGradeLevel: e.student.grade.level,
      studentCurriculumCode: e.student.grade.curriculum.code,
    })),
  };
}

export function renderDryRun(plan: SharedSubjectsPlan): string {
  const lines: string[] = [
    `level offset: ${LEVEL_OFFSET} (target level N -> reference level N + ${LEVEL_OFFSET})`,
    `links: ${plan.links.length}`,
    `withdrawals: ${plan.withdrawals.length}`,
    `entitlementRepoints: ${plan.entitlementRepoints.length}`,
    `blocked: ${plan.blocked.length}`,
    "",
  ];
  for (const link of plan.links) lines.push(`LINK       ${link.curriculumCode} level ${link.level} -> ${link.subjectId} (${link.nameEn})`);
  for (const w of plan.withdrawals) lines.push(`WITHDRAW   ${w.curriculumCode} level ${w.level} ${w.nameEn} (${w.subjectId}) — ${w.reason}`);
  for (const r of plan.entitlementRepoints) lines.push(`REPOINT    student ${r.studentId}: ${r.fromSubjectId} -> ${r.toSubjectId}`);
  for (const b of plan.blocked) {
    lines.push(`BLOCKED    ${b.curriculumCode} level ${b.level} ${b.nameEn} (${b.subjectId}) — ${b.reason} units=${b.unitCount} topics=${b.topicCount} entitlements=${b.entitlementCount}`);
  }
  for (const n of plan.notes) lines.push(`NOTE       ${n.code} ${n.curriculumCode}${n.level === undefined ? "" : ` level ${n.level}`}`);
  return lines.join("\n");
}

export type ApplyResult = {
  offeringsCreated: number;
  offeringsDeactivated: number;
  subjectsDeactivated: number;
  entitlementsRepointed: number;
  entitlementsDeduplicated: number;
  appliedAt: string;
};

export async function applyPlan(db: PrismaClient, plan: SharedSubjectsPlan): Promise<ApplyResult> {
  if (plan.blocked.length > 0) {
    throw new Error(
      `Refusing to apply: ${plan.blocked.length} row(s) are blocked and need a human decision — ${plan.blocked
        .map((b) => `${b.nameEn}@${b.curriculumCode}/${b.level}:${b.reason}`)
        .join(", ")}`,
    );
  }

  const result: ApplyResult = {
    // The planner only emits a link for a pair that is not already offered, so
    // the link count IS the number of offerings this run creates.
    offeringsCreated: plan.links.length,
    offeringsDeactivated: 0,
    subjectsDeactivated: 0,
    entitlementsRepointed: 0,
    entitlementsDeduplicated: 0,
    appliedAt: new Date().toISOString(),
  };

  await db.$transaction(async (tx) => {
    for (const link of plan.links) {
      await tx.gradeSubject.upsert({
        where: { gradeId_subjectId: { gradeId: link.gradeId, subjectId: link.subjectId } },
        update: { isActive: true },
        create: { gradeId: link.gradeId, subjectId: link.subjectId },
      });
    }

    // Entitlements move BEFORE any duplicate is withdrawn, so a student is never
    // left without access at any point inside the transaction.
    for (const repoint of plan.entitlementRepoints) {
      const target = await tx.studentSubject.findUnique({
        where: { studentId_subjectId: { studentId: repoint.studentId, subjectId: repoint.toSubjectId } },
      });
      const moving = await tx.studentSubject.findUnique({
        where: { studentId_subjectId: { studentId: repoint.studentId, subjectId: repoint.fromSubjectId } },
      });
      if (!moving) continue;

      if (!target) {
        await tx.studentSubject.update({
          where: { studentId_subjectId: { studentId: repoint.studentId, subjectId: repoint.fromSubjectId } },
          data: { subjectId: repoint.toSubjectId },
        });
        result.entitlementsRepointed += 1;
        continue;
      }

      // Two rows for the same student and the same target subject. Keep the more
      // permissive grant: a permanent one (expiresAt null) beats any dated one,
      // otherwise the later expiry wins. Removing the redundant row is a DEDUPE
      // of two rows describing one entitlement — the single case where
      // StudentSubject deletion is allowed — and it is counted and reported.
      const keepExpiresAt =
        target.expiresAt == null || moving.expiresAt == null
          ? null
          : target.expiresAt > moving.expiresAt
            ? target.expiresAt
            : moving.expiresAt;
      await tx.studentSubject.update({
        where: { studentId_subjectId: { studentId: repoint.studentId, subjectId: repoint.toSubjectId } },
        data: { expiresAt: keepExpiresAt },
      });
      await tx.studentSubject.delete({
        where: { studentId_subjectId: { studentId: repoint.studentId, subjectId: repoint.fromSubjectId } },
      });
      result.entitlementsDeduplicated += 1;
    }

    for (const withdrawal of plan.withdrawals) {
      const deactivated = await tx.gradeSubject.updateMany({
        where: { gradeId: withdrawal.gradeId, subjectId: withdrawal.subjectId },
        data: { isActive: false },
      });
      result.offeringsDeactivated += deactivated.count;
      await tx.subject.update({ where: { id: withdrawal.subjectId }, data: { isActive: false } });
      result.subjectsDeactivated += 1;
    }
  });

  return result;
}

export function reverseMapFor(plan: SharedSubjectsPlan) {
  return {
    undo: {
      links: plan.links.map((l) => ({ gradeId: l.gradeId, subjectId: l.subjectId })),
      withdrawals: plan.withdrawals.map((w) => ({ gradeId: w.gradeId, subjectId: w.subjectId })),
      entitlementRepoints: plan.entitlementRepoints.map((r) => ({
        studentId: r.studentId,
        fromSubjectId: r.fromSubjectId,
        toSubjectId: r.toSubjectId,
      })),
    },
    notes: [
      "links: set GradeSubject.isActive false (or delete the row) to stop offering the subject",
      "withdrawals: set GradeSubject.isActive true and Subject.isActive true to restore the duplicate",
      "entitlementRepoints: move StudentSubject rows back from toSubjectId to fromSubjectId",
    ],
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = new PrismaClient();
  try {
    const snapshot = await loadSnapshot(db);
    const plan = planSharedSubjects(snapshot);
    process.stdout.write(`${renderDryRun(plan)}\n`);

    if (!apply) {
      process.stdout.write("\nDRY RUN — nothing was written. Re-run with --apply after reviewing the above.\n");
      return;
    }
    if (plan.blocked.length > 0) {
      process.stdout.write("\nRefusing to apply while rows are blocked. Resolve them first.\n");
      process.exitCode = 1;
      return;
    }

    const result = await applyPlan(db, plan);
    const stamp = result.appliedAt.replace(/[:.]/g, "-");
    const outDir = path.resolve(__dirname, "../../../../../docs");
    fs.writeFileSync(path.join(outDir, `shared-subjects-apply-report-${stamp}.json`), `${JSON.stringify({ result, plan }, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, `shared-subjects-reverse-map-${stamp}.json`), `${JSON.stringify(reverseMapFor(plan), null, 2)}\n`);
    process.stdout.write(`\nAPPLIED ${JSON.stringify(result)}\n`);
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

The report path walks up from `apps/backend/dist/scripts/` to the project root's `docs/`, matching how the other scripts in this repo place their artifacts alongside `docs/core-textbook-*.json`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/backend
npx jest scripts/shared-subjects-link.spec.ts
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Run the dry run against the real database and review it**

```powershell
pnpm --filter @smartify/backend build
cd apps/backend && node dist/scripts/shared-subjects-link.js
```

Expected, based on the measured snapshot: **9 LINK lines** (BRITISH_INTL levels 1-6 Arabic Language, levels 4-6 Social Studies), **9 WITHDRAW lines** for the empty British duplicates, **entitlementRepoints: 0**, **blocked: 0**, and `NOTE NO_GRADES AMERICAN_INTL` plus `NOTE NO_GRADES LOCAL`.

If `blocked` is not 0, or the entitlement count differs from the measured snapshot, **stop and bring the output back for review** — do not run `--apply`.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/scripts/shared-subjects-link.ts apps/backend/src/scripts/shared-subjects-link.spec.ts
git commit -m "feat(scripts): dry-run-first shared-subject linker with report and reverse map"
```

---

### Task 3: Apply the plan

**Files:** none — this task runs the already-tested script and verifies the result.

**Interfaces:**
- Consumes: `shared-subjects-link.js` from Task 2, plus the `psql` credentials from Preconditions.
- Produces: `docs/shared-subjects-apply-report-<timestamp>.json` and a matching reverse map, committed.

- [ ] **Step 1: Back up the database first**

```bash
pnpm db:backup
```

Expected: a backup artifact is produced. Do not continue if this fails.

- [ ] **Step 2: Apply**

```powershell
cd apps/backend && node dist/scripts/shared-subjects-link.js --apply
```

Expected: `APPLIED {...}` with `"offeringsCreated":9, "offeringsDeactivated":9, "subjectsDeactivated":9, "entitlementsRepointed":0, "entitlementsDeduplicated":0`.

- [ ] **Step 3: Confirm the written state directly, not from the script's own output**

```powershell
& $env:PSQL -X -P pager=off -c 'SELECT c.code, g.level, s."nameEn", s."isActive" AS subject_active, gs."isActive" AS offering_active FROM "GradeSubject" gs JOIN "Grade" g ON g.id = gs."gradeId" JOIN "Curriculum" c ON c.id = g."curriculumId" JOIN "Subject" s ON s.id = gs."subjectId" WHERE s."nameEn" IN (''Arabic Language'',''Social Studies'',''Arabic'') ORDER BY c.code, g.level, s."nameEn";'
```

Expected: for every `BRITISH_INTL` level 1-6 an `Arabic Language` row with `subject_active = t` and `offering_active = t`; levels 4-6 the same for `Social Studies`; the old British `Arabic` / `Social Studies` rows still present but `isActive = f` on both the subject and the offering. `EG_NATIONAL` subjects and their home offerings stay active.

Note the doubled single quotes (`''Arabic Language''`) — inside a single-quoted PowerShell string, a literal SQL single quote is written twice.

- [ ] **Step 4: Commit the evidence**

```bash
git add docs/shared-subjects-apply-report-*.json docs/shared-subjects-reverse-map-*.json
git commit -m "chore(shared-subjects): record phase 2 apply report and reverse map"
```

---

### Task 4: Stop the seed from recreating the duplicates

**Files:**
- Modify: `packages/database/prisma/seed.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a seed that no longer creates Arabic or Social Studies under any non-Egyptian curriculum.

- [ ] **Step 1: Remove the two entries**

In `packages/database/prisma/seed.ts`, delete this line from `britishCoreSubjects`:

```ts
    { nameEn: "Arabic", nameAr: "اللغة العربية", icon: "language" },
```

and this line from `britishAdditionalSubjects`:

```ts
    { nameEn: "Social Studies", nameAr: "الدراسات الاجتماعية", icon: "globe" },
```

- [ ] **Step 2: Document why, where the arrays are declared**

Add above `britishCoreSubjects`:

```ts
  // Arabic and Social Studies are deliberately NOT seeded for this curriculum
  // (2026-10-06): they are shared subjects whose content home is the Egyptian
  // National curriculum's own grade, offered here through GradeSubject — see
  // docs/superpowers/specs/2026-10-06-shared-subjects-design.md. Seeding them
  // again would recreate the empty placeholders Phase 2 withdrew.
```

- [ ] **Step 3: Wire a fresh database correctly**

In the README's setup section, after the existing migrate/seed instructions, add:

```bash
# Shared subjects (Arabic Language / Social Studies) are linked, not seeded:
pnpm --filter @smartify/backend build
cd apps/backend && node dist/scripts/shared-subjects-link.js --apply
```

- [ ] **Step 4: Verify the seed still runs and recreates nothing**

```bash
pnpm db:seed
```

Expected: completes without error. Then:

```powershell
& $env:PSQL -X -P pager=off -c 'SELECT c.code, s."nameEn", s."isActive" FROM "Subject" s JOIN "Grade" g ON g.id = s."gradeId" JOIN "Curriculum" c ON c.id = g."curriculumId" WHERE c.code <> ''EG_NATIONAL'' AND s."nameEn" IN (''Arabic'',''Arabic Language'',''Social Studies'') ORDER BY c.code, s."nameEn";'
```

Expected: only rows with `isActive = f` — the withdrawn placeholders. The seed's `findFirst({ gradeId, nameEn })` finds them and skips creating new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/seed.ts README.md
git commit -m "chore(seed): stop seeding non-Egyptian Arabic and Social Studies"
```

---

### Task 5: Verify the outcome end to end

**Files:**
- Create: `apps/backend/src/scripts/shared-subjects-verify.ts`
- Test: `apps/backend/src/scripts/shared-subjects-verify.spec.ts`

**Interfaces:**
- Consumes: `findInvariantViolations` from Phase 1's `common/grade-subject-invariants.ts`, and `resolveEffectiveSourceFile` from `interactive-lesson/unit-grounding/unit-effective-source.util.ts`.
- Produces: `judgeSharedSubjects(input)` returning hard `failures` and soft `warnings`, plus a CLI that prints them and exits non-zero on any failure.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/scripts/shared-subjects-verify.spec.ts`:

```ts
import { judgeSharedSubjects } from "./shared-subjects-verify";

const okInput = {
  invariants: [],
  sharedSubjects: [
    {
      subjectId: "s-eg-ar-2",
      nameEn: "Arabic Language",
      level: 2,
      sourceFile: "eg-national/grade-2/arabic-language/arabic-language-prim2-t1.pdf",
      units: [
        { id: "u1", sourceFileOverride: null },
        { id: "u2", sourceFileOverride: "egypt moe/grade 2/extra.pdf" },
      ],
      offeringCount: 2,
    },
  ],
};

test("a healthy shared subject produces neither failures nor warnings", () => {
  expect(judgeSharedSubjects(okInput)).toEqual({ failures: [], warnings: [] });
});

test("a unit with no resolvable source is a hard failure — shared with no grounding", () => {
  const judged = judgeSharedSubjects({
    ...okInput,
    sharedSubjects: [{ ...okInput.sharedSubjects[0], sourceFile: null, units: [{ id: "u1", sourceFileOverride: null }] }],
  });
  expect(judged.failures).toEqual([{ kind: "UNIT_WITHOUT_SOURCE", subjectId: "s-eg-ar-2", level: 2, unitId: "u1" }]);
});

test("a bare filename source is a warning, not a failure — the textbook repair is still in flight", () => {
  const judged = judgeSharedSubjects({
    ...okInput,
    sharedSubjects: [{ ...okInput.sharedSubjects[0], sourceFile: "Arabic_language_prim2_t1.pdf" }],
  });
  expect(judged.failures).toEqual([]);
  expect(judged.warnings).toEqual([
    { kind: "NON_CANONICAL_SOURCE_KEY", subjectId: "s-eg-ar-2", level: 2, sourceFile: "Arabic_language_prim2_t1.pdf" },
  ]);
});

test("a shared subject no grade offers is a hard failure", () => {
  const judged = judgeSharedSubjects({
    ...okInput,
    sharedSubjects: [{ ...okInput.sharedSubjects[0], offeringCount: 0 }],
  });
  expect(judged.failures).toEqual([{ kind: "SHARED_SUBJECT_NOT_OFFERED", subjectId: "s-eg-ar-2", level: 2 }]);
});

test("invariant violations are reported as failures", () => {
  const judged = judgeSharedSubjects({
    ...okInput,
    invariants: [{ kind: "SUBJECT_WITHOUT_HOME_OFFERING", subjectId: "s-x", nameEn: "X", gradeId: "g-x" }],
  });
  expect(judged.failures).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend
npx jest scripts/shared-subjects-verify.spec.ts
```

Expected: FAIL — `Cannot find module './shared-subjects-verify'`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/scripts/shared-subjects-verify.ts`:

```ts
// Shared subjects Phase 2 (2026-10-06) — post-apply, read-only verification.
// Answers the only question that matters after linking: can a student in
// another curriculum actually open this content, grounding included?
import { PrismaClient } from "@smartify/database";
import { findInvariantViolations, type InvariantViolation } from "../common/grade-subject-invariants";
import { resolveEffectiveSourceFile } from "../interactive-lesson/unit-grounding/unit-effective-source.util";
import { REFERENCE_CURRICULUM_CODE, SHARED_SUBJECT_NAMES } from "./shared-subjects-map";

export type SharedSubjectSnapshot = {
  subjectId: string;
  nameEn: string;
  level: number;
  sourceFile: string | null;
  units: Array<{ id: string; sourceFileOverride: string | null }>;
  offeringCount: number;
};

export type VerifyInput = { invariants: InvariantViolation[]; sharedSubjects: SharedSubjectSnapshot[] };

export type VerifyFailure =
  | { kind: "UNIT_WITHOUT_SOURCE"; subjectId: string; level: number; unitId: string }
  | { kind: "SHARED_SUBJECT_NOT_OFFERED"; subjectId: string; level: number }
  | { kind: "INVARIANT_VIOLATION"; violation: InvariantViolation };

export type VerifyWarning = { kind: "NON_CANONICAL_SOURCE_KEY"; subjectId: string; level: number; sourceFile: string };

export function judgeSharedSubjects(input: VerifyInput): { failures: VerifyFailure[]; warnings: VerifyWarning[] } {
  const failures: VerifyFailure[] = [];
  const warnings: VerifyWarning[] = [];

  for (const violation of input.invariants) {
    failures.push({ kind: "INVARIANT_VIOLATION", violation });
  }

  for (const subject of input.sharedSubjects) {
    // A canonical R2 object key contains a path; a bare filename (what the
    // Egyptian grades 2-6 still carry, pending the core-textbook repair) does
    // not. That is a data-hygiene warning, not an outage.
    if (subject.sourceFile != null && !subject.sourceFile.includes("/")) {
      warnings.push({ kind: "NON_CANONICAL_SOURCE_KEY", subjectId: subject.subjectId, level: subject.level, sourceFile: subject.sourceFile });
    }
    for (const unit of subject.units) {
      const resolved = resolveEffectiveSourceFile(
        { sourceFileOverride: unit.sourceFileOverride },
        { sourceFile: subject.sourceFile },
      );
      if (resolved == null) {
        failures.push({ kind: "UNIT_WITHOUT_SOURCE", subjectId: subject.subjectId, level: subject.level, unitId: unit.id });
      }
    }
    if (subject.offeringCount < 1) {
      failures.push({ kind: "SHARED_SUBJECT_NOT_OFFERED", subjectId: subject.subjectId, level: subject.level });
    }
  }

  return { failures, warnings };
}

export async function collectVerificationInput(db: PrismaClient): Promise<VerifyInput> {
  const subjects = await db.subject.findMany({
    where: {
      nameEn: { in: SHARED_SUBJECT_NAMES },
      grade: { curriculum: { code: REFERENCE_CURRICULUM_CODE } },
      isActive: true,
    },
    select: {
      id: true,
      nameEn: true,
      sourceFile: true,
      grade: { select: { level: true } },
      units: { select: { id: true, sourceFileOverride: true } },
      gradeOfferings: { where: { isActive: true }, select: { id: true } },
    },
  });

  return {
    invariants: await findInvariantViolations(db),
    sharedSubjects: subjects.map((s) => ({
      subjectId: s.id,
      nameEn: s.nameEn,
      level: s.grade.level,
      sourceFile: s.sourceFile,
      units: s.units,
      offeringCount: s.gradeOfferings.length,
    })),
  };
}

async function main() {
  const db = new PrismaClient();
  try {
    const judged = judgeSharedSubjects(await collectVerificationInput(db));
    for (const w of judged.warnings) process.stdout.write(`WARN  ${JSON.stringify(w)}\n`);
    for (const f of judged.failures) process.stdout.write(`FAIL  ${JSON.stringify(f)}\n`);
    process.stdout.write(`\nfailures: ${judged.failures.length}  warnings: ${judged.warnings.length}\n`);
    if (judged.failures.length > 0) process.exitCode = 1;
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
npx jest scripts/shared-subjects-verify.spec.ts
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Run it against the real database**

```powershell
pnpm --filter @smartify/backend build
cd apps/backend && node dist/scripts/shared-subjects-verify.js
```

Expected: `failures: 0`. Warnings about `NON_CANONICAL_SOURCE_KEY` are **expected** for Egyptian grades 2-6 — their `sourceFile` is still a bare filename pending the `core-textbook-repair` work, which is why they are warnings rather than failures. A failure here means a shared subject cannot resolve grounding at all; the phase is not complete until that is fixed.

- [ ] **Step 6: Prove a British student sees the Egyptian content**

```powershell
& $env:PSQL -X -P pager=off -c 'SELECT c_uk.code AS student_system, g_uk.level AS student_level, s."nameEn" AS sees_subject, c_eg.code AS content_home, g_eg.level AS content_level, (SELECT count(*) FROM "Unit" u WHERE u."subjectId" = s.id) AS units FROM "GradeSubject" gs JOIN "Grade" g_uk ON g_uk.id = gs."gradeId" JOIN "Curriculum" c_uk ON c_uk.id = g_uk."curriculumId" JOIN "Subject" s ON s.id = gs."subjectId" JOIN "Grade" g_eg ON g_eg.id = s."gradeId" JOIN "Curriculum" c_eg ON c_eg.id = g_eg."curriculumId" WHERE gs."isActive" = true AND s."nameEn" IN (''Arabic Language'',''Social Studies'') ORDER BY g_uk.level, s."nameEn";'
```

Expected: one row per British level per shared subject, with `content_home = EG_NATIONAL` and `units > 0`. That is the whole point of the phase: a British student's grade offers Egyptian content that was authored — and grounded — exactly once.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/scripts/shared-subjects-verify.ts apps/backend/src/scripts/shared-subjects-verify.spec.ts
git commit -m "feat(scripts): verify shared subjects resolve content and grounding"
```

---

## Verifying the plan is complete

- [ ] **Spec Migration Phase 2 step 1 (reviewed mapping):** `LEVEL_OFFSET = 0` plus `TARGET_CURRICULUM_CODES` in `shared-subjects-map.ts`, asserted by a test (Task 1).
- [ ] **Spec Migration Phase 2 step 2 (offering rows):** Task 2's apply, executed in Task 3.
- [ ] **Spec Migration Phase 2 step 3 (withdraw duplicates):** empty duplicates withdrawn; a duplicate carrying content is **blocked** and deliberately not linked over (Task 1 tests, enforced by Task 2's refusal to apply).
- [ ] **Spec Migration Phase 2 step 4 (re-point entitlements):** implemented with collision handling and per-row reporting (Task 2). It moves zero rows in this database and is proven by fixtures instead.
- [ ] **Spec Migration Phase 2 step 5 (withdraw only after re-pointing):** one transaction, and the re-point loop runs before the withdrawal loop (Task 2).
- [ ] **Spec Phase 4 (seed cleanup):** Task 4.
- [ ] **Spec Testing (integration: a British student sees the Egyptian units):** Task 5 step 6.
- [ ] **Spec Risks (silent empty content):** Task 5 fails loudly on a unit with no resolvable source.
- [ ] **Deferred to Phase 2b, by design:** admin link/withdraw endpoints, the shared-subjects admin view, and wiring the link script into the admin UI.
