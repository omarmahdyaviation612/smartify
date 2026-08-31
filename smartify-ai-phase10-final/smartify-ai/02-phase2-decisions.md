# Smartify AI — Phase 2 Decisions & Migration Plan

This document records the decisions made after Phase 1 and defines exactly what Phase 2 builds. It supplements `01-architecture.md` — nothing in Phase 1 is being redesigned, only extended.

---

## 1. Monorepo: pnpm + Turborepo

```
smartify-ai/
├── apps/
│   ├── backend/         (NestJS)
│   └── frontend/         (Next.js)
├── packages/
│   ├── database/          Prisma schema + client + seed
│   ├── shared-types/       enums & DTOs shared frontend/backend
│   ├── config/             env validation (zod)
│   ├── validation/         shared zod schemas (onboarding, AI requests, etc.)
│   └── ui/                 shared design-system primitives (Phase 3+)
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

`apps/*` depend on `packages/*` via workspace protocol (`"@smartify/database": "workspace:*"`). Turborepo caches builds/lint/test across the graph.

---

## 2. Authentication: Clerk, with backend-owned authorization

**Decision:** Clerk handles identity (sign-up, sign-in, session tokens, MFA, email verification). It does **not** own authorization. Every protected NestJS endpoint re-checks role and record-level permissions against Postgres — Clerk session data is a claim about *who*, never a claim about *what they're allowed to do*.

### 2.1 Roles (final list)

```prisma
enum UserRole {
  SUPER_ADMIN
  ADMIN
  CONTENT_MANAGER
  SUPPORT
  TEACHER
  PARENT
  STUDENT
}
```

Rough intent (refine permissions per-endpoint as features are built):
- **SUPER_ADMIN** — full system access, including AI provider config and financial data.
- **ADMIN** — user/curriculum/subscription management, no raw provider-cost config.
- **CONTENT_MANAGER** — curriculum & content CRUD only, no user/billing access.
- **SUPPORT** — read-mostly: view user accounts/subscriptions to help with tickets, no content or billing mutation.
- **TEACHER** — future class/student-management scope (Phase 2 just reserves the role and profile table).
- **PARENT** — read access to their linked children's progress only.
- **STUDENT** — access to their own learning data only.

### 2.2 Clerk ↔ internal `User` sync

Flow:
1. User signs up/in through Clerk (frontend `<ClerkProvider>` + hosted components).
2. Clerk fires a webhook (`user.created`, `user.updated`, `user.deleted`) to `POST /webhooks/clerk` on the backend.
3. Backend verifies the Svix webhook signature, then upserts a row in `User` keyed by `clerkUserId`, defaulting `role = STUDENT` on creation (role changes happen via admin action afterward, never from the webhook payload itself — Clerk metadata is not a trusted authorization source).
4. On every authenticated API request, `ClerkAuthGuard` verifies the session token (via Clerk's backend SDK), resolves `clerkUserId` → local `User` row (cached briefly in Redis to avoid a DB hit per request), and attaches `{ id, role, email }` to the request.
5. `RolesGuard` + `@Roles(...)` decorator then check the local `role` against the endpoint's requirement. This is the actual authorization boundary — it runs entirely against Postgres data, so it works identically if Clerk is ever swapped out.

### 2.3 Swappable design

```
AuthProvider interface
  verifySessionToken(token) → { externalUserId, email }
  ├── ClerkAuthProvider   (current)
  └── (future) SelfHostedAuthProvider
```

`ClerkAuthGuard` depends on `AuthProvider`, not on the Clerk SDK directly. Replacing Clerk later means writing one new provider class and changing a config value — `User.clerkUserId` becomes `User.externalAuthId` conceptually (already named generically enough to survive that).

---

## 3. Seed Data & Curriculum Import Path

Phase 2 seeds a **small, clearly-labeled placeholder** dataset — no copyrighted textbook content — covering all four systems from the spec:

- Local / Custom
- Egyptian National
- British International
- American International

Each gets: 1 grade → 1–2 subjects → 1 unit → 2 topics → 1–2 lessons → a handful of practice questions. Enough to exercise onboarding, dashboard, practice, and quiz flows end-to-end. Every seeded lesson/question is tagged `isAiGenerated: false` and prefixed `[PLACEHOLDER]` in its title so it's unmistakable in the UI and never confused with reviewed content later.

**Structure is import-ready:** the `Curriculum → Grade → Subject → Unit → Topic → Lesson` hierarchy plus `isAiGenerated`/source metadata on `Lesson` and `Question` means a future PDF/image ingestion pipeline can populate the exact same tables — it just needs a `ContentImportJob` model (added when that pipeline is actually built) that maps extracted content onto this hierarchy plus an admin review step before `isAiGenerated`/`isVerified` flips. Not building the importer itself now — just confirming the schema doesn't need to change to support it later.

---

## 4. What Phase 2 delivers (scope)

- Monorepo scaffold (`pnpm-workspace.yaml`, `turbo.json`, root configs)
- `packages/database`: full Prisma schema (updated `UserRole` enum + `clerkUserId`), migration, seed script
- `packages/shared-types`: role enum, question/difficulty enums, core DTOs
- `packages/config`: zod-validated env loading, shared by both apps
- `apps/backend`: NestJS bootstrap, Prisma module, Clerk webhook sync, `ClerkAuthGuard`, `RolesGuard`, `@Roles`/`@CurrentUser` decorators, a minimal `users` module to prove the flow end-to-end
- `apps/frontend`: Next.js bootstrap with `ClerkProvider`, middleware that gates routes by auth state (role-based UI gating comes with Phase 3 dashboards, once there's something to gate)

Out of scope for Phase 2 (later phases): marketing pages, onboarding UI, AI service layer, payments — Phase 2 is foundation only, per the roadmap.
