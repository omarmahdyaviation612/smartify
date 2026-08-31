# Smartify AI Test and Bug-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the existing Smartify AI monorepo locally and correct defects exposed by its current tests, lint, build, and safe startup checks.

**Architecture:** Keep the existing NestJS backend, Next.js frontend, Prisma packages, OpenAI provider, and payment-provider abstraction intact. Establish a reproducible baseline first, then make surgical fixes in the exact files implicated by failures and re-run the smallest relevant checks before package-level verification.

**Tech Stack:** pnpm 9, Turborepo, NestJS 10, Next.js 14, TypeScript, Jest, ESLint, Prisma, OpenAI SDK, Stripe/Fawry provider abstractions.

**Spec:** `docs/superpowers/specs/2026-08-31-test-and-fix-design.md`

## Global Constraints

- Real OpenAI, Clerk, Stripe, or Fawry credentials will not be created or exposed.
- Existing payment safety defaults remain disabled until explicitly configured.
- Changes remain limited to defects and tests directly related to this pass.
- Use the existing package scripts and test runner; do not add new tooling.

---

### Task 1: Establish the local verification baseline

**Files:**
- Read: `package.json`
- Read: `apps/backend/package.json`
- Read: `apps/frontend/package.json`
- Read: `apps/backend/.env.example`
- Read: `apps/frontend/.env.example`
- Read: `README.md`

**Interfaces:**
- Consumes: existing pnpm workspace scripts.
- Produces: recorded command results and a concrete list of failures to drive the next tasks.

- [ ] **Step 1: Run the existing backend unit tests**

Run from `smartify-ai`:

```powershell
pnpm --filter @smartify/backend test -- --runInBand
```

Expected: Jest completes and reports any failing spec names and stack traces without contacting external providers.

- [ ] **Step 2: Run backend lint and build**

```powershell
pnpm --filter @smartify/backend lint
pnpm --filter @smartify/backend build
```

Expected: both commands pass, or their exact actionable diagnostics are captured.

- [ ] **Step 3: Run frontend lint and build**

```powershell
pnpm --filter @smartify/frontend lint
pnpm --filter @smartify/frontend build
```

Expected: both commands pass, or their exact actionable diagnostics are captured.

- [ ] **Step 4: Inspect the existing AI and payment paths implicated by failures**

Read the failing symbols and their direct callers in:

```text
apps/backend/src/ai
apps/backend/src/tutor
apps/backend/src/payments
apps/backend/src/billing
apps/frontend/app/[locale]/tutor
apps/frontend/app/[locale]/billing
```

Expected: each proposed edit is tied to a reproduced failure or a directly coupled type/runtime defect.

### Task 2: Correct backend defects exposed by baseline checks

**Files:**
- Modify: only backend source files identified by Task 1.
- Test: the existing spec file covering each failing symbol; create no new test file unless the failure has no existing coverage.

**Interfaces:**
- Consumes: failing Jest/lint/build diagnostics from Task 1.
- Produces: backend behavior that preserves existing DTOs, provider interfaces, error semantics, and safety defaults.

- [ ] **Step 1: Add or adjust the smallest regression assertion**

Use the existing Jest style and assert the reproduced behavior, for example:

```ts
it('preserves the expected error when the provider is unavailable', async () => {
  await expect(service.method(input)).rejects.toThrow(ExpectedError);
});
```

Expected: the targeted test fails before the implementation fix and identifies the intended contract.

- [ ] **Step 2: Implement the minimal backend fix**

Update only the implicated method, guard, provider adapter, configuration branch, or type declaration. Preserve explicit error propagation and never replace provider failures with a success-shaped fallback.

Expected: the regression test passes without weakening authentication, authorization, rate limits, usage limits, webhook validation, or disabled-payment defaults.

- [ ] **Step 3: Run the targeted backend test**

```powershell
pnpm --filter @smartify/backend test -- --runInBand <target-spec-path>
```

Expected: the changed spec passes.

- [ ] **Step 4: Re-run the backend package checks**

```powershell
pnpm --filter @smartify/backend test -- --runInBand
pnpm --filter @smartify/backend lint
pnpm --filter @smartify/backend build
```

Expected: all backend checks pass.

### Task 3: Correct frontend defects exposed by baseline checks

**Files:**
- Modify: only frontend files identified by Task 1.
- Test: existing frontend tests if present; otherwise validate through the production build and route/type checks already provided by the package.

**Interfaces:**
- Consumes: frontend lint/build diagnostics from Task 1 and any backend contract changes from Task 2.
- Produces: frontend routes that compile and preserve current locale routing, auth gating, tutor subscription gating, and billing UX.

- [ ] **Step 1: Reproduce the frontend failure**

Run the narrowest available command from Task 1 again and isolate the file, route, component, or type causing the failure.

Expected: the failure is reproducible before editing.

- [ ] **Step 2: Apply the smallest frontend correction**

Update only the affected component, route, import, type, or configuration. Keep server/client boundaries and existing localized route conventions unchanged.

Expected: the original failing diagnostic is removed without changing unrelated page behavior.

- [ ] **Step 3: Re-run frontend lint and build**

```powershell
pnpm --filter @smartify/frontend lint
pnpm --filter @smartify/frontend build
```

Expected: both commands pass.

### Task 4: Perform final package-level verification

**Files:**
- Read: changed files from Tasks 2-3.
- Modify: none unless verification reveals a directly related regression.

**Interfaces:**
- Consumes: corrected backend and frontend packages.
- Produces: final verification results and a concise report of any environment-only blockers.

- [ ] **Step 1: Run the workspace test command**

```powershell
pnpm test
```

Expected: all existing tests pass.

- [ ] **Step 2: Run the workspace lint and build commands**

```powershell
pnpm lint
pnpm build
```

Expected: workspace checks pass; if a command is blocked by missing external services or credentials, report the exact blocker rather than adding fake credentials.

- [ ] **Step 3: Review the final diff for scope and secrets**

Inspect changed files and confirm no credentials, generated caches, unrelated refactors, or payment activation changes were introduced.

Expected: only the approved spec, plan, and directly related source/test fixes remain.
