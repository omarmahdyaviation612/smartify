# Shared Subjects Across Curricula (Arabic and Social Studies)

## Goal

Author Arabic and Social Studies once — under the Egyptian national grades —
and let every other curriculum (British International, American International,
Local Custom "Languages") offer that same content, at one price, where a single
purchase grants access regardless of which system the student is enrolled in.

Uploading, grounding, and generating the same material once per system must
stop.

## Problem

A `Subject` belongs to exactly one `Grade`, and a `Grade` belongs to exactly one
`Curriculum` (`schema.prisma` L197-L251). `Unit` hangs off `Subject`
(L296-L299), as do `sourceFile`, `priceEGP`, `groundingNotesJson`, and every
generated `Topic`/`Lesson`/`Question` below them.

So "Arabic" is a separate row — with a separate content tree, a separate
textbook mapping, a separate price, and separate generation cost — for every
curriculum that teaches it. The seed already creates Arabic and Social Studies
for each curriculum it seeds (`seed.ts` L119-L146), so the duplication is the
current design, not an accident.

Nothing stores "which curriculum/grade this content belongs to" independently:
every content read derives it from `subject.grade`. The places that matter:

| Location | Coupling |
| --- | --- |
| `dashboard.service.ts:78` | `where: { unit: { subjectId: { in }, subject: { gradeId: profile.gradeId } } }` |
| `interactive-lesson.service.ts` (4 sites), `lesson-draft-generator.service.ts:95`, `question-draft-generator.service.ts:75`, `unit-grounding.service.ts:131` | `topic → unit → subject → grade → curriculum` for prompt context |
| `onboarding.service.ts:31`, `billing.service.ts:143`, `referral.service.ts:121`, `trial.service.ts:48` | "this subject must have `gradeId` = the student's grade" |
| `curricula.service.ts` (public catalog, `getStructureSample`), `admin-curriculum.service.ts:279` and `:441` | subject lists nested under the grade |
| `common/subject-entitlement.util.ts` | entitlement keyed on `StudentSubject.subjectId` |

## Decisions

1. **One identical copy for every system.** A single source of truth; no
   per-system content variants.
2. **Content, price, and entitlement are all unified.** Buying Arabic once works
   in every system that offers it.
3. **The Egyptian grade is the reference level.** No new "canonical level"
   entity is introduced. The correspondence between a non-Egyptian grade and its
   reference Egyptian grade is explicit and human-reviewed, and is expressed by
   which subject that grade offers.

## Non-goals

- Extending sharing to English, Mathematics, or Science. The mechanism allows
  it; this spec does not do it.
- Per-system display names ("Social Studies (Arabic)") or per-system prices.
  `GradeSubject` is the natural home for both if they are ever needed.
- Aligning KG or non-standard grades beyond the reviewed mapping.
- Merging the content of non-empty duplicate subjects. Those are handled
  case-by-case with explicit approval (see Migration, Phase 2).
- Deduplicating `TutorAnswerCache`. Sharing already makes the cache key
  identical across systems; measuring the benefit is a follow-up.
- Any refactor of `gradeId` coupling outside the read path listed here.

## Data model

Add:

- A per-grade, per-subject offering row. A grade offers a subject; the subject
  may belong to a different curriculum's grade. This is what students and admins
  actually see for their own grade. Unique per `(gradeId, subjectId)`, with
  `isActive` so an offering can be withdrawn without touching the subject or its
  content.

`Subject.gradeId` stays required, with a sharpened meaning: it is the subject's
**content home** — the grade whose curriculum authored its units, its textbook
mapping, and its price. For a shared subject the content home is always the
Egyptian reference grade. Every content relation (`unit.subjectId`), the AI
prompt context, and the `TutorAnswerCache` key keep reading it unchanged.

Every existing subject receives an offering row for its own home grade, so the
read path has exactly one shape: there is no "own subject" versus "shared
subject" branch anywhere.

No "reference grade" column is added. The reference is `subject.grade`, which is
already stored and cannot drift.

