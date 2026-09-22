import { AIUsageService } from "./ai-usage.service";
import { TutorQuestionPacksService } from "../../tutor-question-packs/tutor-question-packs.service";
import { InteractiveLessonService } from "../../interactive-lesson/interactive-lesson.service";

// Run this file in separate processes with TZ=UTC and TZ=Africa/Cairo.
// Expectations are UTC calendar dates, independent of the host's timezone/DST.
describe("daily AI UTC boundaries", () => {
  afterEach(() => jest.useRealTimers());

  it("checks both spend limits against the same UTC day if config reads cross midnight", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-15T23:59:59.999Z"));
    const aggregate = jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } });
    const client = {
      systemConfig: { findUnique: jest.fn(async () => {
        jest.setSystemTime(new Date("2026-09-16T00:00:00.000Z"));
        return { value: 5 };
      }) },
      aIUsage: { aggregate },
    };
    await new AIUsageService({ client } as any, {} as any).assertWithinBudget("user");
    expect(aggregate).toHaveBeenCalledTimes(2);
    for (const [query] of aggregate.mock.calls) expect(query.where.createdAt.gte.toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  it.each([true, false])("keeps the quota day when the daily allowance lookup crosses midnight (daily=%s)", async reserved => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-15T23:59:59.999Z"));
    const usage = { reserveDailySlot: jest.fn(async () => {
      jest.setSystemTime(new Date("2026-09-16T00:00:00.000Z"));
      return { reserved, limit: 10 };
    }) };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const packs = new TutorQuestionPacksService({ client: { tutorExtraQuestionCredit: { updateMany } } } as any, usage as any, {} as any);
    const reservation = await packs.consumeForTutor("student", "subject");
    expect(reservation).toEqual({ source: reserved ? "daily" : "extra", limit: 10, usageDate: new Date("2026-09-15T00:00:00.000Z") });
    expect(usage.reserveDailySlot).toHaveBeenCalledWith("student", "subject", new Date("2026-09-15T00:00:00.000Z"));
    if (!reserved) expect(updateMany.mock.calls[0][0].where.usageDate.toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  it.each(["daily", "extra"])("lesson failure refunds the original %s day after midnight", async source => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-16T00:00:00.000Z"));
    const refund = jest.fn().mockResolvedValue(undefined);
    const service = new InteractiveLessonService({} as any, {} as any, {} as any,
      { releaseDailySlot: refund } as any, { refundExtraCredit: refund } as any, {} as any, {} as any, {} as any);
    await (service as any).releaseEntitlement({ id: "student" }, "subject", { source, usageDate: new Date("2026-09-15T00:00:00.000Z") });
    expect(refund).toHaveBeenCalledWith("student", "subject", new Date("2026-09-15T00:00:00.000Z"));
  });

  it("keeps an extra-credit upsert on one day when awaiting the purchase update crosses midnight", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-15T23:59:59.999Z"));
    const upsert = jest.fn().mockResolvedValue({});
    const tx = {
      tutorQuestionPackPurchase: { updateMany: jest.fn(async () => {
        jest.setSystemTime(new Date("2026-09-16T00:00:00.000Z"));
        return { count: 1 };
      }) },
      tutorExtraQuestionCredit: { upsert },
    };
    const client = {
      tutorQuestionPackPurchase: { findUnique: jest.fn().mockResolvedValue({ id: "purchase", status: "pending", amountEGP: 50, quantity: 10, studentId: "student", subjectId: "subject" }) },
      $transaction: (fn: (value: typeof tx) => unknown) => fn(tx),
    };
    const packs = new TutorQuestionPacksService({ client } as any, {} as any, {} as any);
    await packs.applyPaidPurchase("test", "purchase", "event");
    expect(upsert.mock.calls[0][0].where.studentId_subjectId_usageDate.usageDate.toISOString()).toBe("2026-09-15T00:00:00.000Z");
    expect(upsert.mock.calls[0][0].create.usageDate.toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  it.each([
    ["2026-09-15T23:59:59.999Z", "2026-09-15T00:00:00.000Z"],
    ["2026-09-16T00:00:00.000Z", "2026-09-16T00:00:00.000Z"],
    ["2026-09-15T21:00:00.000Z", "2026-09-15T00:00:00.000Z"],
    ["2026-01-15T22:00:00.000Z", "2026-01-15T00:00:00.000Z"],
    ["2026-04-23T22:00:00.000Z", "2026-04-23T00:00:00.000Z"],
    ["2026-10-29T21:00:00.000Z", "2026-10-29T00:00:00.000Z"],
  ])("uses one UTC day for quotas, extra credits and spend at %s", async (now, day) => {
    jest.useFakeTimers().setSystemTime(new Date(now));
    const client = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      aIDailyUsageCounter: { findUnique: jest.fn().mockResolvedValue(null) },
      aIUsage: { aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: null } }) },
      studentProfile: { findUnique: jest.fn().mockResolvedValue({ id: "student", subjects: [{ subjectId: "subject" }] }) },
      tutorExtraQuestionCredit: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const usage = new AIUsageService({ client } as any, {} as any);
    const packs = new TutorQuestionPacksService({ client } as any, usage, {} as any);
    expect(await packs.getRemaining("user", "subject")).toMatchObject({ dailyRemaining: 10, extraRemaining: 0, totalRemaining: 10 });
    const key = { studentId: "student", subjectId: "subject", usageDate: new Date(day) };
    expect(client.aIDailyUsageCounter.findUnique).toHaveBeenCalledWith({ where: { studentId_subjectId_usageDate: key } });
    expect(client.tutorExtraQuestionCredit.findUnique).toHaveBeenCalledWith({ where: { studentId_subjectId_usageDate: key } });
    expect(await usage.getGlobalSpendToday()).toBe(0);
    expect(await usage.getUserSpendToday("user")).toBe(0);
    expect(client.aIUsage.aggregate).toHaveBeenNthCalledWith(1, { where: { createdAt: { gte: new Date(day) } }, _sum: { costUsd: true } });
    expect(client.aIUsage.aggregate).toHaveBeenNthCalledWith(2, { where: { userId: "user", createdAt: { gte: new Date(day) } }, _sum: { costUsd: true } });
  });
});
