import { BadRequestException } from "@nestjs/common";
import { AdminAIConfigService } from "./admin-ai-config.service";

/**
 * Covers the Phase 10 concurrency fix for provider activation: a single
 * atomic SQL UPDATE statement (not a read-then-write pair) is used so
 * two concurrent activations of different providers can't both end up
 * active. These tests confirm the raw-SQL path is used, not that real
 * Postgres concurrency was exercised (that guarantee comes from a single
 * UPDATE statement being inherently atomic in Postgres, which cannot be
 * demonstrated against a mocked client — see 10-phase10-decisions.md).
 */
describe("AdminAIConfigService.updateProvider — atomic activation", () => {
  function makePrismaMock() {
    return {
      client: {
        $executeRaw: jest.fn().mockResolvedValue(1),
        aIProviderConfig: {
          update: jest.fn().mockResolvedValue({ providerKey: "openai" }),
          findUnique: jest.fn().mockResolvedValue({ providerKey: "openai" }),
        },
      },
    } as any;
  }

  it("issues a single atomic UPDATE statement when activating a provider, rather than two separate calls", async () => {
    const prisma = makePrismaMock();
    const service = new AdminAIConfigService(prisma, {} as any);

    await service.updateProvider("openai", { isActive: true });

    expect(prisma.client.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("does not touch the isActive column via a separate updateMany/update call", async () => {
    const prisma = makePrismaMock();
    const service = new AdminAIConfigService(prisma, {} as any);

    await service.updateProvider("openai", { isActive: true });

    // The typed update() call, if made at all here, should only be for
    // non-isActive fields — isActive itself is handled exclusively by
    // the atomic raw statement above.
    if (prisma.client.aIProviderConfig.update.mock.calls.length > 0) {
      const updateData = prisma.client.aIProviderConfig.update.mock.calls[0][0].data;
      expect(updateData.isActive).toBeUndefined();
    }
  });

  it("skips the atomic UPDATE entirely when the change doesn't touch isActive (e.g. only updating cost rates)", async () => {
    const prisma = makePrismaMock();
    const service = new AdminAIConfigService(prisma, {} as any);

    await service.updateProvider("openai", { costPerInputToken: 0.0000002 });

    expect(prisma.client.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.client.aIProviderConfig.update).toHaveBeenCalledWith({
      where: { providerKey: "openai" },
      data: { costPerInputToken: 0.0000002 },
    });
  });
});

/**
 * Phase 9.4B — AI Spending Controls (B4-B7): the Admin Dashboard's budget
 * display and the SUPER_ADMIN editing endpoint, including the cross-field
 * "per-user <= global" rule that only this service (not the generic
 * system-config/:key PATCH, and not the zod schema alone) can enforce,
 * since it depends on the CURRENT value of the other field.
 */
describe("AdminAIConfigService — AI spending controls", () => {
  function makeService(systemConfigValues: Record<string, unknown> = {}, globalSpentTodayUsd = 0) {
    const store = { ...systemConfigValues };
    const prisma = {
      client: {
        systemConfig: {
          findUnique: jest.fn().mockImplementation(({ where: { key } }: any) =>
            Promise.resolve(key in store ? { key, value: store[key] } : null),
          ),
          upsert: jest.fn().mockImplementation(({ where: { key }, create }: any) => {
            store[key] = create.value;
            return Promise.resolve({ key, value: create.value });
          }),
        },
      },
    } as any;
    const usageService = {
      getGlobalSpendToday: jest.fn().mockResolvedValue(globalSpentTodayUsd),
      getGlobalCommittedUsdToday: jest.fn().mockResolvedValue(globalSpentTodayUsd),
    } as any;
    return { service: new AdminAIConfigService(prisma, usageService), prisma, store };
  }

  describe("getBudgetStatus", () => {
    it("reports null budgets and the default question limit when nothing has ever been configured", async () => {
      const { service } = makeService({});
      const status = await service.getBudgetStatus();
      expect(status.globalBudgetUsd).toBeNull();
      expect(status.perUserBudgetUsd).toBeNull();
      expect(status.dailyQuestionsPerSubject).toBe(10);
      expect(status.globalRemainingUsd).toBeNull();
    });

    it("computes remaining budget from the SAME today's-spend source the runtime circuit breaker uses", async () => {
      const { service, prisma } = makeService({ global_daily_ai_budget_usd: 5 }, 1.5);
      const status = await service.getBudgetStatus();
      expect(status.globalRemainingUsd).toBeCloseTo(3.5);
      expect(prisma.client.systemConfig.findUnique).toHaveBeenCalled();
    });

    it("never reports negative remaining budget when spend has exceeded the cap", async () => {
      const { service } = makeService({ global_daily_ai_budget_usd: 5 }, 7);
      const status = await service.getBudgetStatus();
      expect(status.globalRemainingUsd).toBe(0);
    });
  });

  describe("updateSpendingControls — validation", () => {
    it("rejects a per-user budget greater than the global budget", async () => {
      const { service } = makeService({ global_daily_ai_budget_usd: 5 });
      await expect(service.updateSpendingControls({ perUserDailyBudgetUsd: 10 })).rejects.toThrow(BadRequestException);
    });

    it("rejects setting a per-user budget when no global budget exists yet", async () => {
      const { service } = makeService({});
      await expect(service.updateSpendingControls({ perUserDailyBudgetUsd: 0.25 })).rejects.toThrow(BadRequestException);
    });

    it("rejects lowering the global budget below an already-configured per-user budget", async () => {
      const { service } = makeService({ global_daily_ai_budget_usd: 5, per_user_daily_ai_budget_usd: 1 });
      await expect(service.updateSpendingControls({ globalDailyBudgetUsd: 0.5 })).rejects.toThrow(BadRequestException);
    });

    it("accepts raising both together in the same call, even though per-user > the OLD global alone", async () => {
      const { service } = makeService({ global_daily_ai_budget_usd: 5, per_user_daily_ai_budget_usd: 1 });
      const result = await service.updateSpendingControls({ globalDailyBudgetUsd: 20, perUserDailyBudgetUsd: 10 });
      expect(result.globalBudgetUsd).toBe(20);
      expect(result.perUserBudgetUsd).toBe(10);
    });

    it("writes nothing to SystemConfig when validation fails", async () => {
      const { service, prisma } = makeService({ global_daily_ai_budget_usd: 5 });
      await expect(service.updateSpendingControls({ perUserDailyBudgetUsd: 10 })).rejects.toThrow();
      expect(prisma.client.systemConfig.upsert).not.toHaveBeenCalled();
    });
  });

  describe("updateSpendingControls — persistence and re-read behavior", () => {
    it("persists the owner-approved Phase 9.4B initial values", async () => {
      const { service, store } = makeService({});
      await service.updateSpendingControls({ globalDailyBudgetUsd: 5, perUserDailyBudgetUsd: 0.25, dailyQuestionsPerSubject: 10 });
      expect(store.global_daily_ai_budget_usd).toBe(5);
      expect(store.per_user_daily_ai_budget_usd).toBe(0.25);
      expect(store.default_daily_ai_questions_per_subject).toBe(10);
    });

    it("a subsequent getBudgetStatus call reflects the just-written values (no stale caching)", async () => {
      const { service } = makeService({});
      await service.updateSpendingControls({ globalDailyBudgetUsd: 8 });
      const status = await service.getBudgetStatus();
      expect(status.globalBudgetUsd).toBe(8);
    });
  });
});

/**
 * Admin AI Cost / Budget Dashboard (2026-09-20) — read-only aggregation
 * over the EXISTING AIUsage ledger. The split between student-runtime and
 * platform content-authoring spend is exactly AIUsage.studentId being set
 * vs null (never a hardcoded feature-name list), matching every real
 * content-authoring call site in this codebase (which always passes
 * studentId: null for CONTENT_AUTHORING_ACTOR_ID-billed rows).
 */
describe("AdminAIConfigService — AI Cost / Budget Dashboard", () => {
  function makeService(opts: { aiUsage?: any[]; perUserBudgetUsd?: number | null; studentProfiles?: any[]; subjects?: any[] } = {}) {
    const prisma = {
      client: {
        aIUsage: { findMany: jest.fn().mockResolvedValue(opts.aiUsage ?? []) },
        systemConfig: {
          findUnique: jest.fn().mockImplementation(({ where: { key } }: any) =>
            key === "per_user_daily_ai_budget_usd" && opts.perUserBudgetUsd !== undefined
              ? Promise.resolve(opts.perUserBudgetUsd === null ? null : { key, value: opts.perUserBudgetUsd })
              : Promise.resolve(null),
          ),
        },
        studentProfile: { findMany: jest.fn().mockResolvedValue(opts.studentProfiles ?? []) },
        subject: { findMany: jest.fn().mockResolvedValue(opts.subjects ?? []) },
      },
    } as any;
    return { service: new AdminAIConfigService(prisma, {} as any), prisma };
  }

  describe("getCostOverview", () => {
    it("splits today's and this month's spend into student-runtime vs platform content-authoring, using studentId as the discriminator", async () => {
      const { service } = makeService({
        aiUsage: [
          { costUsd: 1.5, studentId: "student-1" }, // real student (Lesson/Tutor/TTS)
          { costUsd: 0.5, studentId: null }, // platform content-authoring (grounding/TOC/generation)
          { costUsd: 2, studentId: "student-2" },
        ],
      });
      const overview = await service.getCostOverview();
      expect(overview.today).toEqual({ totalUsd: 4, studentRuntimeUsd: 3.5, platformAuthoringUsd: 0.5 });
      expect(overview.month).toEqual({ totalUsd: 4, studentRuntimeUsd: 3.5, platformAuthoringUsd: 0.5 });
    });

    it("reports all zeros when there is no usage at all", async () => {
      const { service } = makeService({ aiUsage: [] });
      const overview = await service.getCostOverview();
      expect(overview.today).toEqual({ totalUsd: 0, studentRuntimeUsd: 0, platformAuthoringUsd: 0 });
    });
  });

  describe("listStudentSpend", () => {
    it("aggregates real spend per student and computes remaining budget against the shared per-user cap", async () => {
      const { service } = makeService({
        aiUsage: [
          { userId: "user-1", studentId: "student-1", costUsd: 0.1 },
          { userId: "user-1", studentId: "student-1", costUsd: 0.05 },
          { userId: "user-2", studentId: "student-2", costUsd: 0.3 },
        ],
        perUserBudgetUsd: 0.25,
        studentProfiles: [
          { id: "student-1", fullName: "Alice", user: { email: "alice@test.com" } },
          { id: "student-2", fullName: "Bob", user: { email: "bob@test.com" } },
        ],
      });

      const result = await service.listStudentSpend();

      const alice = result.find((r) => r.studentId === "student-1")!;
      expect(alice.todayUsd).toBeCloseTo(0.15);
      expect(alice.windowUsd).toBeCloseTo(0.15);
      expect(alice.fullName).toBe("Alice");
      expect(alice.remainingTodayUsd).toBeCloseTo(0.1); // 0.25 - 0.15

      const bob = result.find((r) => r.studentId === "student-2")!;
      // Bob's spend (0.3) exceeds the per-user cap (0.25) — remaining floors at 0, never negative.
      expect(bob.remainingTodayUsd).toBe(0);
    });

    it("reports remainingTodayUsd as null when no global per-user budget is configured — never a guessed limit", async () => {
      const { service } = makeService({
        aiUsage: [{ userId: "user-1", studentId: "student-1", costUsd: 0.1 }],
        perUserBudgetUsd: null,
        studentProfiles: [{ id: "student-1", fullName: "Alice", user: { email: "alice@test.com" } }],
      });
      const result = await service.listStudentSpend();
      expect(result[0].perUserBudgetUsd).toBeNull();
      expect(result[0].remainingTodayUsd).toBeNull();
    });

    it("sorts students by window spend, highest first", async () => {
      const { service } = makeService({
        aiUsage: [
          { userId: "user-1", studentId: "student-1", costUsd: 0.05 },
          { userId: "user-2", studentId: "student-2", costUsd: 0.5 },
        ],
        studentProfiles: [
          { id: "student-1", fullName: "Alice", user: { email: "a@test.com" } },
          { id: "student-2", fullName: "Bob", user: { email: "b@test.com" } },
        ],
      });
      const result = await service.listStudentSpend();
      expect(result.map((r) => r.studentId)).toEqual(["student-2", "student-1"]);
    });

    it("returns an empty list when no student has any AI usage", async () => {
      const { service } = makeService({ aiUsage: [] });
      expect(await service.listStudentSpend()).toEqual([]);
    });
  });

  describe("getStudentSpendDetail", () => {
    it("groups a student's spend by Subject, then by feature within each Subject", async () => {
      const { service } = makeService({
        aiUsage: [
          { subjectId: "math", feature: "lesson_chat", costUsd: 0.4 },
          { subjectId: "math", feature: "tutor_chat", costUsd: 0.1 },
          { subjectId: "science", feature: "tutor_tts", costUsd: 0.2 },
        ],
        subjects: [{ id: "math", nameEn: "Math", nameAr: "رياضيات" }, { id: "science", nameEn: "Science", nameAr: "علوم" }],
      });

      const detail = await service.getStudentSpendDetail("student-1");

      expect(detail.totalUsd).toBeCloseTo(0.7);
      const math = detail.bySubject.find((s) => s.subjectId === "math")!;
      expect(math.subjectNameEn).toBe("Math");
      expect(math.costUsd).toBeCloseTo(0.5);
      expect(math.byFeature).toEqual({ lesson_chat: 0.4, tutor_chat: 0.1 });
      const science = detail.bySubject.find((s) => s.subjectId === "science")!;
      expect(science.byFeature).toEqual({ tutor_tts: 0.2 });
    });

    it("groups rows with no subjectId (e.g. a gap in older data) under a distinct '(no subject)' bucket rather than crashing or merging incorrectly", async () => {
      const { service } = makeService({ aiUsage: [{ subjectId: null, feature: "tutor_chat", costUsd: 0.2 }] });

      const detail = await service.getStudentSpendDetail("student-1");
      expect(detail.bySubject).toHaveLength(1);
      expect(detail.bySubject[0].subjectId).toBeNull();
      expect(detail.bySubject[0].subjectNameEn).toBe("(no subject)");
    });

    it("scopes the query to exactly this student — platform content-authoring rows (studentId null) can never leak in", async () => {
      const { service, prisma } = makeService({ aiUsage: [{ subjectId: "math", feature: "lesson_chat", costUsd: 0.3 }] });

      await service.getStudentSpendDetail("student-1");

      expect(prisma.client.aIUsage.findMany.mock.calls[0][0].where.studentId).toBe("student-1");
    });
  });
});