```prisma
/// A grade offers a subject. Subject.gradeId is the CONTENT HOME (where units,
/// textbook mapping, and price are authored — always the Egyptian reference
/// grade for shared subjects); GradeSubject is what a student or admin sees for
/// their own grade. Every subject has at least its own home grade as an
/// offering.
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

With back-relations `Grade.offeredSubjects GradeSubject[]` and
`Subject.gradeOfferings GradeSubject[]`.

`StudentSubject` is unchanged (`studentId`, `subjectId`, `expiresAt`). It always
holds a content-home subject id, which is what makes "buy once, works everywhere"
fall out for free.

**Invariant.** No active subject without an offering for its own home grade, and
no active grade offering two subjects that share a content home.

## Rules that must not drift

This is the failure mode this design exists to prevent, so it is written as a
rule rather than left to review:

- **Learner context** — the grade and curriculum shown to a student, and their
  progress — always comes from `StudentProfile.grade`.
- **Content context** — the AI prompt, grounding source resolution, and the
  tutor cache key — always comes from `subject.grade`.

Keeping content context on the content home is deliberate: a British Year 6
student studying Egyptian Arabic must be taught Egyptian Grade 5 material, and
all systems then share one `TutorAnswerCache` entry instead of paying for the
same generation four times.

## Read path changes

| File | Change |
| --- | --- |
| `curricula.service.ts` (public catalog, `getStructureSample`) | read subjects through `offeredSubjects → subject` |
| `onboarding.service.ts:31` | validate the selection through `GradeSubject` (grade offers subject, offering active, subject active) instead of `subject.gradeId` |
| `billing.service.ts:143` | same offering validation; price still read from the content-home subject |
| `referral.service.ts:121` | list the grade's subjects through `GradeSubject` |
| `trial.service.ts:48` | same offering validation |
| `dashboard.service.ts:78` | drop the `subject: { gradeId: profile.gradeId }` clause; scope by owned subjects only |
| `admin-curriculum.service.ts:279`, `:441` | read through `offeredSubjects → subject`; expose `shared` (`subject.gradeId !== gradeId`) so an admin can see what is shared |
| `practice`, `quizzes`, `tutor`, `tutor-question-packs`, `parent` | unchanged — they read `profile.subjects → subject`, which already resolves content-home ids. Each must still be checked not to read `subject.grade` for anything shown to the learner |

`common/subject-entitlement.util.ts` is unchanged.

`dashboard.service.ts:78` is the only content query that re-checks
`subject.gradeId`. Left alone it would return an empty list — with no error —
for a British student opening Arabic. Fixing it is part of this change, not a
follow-up.

## Entitlement and pricing

- Checkout validates the grade/subject pair through `GradeSubject`, and reads
  `priceEGP` from the content-home subject. `Subscription.selectedSubjectIds`
  stores content-home ids.
- Granting (webhook or manual) writes `StudentSubject` rows for content-home
  ids, so the entitlement is immediately valid in every system that offers the
  subject.
- Referral grants (`expiresAt`) and the free trial (`LessonTrial.subjectIds`)
  are unchanged; both already reference subject ids.
- Entitlement stays per content-home subject, i.e. per subject **and level**.
  A student who moves to a grade that maps to a different home subject does not
  carry access across (today's behavior, not a regression). It does mean
  switching systems within the same level never loses Arabic or Social Studies.
- The unified price means editing Arabic's price in one place changes it for
  every system. That is the intent. A per-system override would live on
  `GradeSubject.priceEGP` if it is ever needed.

## Migration

Each phase is independently deployable and independently reversible.

**Phase 0 — read-only inventory (no writes).**
Produce a JSON report per curriculum: the Arabic and Social Studies subjects,
their unit/topic counts, grounded units, generated lessons, and the
`StudentSubject` / `LessonTrial` / `Subscription.selectedSubjectIds` rows
pointing at them. This decides, per duplicate, whether it is empty (safe to
withdraw) or carries content (needs a decision).

**Phase 1 — model and backfill (additive, behavior-identical).**

1. Migration creates `GradeSubject`.
2. Backfill one offering row per existing subject for its own home grade;
   verify the row count equals the active subject count.
3. Switch the read path to `GradeSubject`. Because every subject is still
   offered by its own home grade, every response is byte-identical to today.
4. The dashboard fix lands here for the same reason: with each subject offered
   by its own grade, dropping the `subject.gradeId` clause changes nothing. This
   is the cleanest possible moment to fix it.
5. Full test suite green.

**Phase 2 — shared offerings (additive; nothing removed yet).**

1. A human-reviewed mapping file — `(curriculum, grade level) → reference
   Egyptian grade` — applied by a script with a dry-run report first, following
   the existing `docs/core-textbook-repair-dry-run.md` pattern.
2. Insert offering rows for British International, American International, and
   Local Custom grades pointing at the Egyptian Arabic and Social Studies
   subjects.
3. Classify every duplicate from the Phase 0 report, without withdrawing
   anything yet:
   - **Empty duplicate** (no units/topics/lessons): scheduled for withdrawal in
     step 5.
   - **Non-empty duplicate**: never merged automatically and never scheduled for
     withdrawal. It stays active, the shared offering is added, and the affected
     cases come back for an explicit per-case decision.
4. Re-point `StudentSubject`, `LessonTrial.subjectIds`, and
   `Subscription.selectedSubjectIds` from every duplicate scheduled in step 3 to
   its content home, so existing students keep their access. Where a student
   holds both the duplicate and the content home,
   `@@unique([studentId, subjectId])` would collide: the more permissive row wins
   (`expiresAt: null` beats a dated one) and the redundant row is removed, with
   every decision written to the report.
5. Only after step 4 has completed for a given grade, withdraw the duplicate
   offerings scheduled in step 3 for that grade — so no student is ever left
   holding an entitlement to a subject their grade no longer offers.

`pnpm db:backup` must run before step 4, and the script must emit a reverse
mapping so step 4 can be undone.

**Phase 3 — switchover.** No new code. After Phase 1 and Phase 2, onboarding,
billing, trial, and referral already work through `GradeSubject`.

**Phase 4 — cleanup and guards.**

- Stop seeding Arabic and Social Studies for non-Egyptian curricula
  (`seed.ts` L119-L146) so they cannot come back.
- Add invariant checks: every active subject has an offering for its own home
  grade; no grade offers two subjects with the same content home.
- Optional follow-up: measure whether the tutor cache is now shared in practice.

**Rollback.** Phases 1 and 2 are additive; reverting the code is enough and the
table can stay. Phase 2 step 4 is the only step that rewrites existing rows, and
it is covered by the backup and the reverse mapping.

## Admin tooling

- The existing `admin-curriculum` endpoints expose `shared` and
  `offeredSubjects` on each grade.
- Link and withdraw endpoints: `POST /admin/grades/:gradeId/subjects/:subjectId`
  and its withdrawal counterpart.
- A "shared subjects" view listing every grade that offers Arabic or Social
  Studies together with its reference Egyptian grade. This is the human review
  surface that catches a wrong correspondence such as British Year 6 pointing at
  Grade 6 instead of Grade 5.
- A `shared-subjects:link` script reads the reviewed mapping file, prints a
  dry-run, and applies on approval, so the links are not entered by hand per
  system.

## Testing

- Offering validation: onboarding, billing, trial, and referral reject a subject
  that is not offered for the student's grade (not merely one whose `gradeId`
  differs).
- Integration: a British Year 6 student selects Arabic, sees the Egyptian
  Grade 5 units and topics, buys it once, and remains entitled after switching
  to the Egyptian curriculum at the same level.
- Regression test for the dashboard: a British student's dashboard lists Arabic
  content — the exact case that would otherwise come back empty with no error.
- Guard tests for the learner-context versus content-context rule, at minimum on
  the dashboard and interactive-lesson paths.
- Invariant checks from Phase 4 run as tests, not only as scripts.

## Open questions

1. **Phase 0 output.** How many Arabic and Social Studies subjects exist in
   production per curriculum, and do the non-Egyptian ones carry content? The
   answer decides, per duplicate, between withdrawing and merging.
2. **Per-system display names.** Deferred. If a system must label the subject
   differently, it goes on `GradeSubject`.
3. **KG and non-standard grades.** The mapping file makes them explicit; no
   arithmetic offset is assumed anywhere.
4. **Sequencing.** `schema.prisma` currently carries uncommitted School-directory
   work (Student school info V1). This migration must be sequenced after that
   work lands, or rebased on top of it, to avoid a conflicting schema edit.

## Risks

| Risk | Handling |
| --- | --- |
| A missed read site returns an empty content tree with no error | One uniform read shape (every subject is offered by its home grade); the dashboard fix is in Phase 1 where it is provably behavior-identical; guard tests on both contexts |
| A grade temporarily offers two Arabic subjects during Phase 2 | Duplicates are classified in step 3 and withdrawn only after entitlements are re-pointed in steps 4-5; non-empty duplicates are never withdrawn automatically |
| Re-pointing entitlements collides on `@@unique([studentId, subjectId])` | More permissive row wins, removals reported, backup taken, reverse mapping emitted |
| Seed re-creates the duplicates | Phase 4 removes non-Egyptian Arabic and Social Studies from the seed |
| Unified price changes cost for every system at once | Intended; the per-system override has a known home if requirements change |
| Migration collides with the uncommitted School-directory schema work | Explicit sequencing in Open question 4 |
