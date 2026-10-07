# Family Dashboard and Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Give a linked parent a secure, useful overview of multiple children, curriculum enrollment, learning progress, daily AI question allowance, and review areas.

**Architecture:** Extend the existing `GET /parent/dashboard/summary` contract with only data from linked student profiles, reusing topic-accuracy and daily-usage services. Render the data in the existing Arabic/English parent page without adding a separate dashboard API or AI calls.

**Tech Stack:** NestJS 10, Prisma, Next.js 14, React 18, Tailwind CSS, Jest.

**Spec:** `docs/superpowers/specs/2026-10-07-parent-features-launch-design.md` (Family dashboard and curriculum identity; Usage and review guidance)

## Global Constraints

- Scope every student query by the authenticated parent’s `ParentStudentRelation` rows.
- Arabic and Social Studies retain their grade-specific shared MOE identity and Arabic content; do not copy or regenerate content.
- Do not expose AI conversations, question text, or answer content.
- Usage is read-only and per child/subject; the team-configured daily limit remains authoritative.
- Do not change prices or connect to Production.

---

### Task 1: Define and test the parent summary contract

**Files:**
- Modify: `apps/backend/src/parent/parent.service.spec.ts`
- Modify: `apps/backend/src/parent/parent.service.ts`

**Interfaces:**
- `dashboardSummary(userId: string)` returns `{ parent, students }`.
- Each student summary contains the existing progress/results plus `curriculum`, `grade`, `subjects`, `subjectUsage`, and `weakTopics`.
- `subjectUsage` items contain `{ subjectId, nameEn, nameAr, used, limit, remaining }`.
- `weakTopics` items contain `{ topicId, nameEn, nameAr, subjectNameEn, subjectNameAr, correct, total, percent }`.
- Usage keys use the selected/billable target subject ID; accuracy queries use `sharedContentSubjectId ?? id` so shared MOE content keeps one attempt history.

- [ ] Add a mocked service test with two linked children and one unrelated student; assert only the two relation rows are returned and each keeps its own grade/curriculum/subjects.

```ts
const result = await service.dashboardSummary("parent-user");
expect(result.students.map((student) => student.id)).toEqual(["child-2", "child-1"]);
expect(result.students[0]).toMatchObject({
  curriculum: { nameAr: "بريطاني" },
  grade: { nameAr: "الصف الخامس" },
  subjects: [{ id: "arabic-y5", nameAr: "اللغة العربية" }],
});
```

- [ ] Add a mocked test with usage and accuracy service results; assert the summary carries exact per-subject counts and weak-topic names without question text.
- [ ] Run `pnpm --filter @smartify/backend exec jest src/parent/parent.service.spec.ts --runInBand` and confirm the new assertions fail before implementation.
- [ ] Import `AnalyticsModule` and `AIModule` in `ParentModule`; inject `TopicAccuracyService` and `AIUsageService` into `ParentService`.
- [ ] Include curriculum, grade, and selected subjects in the linked-student query.
- [ ] Build usage with `AIUsageService.getRemainingToday(student.id, subject.id)` for each selected subject, and get weak topics from `TopicAccuracyService.getPerTopicAccuracy(student.id, canonicalSubjectIds)`; make no provider calls.

```ts
const usage = await Promise.all(selectedSubjects.map(async (subject) => ({
  subjectId: subject.id,
  nameEn: subject.nameEn,
  nameAr: subject.nameAr,
  ...(await this.usageService.getRemainingToday(student.id, subject.id)),
})));
```

- [ ] Preserve existing completed lesson and exam result fields; never select `AIConversation` or answer content.
- [ ] Run `pnpm --filter @smartify/backend exec jest src/parent/parent.service.spec.ts --runInBand` and `pnpm --filter @smartify/backend build`.
- [ ] Commit the passing delivery as `feat: report linked children progress to parents`.

### Task 2: Render the expanded family summary

**Files:**
- Modify: `apps/frontend/app/[locale]/parent/page.tsx`

**Interfaces:**
- The frontend `Student` type mirrors Task 1’s summary contract.
- Arabic/English labels are selected from the current locale; subject names use `nameAr` for Arabic and `nameEn` for English, while Arabic and Social Studies content remains Arabic on either curriculum.

- [ ] Render each child’s curriculum, grade, selected subjects, completed lessons, exam results, per-subject daily usage, and weak topics.
- [ ] Render usage from the summary with a localized, accessible label such as `<p>{subject.nameAr}: {subject.remaining} من {subject.limit} سؤال متبقٍ اليوم</p>`; keep the equivalent English string in the English branch.
- [ ] Add explicit empty states when a child has no attempts, lessons, assessments, or selected subjects; do not label missing history as weak performance.
- [ ] Verify responsive Tailwind layout by running `pnpm --filter @smartify/frontend build`.
- [ ] Review the rendered Arabic and English routes in a browser with two student fixtures; verify no question, answer, or conversation text is present.
- [ ] Commit the UI delivery as `feat: show family learning progress dashboard`.
