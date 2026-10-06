# Shared MOE Subjects Implementation Plan

> **For agentic workers:** Execute in this isolated worktree, one task at a time. Preserve the approved spec; do not access Production or commit/push/deploy.

**Goal:** Make existing Egyptian MOE Arabic and Social Studies content available to matching British/American grades through explicit subject links, without copying books or grounding again.

**Architecture:** A nullable self relation on `Subject` points from the target catalog subject to the canonical MOE source subject. Student APIs authorize the requested target subject, then query canonical content and retain canonical Topic IDs for progress. Admins configure the link through a guarded API and curriculum page; no automatic catalog links are written without confirmed catalog IDs.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Next.js, Zod validation, Jest.

**Spec:** `docs/superpowers/specs/2026-10-06-shared-moe-subjects-design.md`

## Global Constraints

- Do not upload duplicate PDFs or invoke AI to ground shared content again.
- Do not connect to Production, run Production queries, resolve Production migration history, or deploy.
- Do not commit or push.
- Shared MOE content remains the canonical source for Units, Topics, grounding, lessons, questions, and progress.
- Only Arabic and Social Studies may use this launch path; links must be explicit and grade-level matched.

---

## File map

- `packages/database/prisma/schema.prisma` and a new migration define the nullable self-relation.
- `apps/backend/src/common/subject-access.ts` owns discovery and secure source resolution.
- Dashboard, Practice, Quiz, Tutor, and Lesson services route content reads through that resolver.
- `apps/backend/src/admin/curriculum/admin-curriculum.service.ts` and controller manage validated links; curriculum status exposes link metadata.
- `apps/frontend/app/[locale]/admin/curriculum/page.tsx` offers the admin link editor.
- Focused mocked specs cover resolver, student paths, and admin validation.

### Task 1: Add the explicit canonical content link

**Files:**
- Modify `packages/database/prisma/schema.prisma`
- Create `packages/database/prisma/migrations/20261006120000_share_moe_subject_content/migration.sql`

- [x] Add nullable `sharedContentSubjectId` and named self-relation fields to Subject, with a non-unique foreign key so British and American target subjects can both point to the same MOE source. The source must be a canonical MOE subject with no outgoing share link, which prevents cycles.
- [x] Add the matching nullable FK and unique index migration using `ON DELETE RESTRICT`.
- [x] Generate Prisma client without using any database connection.

### Task 2: Build the fail-closed share resolver and admin API

**Files:**
- Modify `apps/backend/src/common/subject-access.ts`
- Modify `apps/backend/src/admin/curriculum/admin-curriculum.controller.ts`
- Modify `apps/backend/src/admin/curriculum/admin-curriculum.service.ts`
- Modify curriculum validation schema under `packages/validation`
- Create resolver and admin service specs under their existing source folders

- [x] Add a pure eligibility helper that allows only Arabic/Arabic Language and Social Studies subjects, and use relational grade `level` plus MOE curriculum code for source validation.
- [x] Add `resolveStudentSubjectContent(prisma, profile, requestedSubjectId)` returning requested subject, canonical content subject ID, and active entitlement; accept canonical-content routes only when a valid shared target in the student's own curriculum/grade is entitled.
- [x] Add an admin POST route to create a target catalog subject from a selected MOE source and target grade, copying only names plus the source ID; add a PATCH route to set or clear a target subject's source link. Re-derive curricula/grades server-side and reject non-canonical/chained sources, mismatched grade levels, inactive subjects, ineligible names, non-MOE sources, and targets with duplicate local Units.
- [x] Return shared-source metadata in curriculum status while never returning book keys or grounding payloads.
- [x] Mock invalid and valid links, wrong level/curriculum, and proof the endpoint does not call upload, extraction, grounding, or AI services.

### Task 3: Route student content and discovery through the canonical source

**Files:**
- Modify `apps/backend/src/dashboard/dashboard.service.ts`
- Modify `apps/backend/src/practice/practice.service.ts`
- Modify `apps/backend/src/quizzes/quizzes.service.ts`
- Modify `apps/backend/src/tutor/tutor.service.ts`
- Modify `apps/backend/src/interactive-lesson/interactive-lesson.service.ts`
- Modify `apps/backend/src/tutor-question-packs/tutor-question-packs.service.ts` if subject access is validated there
- Update the corresponding mocked specs

- [x] Dashboard discovery lists the target subject with its own price and entitlement, loads topics and progress by canonical content IDs, and emits the target subject ID for curriculum grouping.
- [x] Practice topics/questions and quiz questions resolve the requested subject to canonical content after checking target entitlement; submission accepts only canonical questions belonging to that resolved source and writes attempts against canonical question/topic IDs.
- [x] Lesson and Tutor flows resolve canonical Topic ownership to the student's configured target alias before content or provider work; retain target subject identity for quota/trial accounting.
- [x] Verify ordinary non-shared access remains unchanged and invalid links fail before content or provider queries.

### Task 4: Add admin configuration UI and verify

**Files:**
- Modify `apps/frontend/app/[locale]/admin/curriculum/page.tsx`
- Add focused coverage under `apps/backend/src/common` and `apps/backend/src/admin/curriculum`

- [x] Add a control to create missing British/American catalog subjects from eligible same-level MOE subjects, plus an editor for existing eligible target subjects that shows and clears links. Save through the guarded API and refresh status.
- [x] Keep upload and auto-ground actions unavailable for linked subjects and display that content is shared from MOE, avoiding duplicate upload/grounding attempts.
- [x] Generate Prisma client, run focused mocked Jest specs, build the database package and backend, then build the frontend. Do not run any database migration against a real database.
- [x] Inspect the final diff and confirm the six PDF-import changes and both stashes remain untouched.
