/**
 * Phase 9.4D: real-PostgreSQL integration test for the atomic USD budget
 * reservation primitives. Every other test in this codebase (including
 * ai-budget-reservation.spec.ts) runs against a mocked Prisma client —
 * useful for decision-logic coverage, but it can only ever SIMULATE
 * Postgres's atomicity guarantee, never prove it. This file proves it,
 * against the real database.
 *
 * Excluded from the default `npx jest` run (see jest.config.js's
 * testPathIgnorePatterns) so the rest of the suite keeps requiring zero
 * database connection — run this file explicitly via
 * `pnpm test:postgres-integration` (from apps/backend).
 *
 * SAFETY — this project has no separate isolated test database (see the
 * Phase 9.4D report for that finding), so this connects to the SAME
 * native Postgres database the app uses. To stay safe against that live,
 * shared database:
 *  - Every row this file writes is tagged with an unmistakable
 *    test-only prefix ("phase94d-pg-test-...") for scope/scopeKey/userId
 *    that can never collide with the real 'global'/'global' accumulator
 *    row or any real user. attemptReservation()/adjustCounterRow() take
 *    scope/scopeKey as parameters specifically so this is possible
 *    without ever touching real budget-enforcement state.
 *  - The idempotency test proves the exact
 *    `UPDATE ... WHERE status = 'RESERVED' ... RETURNING` guard
 *    reconcileBudget()/releaseBudget() rely on, applied directly to a
 *    manually-created, test-only AIBudgetReservation row — not by
 *    calling those public methods, which would also adjust the live
 *    global accumulator via adjustBudgetCounters().
 *  - Every row created here is deleted in afterAll(), scoped precisely
 *    by the test-only prefix — never a broad DELETE.
 *  - Target host/database are validated before connecting, mirroring
 *    backup-guard.ts's own safety check.
 *  - No QA user, StudentProfile, Question, QuestionDraft, AIUsage, or
 *    SystemConfig row is ever read or written by this file.
 */
import * as path from "node:path";
import * as dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@smartify/database";
import { AIUsageService } from "./ai-usage.service";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ALLOWED_DATABASE = "smartify";
// A run-specific namespace keeps parallel timezone runs and their cleanup apart.
const TEST_PREFIX = `phase94d-pg-test-${randomUUID()}-`;

