/**
 * Real SQL/ORM round trips without modifying any public table.
 * Prisma explicitly targets pg_temp; raw queries see only pg_temp.
 * All tables/rows are connection-local TEMP objects inside a transaction
 * that ALWAYS rolls back. No migrations, public inserts or cleanup deletes.
 * Run explicitly with TZ=UTC and TZ=Africa/Cairo; default Jest excludes it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
import { PrismaClient, Prisma } from "@smartify/database";
import { AIUsageService } from "./ai-usage.service";
import { TutorQuestionPacksService } from "../../tutor-question-packs/tutor-question-packs.service";

const rollback = new Error("rollback temporary timezone fixtures");
const tables = ["SystemConfig", "AIUsage", "AIDailyUsageCounter", "AIDailyBudgetCounter", "AIBudgetReservation", "TutorExtraQuestionCredit"];
let prisma: PrismaClient;

beforeAll(() => {
  const env = dotenv.parse(fs.readFileSync(path.resolve(__dirname, "../../../.env")));
  const url = new URL(env.DATABASE_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || (url.port || "5432") !== "5432" || url.pathname !== "/smartify") {
    throw new Error("Timezone tests require the approved localhost:5432/smartify target");
  }
  url.searchParams.set("schema", "pg_temp");
  prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
});
afterAll(async () => { await prisma?.$disconnect(); });
afterEach(() => jest.useRealTimers());

function at(instant: string) {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "hrtime", "performance"] });
  jest.setSystemTime(new Date(instant));
}

async function isolated(zone: string, test: (tx: Prisma.TransactionClient, service: AIUsageService) => Promise<void>) {
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL search_path = pg_temp");
      await tx.$queryRaw`SELECT set_config('TimeZone', ${zone}, true)`;
      for (const table of tables) {
        await tx.$executeRawUnsafe(`CREATE TEMP TABLE "${table}" (LIKE public."${table}" INCLUDING ALL) ON COMMIT DROP`);
      }
      // Prisma qualifies enum casts with its configured schema as well.
      // This temporary domain accepts the existing enum without changing it.
      await tx.$executeRawUnsafe('CREATE DOMAIN pg_temp."AIBudgetReservationStatus" AS public."AIBudgetReservationStatus"');
      // Fail closed before exercising production code if any table isn't temporary.
      const resolved = await tx.$queryRaw<Array<{ relname: string; relpersistence: string }>>`
        SELECT relname, relpersistence::text FROM pg_class
        WHERE relnamespace = pg_my_temp_schema() AND relkind = 'r'
      `;
      expect(resolved.filter(r => tables.includes(r.relname) && r.relpersistence === "t")).toHaveLength(tables.length);
      await tx.systemConfig.createMany({ data: [
        { key: "default_daily_ai_questions_per_subject", value: 2 },
        { key: "global_daily_ai_budget_usd", value: 5 },
        { key: "per_user_daily_ai_budget_usd", value: 0.25 },
      ] });
      await test(tx, new AIUsageService({ client: tx } as any, {} as any));
      throw rollback;
    }, { timeout: 30000 });
  } catch (error) { if (error !== rollback) throw error; }
}

describe.each(["UTC", "Africa/Cairo"])("SQL/ORM date consistency with database timezone %s", zone => {
  it("consumes and refunds extra credits on their original day across midnight", async () => {
    at("2026-09-15T23:59:59.999Z");
    await isolated(zone, async (tx, service) => {
      const packs = new TutorQuestionPacksService({ client: tx } as any, service, {} as any);
      await tx.tutorExtraQuestionCredit.createMany({ data: [
        { studentId: "student", subjectId: "subject", purchaseId: "test-purchase", usageDate: new Date("2026-09-15T00:00:00.000Z"), remaining: 2 },
        { studentId: "student", subjectId: "subject", purchaseId: "test-purchase", usageDate: new Date("2026-09-16T00:00:00.000Z"), remaining: 2 },
      ] });
      await service.reserveDailySlot("student", "subject");
      await service.reserveDailySlot("student", "subject");
      const reservation = await packs.consumeForTutor("student", "subject");
      expect(reservation.source).toBe("extra");
      jest.setSystemTime(new Date("2026-09-16T00:00:00.000Z"));
      await packs.refundExtraCredit("student", "subject", reservation.usageDate);
      expect((await tx.tutorExtraQuestionCredit.findMany({ orderBy: { usageDate: "asc" } })).map(row => row.remaining)).toEqual([2, 2]);
    });
  });

  it("reads a reserved quota through ORM, preserves scoping and handles empty/zero counters", async () => {
    at("2026-09-15T23:59:59.999Z");
    await isolated(zone, async (tx, service) => {
      expect(await service.getRemainingToday("student", "subject")).toEqual({ used: 0, limit: 2, remaining: 2 });
      expect(await service.reserveDailySlot("student", "subject")).toEqual({ reserved: true, limit: 2 });
      expect(await service.getRemainingToday("student", "subject")).toEqual({ used: 1, limit: 2, remaining: 1 });
      expect(await service.getRemainingToday("other-student", "subject")).toMatchObject({ used: 0 });
      expect(await service.getRemainingToday("student", "other-subject")).toMatchObject({ used: 0 });
      expect((await tx.aIDailyUsageCounter.findFirstOrThrow()).usageDate.toISOString()).toBe("2026-09-15T00:00:00.000Z");
      await service.releaseDailySlot("student", "subject");
      expect(await service.getRemainingToday("student", "subject")).toMatchObject({ used: 0, remaining: 2 });
      await service.reserveDailySlot("student", "subject");
      jest.setSystemTime(new Date("2026-09-16T00:00:00.000Z"));
      expect(await service.getRemainingToday("student", "subject")).toMatchObject({ used: 0 });
      await service.reserveDailySlot("student", "subject");
      expect(await tx.aIDailyUsageCounter.count()).toBe(2);
      expect(await service.getRemainingToday("student", "subject")).toMatchObject({ used: 1 });
      await (service as any).releaseDailySlot("student", "subject", new Date("2026-09-15T00:00:00.000Z"));
      expect(await service.getRemainingToday("student", "subject")).toMatchObject({ used: 1 });
      expect((await tx.aIDailyUsageCounter.findFirstOrThrow({ where: { usageDate: new Date("2026-09-15T00:00:00.000Z") } })).count).toBe(0);
    });
  });

  it.each(["reconcile", "release"])("%s adjusts the original budget day after midnight exactly once", async action => {
    at("2026-09-15T23:59:59.999Z");
    await isolated(zone, async (tx, service) => {
      expect(await service.getGlobalCommittedUsdToday()).toBe(0);
      const result = await service.reserveBudget("user", 0.2);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected reservation");
      expect(await service.getGlobalCommittedUsdToday()).toBe(0.2);
      const reservation = await tx.aIBudgetReservation.findUniqueOrThrow({ where: { id: result.reservationId } });
      expect(reservation.usageDate.toISOString()).toBe("2026-09-15T00:00:00.000Z");
      const counters = await tx.aIDailyBudgetCounter.findMany();
      expect(counters).toHaveLength(2);
      for (const row of counters) expect(row.usageDate.toISOString()).toBe("2026-09-15T00:00:00.000Z");
      jest.setSystemTime(new Date("2026-09-16T00:00:00.000Z"));
      expect(await service.reserveBudget("user", 0.1)).toMatchObject({ ok: true });
      for (let i = 0; i < 2; i++) {
        if (action === "reconcile") await service.reconcileBudget(result.reservationId, 0.05);
        else await service.releaseBudget(result.reservationId);
      }
      for (const row of await tx.aIDailyBudgetCounter.findMany({ where: { usageDate: new Date("2026-09-15T00:00:00.000Z") } })) {
        expect(Number(row.committedUsd)).toBe(action === "reconcile" ? 0.05 : 0);
      }
      expect(await tx.aIDailyBudgetCounter.count({ where: { usageDate: new Date("2026-09-15T00:00:00.000Z") } })).toBe(2);
      expect(await service.getGlobalCommittedUsdToday()).toBe(0.1);
      expect((await tx.aIBudgetReservation.findUniqueOrThrow({ where: { id: result.reservationId } })).status).toBe(action === "reconcile" ? "RECONCILED" : "RELEASED");
    });
  });
});
