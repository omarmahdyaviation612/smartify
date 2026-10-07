# Parent Teacher Session Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let a parent request a teacher session for a linked child and let an administrator coordinate and confirm it manually.

**Architecture:** Persist a parent-owned request with child, subject, optional topic, preferred availability/contact note, and a small state machine. Parent views only their own requests; admins manage the request queue. A request is never presented as a confirmed booking until an admin confirms it.

**Tech Stack:** NestJS 10, Prisma, PostgreSQL, Next.js 14, React 18, Jest.

**Spec:** `docs/superpowers/specs/2026-10-07-parent-features-launch-design.md` (Teacher session requests)

## Global Constraints

- Request creation proves the child is linked to the authenticated parent and the subject/topic belongs to that child’s selected curriculum and grade.
- Status begins `PENDING`; only an administrator can mark `CONTACTED`, `CONFIRMED`, or `DECLINED`.
- No automatic teacher matching, calendar reservation, payment, or price entry.
- Do not connect to Production or send external messages as part of this plan.

---

### Task 1: Add request persistence and parent-scoped API

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261007110000_teacher_session_requests/migration.sql`
- Create: `apps/backend/src/teacher-requests/teacher-requests.module.ts`
- Create: `apps/backend/src/teacher-requests/parent-teacher-requests.controller.ts`
- Create: `apps/backend/src/teacher-requests/teacher-requests.service.ts`
- Create: `apps/backend/src/teacher-requests/teacher-requests.service.spec.ts`
- Modify: `apps/backend/src/app.module.ts`

**Interfaces:**
- `POST /parent/teacher-requests` accepts `{ studentId, subjectId, topicId?, preferredTimes, contactNote? }`.
- `GET /parent/teacher-requests` returns requests owned by the authenticated parent.
- `TeacherSessionRequest.status` is one of `PENDING`, `CONTACTED`, `CONFIRMED`, `DECLINED`.
- `preferredTimes` is a required string capped at 1000 characters; `contactNote` is optional and capped at 1000 characters. Do not store addresses or precise location.

- [ ] Add failing tests for linked child creation, unrelated child rejection, topic/subject scope mismatch, and parent-only list isolation.
- [ ] Add additive Prisma model with foreign keys to parent, child, subject and optional topic; store preferred times, optional contact note, status, admin note, and created/updated timestamps; add an index on `(parentId, status, createdAt)`.

```prisma
model TeacherSessionRequest {
  id             String   @id @default(cuid())
  parentId       String
  studentId      String
  subjectId      String
  topicId        String?
  preferredTimes String   @db.Text
  contactNote    String?  @db.Text
  status         String   @default("PENDING")
  adminNote      String?  @db.Text
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  parent         ParentProfile @relation(fields: [parentId], references: [id], onDelete: Cascade)
  student        StudentProfile @relation(fields: [studentId], references: [id], onDelete: Cascade)
  subject        Subject @relation(fields: [subjectId], references: [id], onDelete: Restrict)
  topic          Topic? @relation(fields: [topicId], references: [id], onDelete: SetNull)
  @@index([parentId, status, createdAt])
}
```

- [ ] Add matching back-relations to `ParentProfile`, `StudentProfile`, `Subject`, and `Topic`; verify these model names against the current Prisma schema before editing. Add an enum or SQL check for the four allowed status values.

- [ ] Run `pnpm --filter @smartify/database exec prisma validate` and generate the client locally.
- [ ] Implement the parent API with server-side relation and curriculum checks; trim both text fields and reject values over 1000 characters.
- [ ] Run the focused Jest file and backend build.
- [ ] Commit as `feat: accept parent teacher session requests`.

### Task 2: Add administrator review workflow and parent UI

**Files:**
- Create: `apps/backend/src/admin/teacher-requests/admin-teacher-requests.controller.ts`
- Create: `apps/backend/src/admin/teacher-requests/admin-teacher-requests.service.ts`
- Create: `apps/backend/src/admin/teacher-requests/admin-teacher-requests.service.spec.ts`
- Create: `apps/frontend/app/[locale]/admin/teacher-requests/page.tsx`
- Modify: `apps/frontend/app/[locale]/admin/page.tsx`
- Modify: `apps/frontend/app/[locale]/parent/page.tsx`

**Interfaces:**
- Admin endpoints list requests and perform a compare-and-set status transition with optional sanitized admin note.
- Parent UI submits child, subject, optional topic, preferred times, and contact note; it displays the returned status.

- [ ] Add failing tests for admin-only access, legal status transitions, and rejection of repeated/stale transitions.

```ts
await expect(service.updateStatus("request-1", "CONFIRMED", "admin-1"))
  .resolves.toMatchObject({ status: "CONFIRMED" });
await expect(service.updateStatus("request-1", "PENDING", "admin-1"))
  .rejects.toThrow(BadRequestException);
```

- [ ] Add the admin queue, status actions, and a parent request form with Arabic/English copy and empty/error states.
- [ ] Confirm all labels distinguish “request sent” from “booking confirmed”.
- [ ] Run focused backend tests and backend/frontend builds.
- [ ] Commit as `feat: review parent teacher session requests`.