function assertSafeTarget(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set — refusing to run the PostgreSQL integration test against an unknown target.");
  }
  const parsed = new URL(databaseUrl);
  if ((parsed.port || "5432") !== "5432") {
    throw new Error("Only native PostgreSQL on port 5432 is allowed.");
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Refusing to run against unexpected host "${parsed.hostname}" — only ${[...ALLOWED_HOSTS].join(", ")} are allowed.`);
  }
  const database = parsed.pathname.replace(/^\//, "").split("?")[0];
  if (database.toLowerCase() !== ALLOWED_DATABASE) {
    throw new Error(`Refusing to run against unexpected database "${database}" — expected "${ALLOWED_DATABASE}".`);
  }
}

function todayUtcMidnight(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

describe("AIUsageService — Phase 9.4D real PostgreSQL concurrency integration test", () => {
  let prisma: PrismaClient;
  let service: AIUsageService;

  beforeAll(async () => {
    assertSafeTarget();
    prisma = new PrismaClient();
    await prisma.$connect();
    const prismaServiceLike = { client: prisma } as any;
    // No real provider rates are ever needed — attemptReservation/
    // adjustCounterRow never call the provider factory, and this file
    // never calls estimateMaxChatCostUsd. The stub has no method capable
    // of reaching a real provider, so there is nothing in this file that
    // COULD make a real OpenAI/TTS/image/payment call, by construction.
    const providerFactoryStub = {} as any;
    service = new AIUsageService(prismaServiceLike, providerFactoryStub);
  });

  afterAll(async () => {
    // Bounded, precisely-scoped cleanup — only rows this file could
    // possibly have created, identified by the unmistakable test prefix.
    // Never a broad DELETE; never touches QA/AIUsage/real budget rows.
    await prisma.aIDailyBudgetCounter.deleteMany({ where: { scopeKey: { startsWith: TEST_PREFIX } } });
    await prisma.aIBudgetReservation.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.aIDailyUsageCounter.deleteMany({ where: { studentId: { startsWith: TEST_PREFIX } } });
    expect(await prisma.aIDailyBudgetCounter.count({ where: { scopeKey: { startsWith: TEST_PREFIX } } })).toBe(0);
    expect(await prisma.aIBudgetReservation.count({ where: { userId: { startsWith: TEST_PREFIX } } })).toBe(0);
    expect(await prisma.aIDailyUsageCounter.count({ where: { studentId: { startsWith: TEST_PREFIX } } })).toBe(0);
    await prisma.$disconnect();
  });

  it("concurrent quota reservations keep the same student/subject/day cap and ORM count", async () => {
    // No foreign keys on AIDailyUsageCounter: these identifiers cannot refer
    // to a QA/real student. Only the config lookup is stubbed; all quota SQL
    // and ORM reads run against PostgreSQL on separate pool connections.
    const quota = new AIUsageService({ client: {
      systemConfig: { findUnique: async () => ({ value: 3 }) },
      $queryRaw: prisma.$queryRaw.bind(prisma),
      aIDailyUsageCounter: prisma.aIDailyUsageCounter,
    } } as any, {} as any);
    const studentId = `${TEST_PREFIX}student`;
    const subjectId = `${TEST_PREFIX}subject`;
    const results = await Promise.all(Array.from({ length: 12 }, () => quota.reserveDailySlot(studentId, subjectId)));
    expect(results.filter(result => result.reserved)).toHaveLength(3);
    expect(await quota.getRemainingToday(studentId, subjectId)).toEqual({ used: 3, limit: 3, remaining: 0 });
    expect(await quota.getRemainingToday(studentId, `${subjectId}-other`)).toEqual({ used: 0, limit: 3, remaining: 3 });
  });

  /** Phase 9.4E: ORM reads must now agree with the raw-SQL atomic writes. */
  async function readCommittedUsd(scope: string, scopeKey: string, usageDate: Date): Promise<number | null> {
    const row = await prisma.aIDailyBudgetCounter.findUnique({
      where: { scope_scopeKey_usageDate: { scope, scopeKey, usageDate } },
    });
    return row ? Number(row.committedUsd) : null;
  }

  it("Objective 1, requirement 1: two concurrent requests competing for the same GLOBAL-shaped budget row produce exactly one successful reservation", async () => {
    const scope = `${TEST_PREFIX}global-scope`;
    const scopeKey = `${TEST_PREFIX}global-${randomUUID()}`;
    const usageDate = todayUtcMidnight();
    const limit = 5; // test-only limit — unrelated to, and never touches, the real $5 live global cap

    const [a, b] = await Promise.all([
      (service as any).attemptReservation(scope, scopeKey, usageDate, 3, limit),
      (service as any).attemptReservation(scope, scopeKey, usageDate, 3, limit),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1); // $3 + $3 = $6 > $5 — only one can fit

    expect(await readCommittedUsd(scope, scopeKey, usageDate)).toBe(3); // exactly one $3 reservation committed — never $6, never $0
  });

  it("Objective 1, requirement 2: two concurrent requests for the same user produce exactly one successful reservation when the per-user budget permits only one", async () => {
    const scopeKey = `${TEST_PREFIX}user-${randomUUID()}`;
    const usageDate = todayUtcMidnight();
    const limit = 0.25; // mirrors the real per-user cap's shape, on a fully test-isolated key

    const [a, b] = await Promise.all([
      (service as any).attemptReservation("user", scopeKey, usageDate, 0.2, limit),
      (service as any).attemptReservation("user", scopeKey, usageDate, 0.2, limit),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1); // $0.20 + $0.20 = $0.40 > $0.25 — only one can fit

    expect(await readCommittedUsd("user", scopeKey, usageDate)).toBe(0.2);
  });

  it("Objective 1, requirement 1b: a SINGLE first-ever request whose estimate alone exceeds the limit is rejected (regression test for the real bug this phase found and fixed)", async () => {
    const scope = `${TEST_PREFIX}global-scope`;
    const scopeKey = `${TEST_PREFIX}global-${randomUUID()}`;
    const usageDate = todayUtcMidnight();

    const ok = await (service as any).attemptReservation(scope, scopeKey, usageDate, 1, 0.5); // $1 estimate, $0.5 limit, brand-new row
    expect(ok).toBe(false);
    // The accumulator row now always springs into existence at 0 (step 1's
    // idempotent "ensure exists"), even for a rejected attempt — that's a
    // harmless side effect of the fix, not a reservation. The guarantee
    // under test is that it's exactly 0, never 1.
    expect(await readCommittedUsd(scope, scopeKey, usageDate)).toBe(0);
  });

  it("Objective 1, requirement 3: a failed per-user reservation rolls back only the global-shaped reservation created by that SAME request", async () => {
    // Replays reserveBudget()'s exact sequence — same private methods,
    // same order, same rollback-on-user-failure call — against fully
    // test-isolated keys, so the real interaction logic is proven without
    // ever touching the real 'global'/'global' row.
    const globalScope = `${TEST_PREFIX}global-scope`;
    const globalScopeKey = `${TEST_PREFIX}global-${randomUUID()}`;
    const userScopeKey = `${TEST_PREFIX}user-${randomUUID()}`;
    const usageDate = todayUtcMidnight();
    const estimatedUsd = 1;

    const globalOk = await (service as any).attemptReservation(globalScope, globalScopeKey, usageDate, estimatedUsd, 100);
    expect(globalOk).toBe(true);

    const userOk = await (service as any).attemptReservation("user", userScopeKey, usageDate, estimatedUsd, 0.5); // limit too small for estimatedUsd=1
    expect(userOk).toBe(false);

    if (!userOk) {
      await (service as any).adjustCounterRow(globalScope, globalScopeKey, usageDate, -estimatedUsd);
    }

    expect(await readCommittedUsd(globalScope, globalScopeKey, usageDate)).toBe(0); // rolled back to exactly zero (row exists, from the earlier successful reservation + its own rollback)
    // The user row also springs into existence at 0 from step 1's
    // "ensure exists" even though its reservation attempt was rejected —
    // same harmless side effect as above. The guarantee is 0, not $1.
    expect(await readCommittedUsd("user", userScopeKey, usageDate)).toBe(0);
  });

  it("Objective 1, requirement 4: double release remains idempotent — the same UPDATE...WHERE status='RESERVED'...RETURNING guard releaseBudget() uses, against a manually-created test-only reservation", async () => {
    const testUserId = `${TEST_PREFIX}idempotency-release-${randomUUID()}`;
    const usageDate = todayUtcMidnight();
    const reservation = await prisma.aIBudgetReservation.create({
      data: { userId: testUserId, usageDate, estimatedUsd: 0.01, status: "RESERVED" },
    });

    const first = await prisma.$queryRaw<Array<{ estimatedUsd: unknown }>>`
      UPDATE "AIBudgetReservation"
      SET "status" = 'RELEASED', "updatedAt" = now()
      WHERE "id" = ${reservation.id} AND "status" = 'RESERVED'
      RETURNING "estimatedUsd";
    `;
    expect(first).toHaveLength(1);

    const second = await prisma.$queryRaw<Array<{ estimatedUsd: unknown }>>`
      UPDATE "AIBudgetReservation"
      SET "status" = 'RELEASED', "updatedAt" = now()
      WHERE "id" = ${reservation.id} AND "status" = 'RESERVED'
      RETURNING "estimatedUsd";
    `;
    expect(second).toHaveLength(0); // already RELEASED — the guard correctly excludes the second attempt

    const finalRow = await prisma.aIBudgetReservation.findUnique({ where: { id: reservation.id } });
    expect(finalRow?.status).toBe("RELEASED");
  });

  it("Objective 1, requirement 4: double reconciliation remains idempotent — the same guard reconcileBudget() uses", async () => {
    const testUserId = `${TEST_PREFIX}idempotency-reconcile-${randomUUID()}`;
    const usageDate = todayUtcMidnight();
    const reservation = await prisma.aIBudgetReservation.create({
      data: { userId: testUserId, usageDate, estimatedUsd: 0.01, status: "RESERVED" },
    });

    const first = await prisma.$queryRaw<Array<{ estimatedUsd: unknown }>>`
      UPDATE "AIBudgetReservation"
      SET "status" = 'RECONCILED', "reconciledUsd" = 0.003, "updatedAt" = now()
      WHERE "id" = ${reservation.id} AND "status" = 'RESERVED'
      RETURNING "estimatedUsd";
    `;
    expect(first).toHaveLength(1);

    const second = await prisma.$queryRaw<Array<{ estimatedUsd: unknown }>>`
      UPDATE "AIBudgetReservation"
      SET "status" = 'RECONCILED', "reconciledUsd" = 0.003, "updatedAt" = now()
      WHERE "id" = ${reservation.id} AND "status" = 'RESERVED'
      RETURNING "estimatedUsd";
    `;
    expect(second).toHaveLength(0);

    const finalRow = await prisma.aIBudgetReservation.findUnique({ where: { id: reservation.id } });
    expect(finalRow?.status).toBe("RECONCILED");
    expect(Number(finalRow?.reconciledUsd)).toBe(0.003); // written once by the first call, never overwritten by the second
  });

  it("Objective 1, requirement 5: nothing in this file is capable of a real AI/provider call", () => {
    // The providerFactory stub passed to AIUsageService above has no
    // methods at all — attemptReservation/adjustCounterRow never call it,
    // and this file never imports an AIProvider, calls .generate()/
    // .synthesize(), or references OPENAI_API_KEY. There is nothing here
    // that could reach a real provider, by construction, not just by
    // not-having-been-called.
    expect(Object.keys((service as any).providerFactory)).toHaveLength(0);
  });
});
