import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AIUsageService } from "../../ai/usage/ai-usage.service";
import { GLOBAL_DAILY_AI_BUDGET_USD_KEY, PER_USER_DAILY_AI_BUDGET_USD_KEY, PLATFORM_CONTENT_AUTHORING_DAILY_AI_BUDGET_USD_KEY, parseBudgetUsd } from "../../ai/usage/budget-config.util";
import type { UpdateAISpendingControlsInput } from "@smartify/validation";

const GLOBAL_BUDGET_KEY = GLOBAL_DAILY_AI_BUDGET_USD_KEY;
const PER_USER_BUDGET_KEY = PER_USER_DAILY_AI_BUDGET_USD_KEY;
const PLATFORM_BUDGET_KEY = PLATFORM_CONTENT_AUTHORING_DAILY_AI_BUDGET_USD_KEY;
const DAILY_QUESTIONS_KEY = "default_daily_ai_questions_per_subject";
const DEFAULT_DAILY_QUESTIONS = 10;

@Injectable()
export class AdminAIConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usageService: AIUsageService,
  ) {}

  listProviders() {
    return this.prisma.client.aIProviderConfig.findMany();
  }

  async updateProvider(
    providerKey: string,
    data: { model?: string; isActive?: boolean; costPerInputToken?: number; costPerOutputToken?: number },
  ) {
    // Phase 10 concurrency fix: the previous implementation did
    // updateMany(deactivate others) THEN update(activate target) inside a
    // transaction — but two concurrent activations of two DIFFERENT
    // providers could each run their own "deactivate everyone else" step
    // and, depending on commit ordering, leave BOTH providers active
    // (each transaction's updateMany would undo the other's activation,
    // but only if it ran first — the actual outcome is order-dependent
    // and not safely predictable under READ COMMITTED). A single UPDATE
    // statement that sets every row's isActive based on a comparison
    // against the target key is atomic by construction — one SQL
    // statement, one indivisible operation — so there is no window where
    // two providers can end up simultaneously active.
    if (data.isActive) {
      await this.prisma.client.$executeRaw`
        UPDATE "AIProviderConfig" SET "isActive" = ("providerKey" = ${providerKey}), "updatedAt" = now();
      `;
    }

    const { isActive, ...otherFields } = data;
    if (Object.keys(otherFields).length > 0) {
      return this.prisma.client.aIProviderConfig.update({ where: { providerKey }, data: otherFields });
    }
    return this.prisma.client.aIProviderConfig.findUnique({ where: { providerKey } });
  }

  async getSystemConfig(key: string) {
    return this.prisma.client.systemConfig.findUnique({ where: { key } });
  }

  async updateSystemConfig(key: string, value: unknown, description?: string) {
    return this.prisma.client.systemConfig.upsert({
      where: { key },
      update: { value: value as any, ...(description ? { description } : {}) },
      create: { key, value: value as any, description },
    });
  }

  /**
   * Aggregate AI usage/cost — the "revenue > AI cost" monitoring the spec
   * requires. Computed from real AIUsage rows, not estimated.
   */
  async getUsageSummary(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const usage = await this.prisma.client.aIUsage.findMany({ where: { createdAt: { gte: since } } });

    const totalCostUsd = usage.reduce((sum, u) => sum + Number(u.costUsd), 0);
    const totalInputTokens = usage.reduce((sum, u) => sum + u.inputTokens, 0);
    const totalOutputTokens = usage.reduce((sum, u) => sum + u.outputTokens, 0);
    const totalRequests = usage.length;

    const byFeature = new Map<string, { requests: number; costUsd: number }>();
    for (const u of usage) {
      const entry = byFeature.get(u.feature) ?? { requests: 0, costUsd: 0 };
      entry.requests += 1;
      entry.costUsd += Number(u.costUsd);
      byFeature.set(u.feature, entry);
    }

    // "Suspicious usage" — simple MVP flag: students with unusually high
    // request counts in the window. Not a real anomaly-detection system,
    // just a sortable list an admin can eyeball.
    const byStudent = new Map<string, number>();
    for (const u of usage) {
      if (!u.studentId) continue;
      byStudent.set(u.studentId, (byStudent.get(u.studentId) ?? 0) + 1);
    }
    const topUsageStudents = Array.from(byStudent.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([studentId, requests]) => ({ studentId, requests }));

    return {
      windowDays: days,
      totalRequests,
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      byFeature: Object.fromEntries(byFeature),
      topUsageStudents,
    };
  }

  /**
   * Reuses AIUsageService.getGlobalSpendToday() (the exact same "since
   * midnight" aggregate the runtime circuit breaker itself checks) rather
   * than approximating "today" from getUsageSummary's rolling N-day
   * window — this display must agree with what actually gates requests.
   */
  async getBudgetStatus() {
    const [globalBudgetRow, perUserBudgetRow, platformBudgetRow, dailyQuestionsRow, globalSpentTodayUsd, globalCommittedUsdToday] = await Promise.all([
      this.prisma.client.systemConfig.findUnique({ where: { key: GLOBAL_BUDGET_KEY } }),
      this.prisma.client.systemConfig.findUnique({ where: { key: PER_USER_BUDGET_KEY } }),
      this.prisma.client.systemConfig.findUnique({ where: { key: PLATFORM_BUDGET_KEY } }),
      this.prisma.client.systemConfig.findUnique({ where: { key: DAILY_QUESTIONS_KEY } }),
      this.usageService.getGlobalSpendToday(),
      // Phase 9.4D, Objective 3: the LIVE reserved+actual total the
      // circuit breaker itself checks, including money currently held
      // by an in-flight (not yet reconciled) request — distinct from
      // globalSpentTodayUsd, which only counts already-completed calls.
      this.usageService.getGlobalCommittedUsdToday(),
    ]);

    const globalBudgetUsd = parseBudgetUsd(globalBudgetRow?.value);
    const perUserBudgetUsd = parseBudgetUsd(perUserBudgetRow?.value);
    const platformContentAuthoringDailyBudgetUsd = parseBudgetUsd(platformBudgetRow?.value);
    const dailyQuestionsPerSubject = typeof dailyQuestionsRow?.value === "number" ? dailyQuestionsRow.value : DEFAULT_DAILY_QUESTIONS;

    return {
      globalBudgetUsd,
      perUserBudgetUsd,
      platformContentAuthoringDailyBudgetUsd,
      dailyQuestionsPerSubject,
      globalSpentTodayUsd,
      globalCommittedUsdToday,
      globalRemainingUsd: globalBudgetUsd === null ? null : Math.max(0, globalBudgetUsd - globalSpentTodayUsd),
    };
  }

  /**
   * The one place all three AI spending-control values are changed — kept
   * separate from the generic system-config/:key PATCH specifically so the
   * per-user <= global cross-field rule can be checked against the
   * RESULTING combined state (current values merged with whatever's being
   * changed in this call), not just the single field the caller happens to
   * be touching. Rejects the whole request (writes nothing) if the
   * resulting state would be invalid.
   */
  async updateSpendingControls(input: UpdateAISpendingControlsInput) {
    const current = await this.getBudgetStatus();

    const nextGlobal = input.globalDailyBudgetUsd ?? current.globalBudgetUsd;
    const nextPerUser = input.perUserDailyBudgetUsd ?? current.perUserBudgetUsd;
    const nextPlatform = input.platformContentAuthoringDailyBudgetUsd ?? current.platformContentAuthoringDailyBudgetUsd;

    if (nextPerUser !== null && nextGlobal !== null && nextPerUser > nextGlobal) {
      throw new BadRequestException("Per-user daily AI budget cannot exceed the global daily AI budget.");
    }
    // A per-user cap only makes sense once a global cap exists (per-user
    // spend is a subset of global spend) — surfacing this now, at write
    // time, is clearer than a per-user budget that's silently meaningless.
    if (nextPerUser !== null && nextGlobal === null) {
      throw new BadRequestException("Set a global daily AI budget before setting a per-user daily AI budget.");
    }
    // Same relationship for the independent platform content-authoring
    // cap — it is also a subset of global spend, never a separate pool.
    if (nextPlatform !== null && nextGlobal !== null && nextPlatform > nextGlobal) {
      throw new BadRequestException("Platform content-authoring daily AI budget cannot exceed the global daily AI budget.");
    }
    if (nextPlatform !== null && nextGlobal === null) {
      throw new BadRequestException("Set a global daily AI budget before setting a platform content-authoring daily AI budget.");
    }

    const writes: Array<Promise<unknown>> = [];
    if (input.globalDailyBudgetUsd !== undefined) {
      writes.push(this.updateSystemConfig(GLOBAL_BUDGET_KEY, input.globalDailyBudgetUsd, "Maximum combined AI/TTS spend allowed per day, across all students."));
    }
    if (input.perUserDailyBudgetUsd !== undefined) {
      writes.push(this.updateSystemConfig(PER_USER_BUDGET_KEY, input.perUserDailyBudgetUsd, "Maximum AI/TTS spend one student may consume per day."));
    }
    if (input.platformContentAuthoringDailyBudgetUsd !== undefined) {
      writes.push(this.updateSystemConfig(PLATFORM_BUDGET_KEY, input.platformContentAuthoringDailyBudgetUsd, "Maximum AI spend per day for shared platform content authoring (Unit grounding, lazy lesson/question generation) — independent of any single student's cap."));
    }
    if (input.dailyQuestionsPerSubject !== undefined) {
      writes.push(this.updateSystemConfig(DAILY_QUESTIONS_KEY, input.dailyQuestionsPerSubject, "Included AI questions per subject per student per day, before Question Packages/AI Credits apply."));
    }
    await Promise.all(writes);

    return this.getBudgetStatus();
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  private startOfMonth(): Date {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Admin AI Cost / Budget Dashboard (2026-09-20) — platform-level split
   * between real student-runtime spend (Lesson/Tutor/TTS) and platform
   * content-authoring spend (grounding, TOC extraction, lesson/question
   * generation — billed to CONTENT_AUTHORING_ACTOR_ID, never a student).
   * The split is exactly AIUsage.studentId being set vs null — the SAME
   * discriminator every content-authoring call site in this codebase
   * already writes, not a new classification scheme. Reuses the existing
   * AIUsage ledger only; no second accounting system.
   */
  async getCostOverview() {
    const [todayRows, monthRows] = await Promise.all([
      this.prisma.client.aIUsage.findMany({ where: { createdAt: { gte: this.startOfToday() } }, select: { costUsd: true, studentId: true } }),
      this.prisma.client.aIUsage.findMany({ where: { createdAt: { gte: this.startOfMonth() } }, select: { costUsd: true, studentId: true } }),
    ]);

    const split = (rows: Array<{ costUsd: unknown; studentId: string | null }>) => {
      let studentRuntimeUsd = 0;
      let platformAuthoringUsd = 0;
      for (const row of rows) {
        if (row.studentId != null) studentRuntimeUsd += Number(row.costUsd);
        else platformAuthoringUsd += Number(row.costUsd);
      }
      return { totalUsd: studentRuntimeUsd + platformAuthoringUsd, studentRuntimeUsd, platformAuthoringUsd };
    };

    return { today: split(todayRows), month: split(monthRows) };
  }

  /**
   * Every student with at least one AIUsage row in the window, with
   * today's real spend and remaining budget against the SAME shared
   * per-user daily budget AIUsageService itself enforces — never a
   * fabricated per-student limit. If no global per-user cap is
   * configured, remaining is reported as null (matches getBudgetStatus's
   * own convention) rather than guessed.
   */
  async listStudentSpend(windowDays = 30) {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - windowDays);

    const [todayRows, windowRows, perUserBudgetRow] = await Promise.all([
      this.prisma.client.aIUsage.findMany({ where: { studentId: { not: null }, createdAt: { gte: this.startOfToday() } }, select: { userId: true, costUsd: true } }),
      this.prisma.client.aIUsage.findMany({ where: { studentId: { not: null }, createdAt: { gte: windowStart } }, select: { userId: true, studentId: true, costUsd: true } }),
      this.prisma.client.systemConfig.findUnique({ where: { key: PER_USER_BUDGET_KEY } }),
    ]);
    const perUserBudgetUsd = parseBudgetUsd(perUserBudgetRow?.value);

    const todayByUserId = new Map<string, number>();
    for (const row of todayRows) todayByUserId.set(row.userId, (todayByUserId.get(row.userId) ?? 0) + Number(row.costUsd));

    const byUserId = new Map<string, { userId: string; studentId: string; windowUsd: number }>();
    for (const row of windowRows) {
      const entry = byUserId.get(row.userId) ?? { userId: row.userId, studentId: row.studentId as string, windowUsd: 0 };
      entry.windowUsd += Number(row.costUsd);
      byUserId.set(row.userId, entry);
    }

    const studentIds = [...byUserId.values()].map((entry) => entry.studentId);
    const profiles = studentIds.length > 0
      ? await this.prisma.client.studentProfile.findMany({ where: { id: { in: studentIds } }, select: { id: true, fullName: true, user: { select: { email: true } } } })
      : [];
    const profileByStudentId = new Map(profiles.map((profile) => [profile.id, profile]));

    return [...byUserId.values()]
      .map((entry) => {
        const profile = profileByStudentId.get(entry.studentId);
        const todayUsd = todayByUserId.get(entry.userId) ?? 0;
        return {
          studentId: entry.studentId,
          fullName: profile?.fullName ?? "(unknown student)",
          email: profile?.user.email ?? null,
          todayUsd,
          windowDays,
          windowUsd: entry.windowUsd,
          perUserBudgetUsd,
          remainingTodayUsd: perUserBudgetUsd === null ? null : Math.max(0, perUserBudgetUsd - todayUsd),
        };
      })
      .sort((a, b) => b.windowUsd - a.windowUsd);
  }

  /**
   * Drill-down for one student: real AIUsage spend grouped by Subject
   * (never including platform content-authoring rows — those never carry
   * this student's studentId in the first place, so they cannot appear
   * here even accidentally), and within each Subject, by feature
   * (lesson_chat / tutor_chat / tutor_tts) wherever the stored data
   * supports it.
   */
  async getStudentSpendDetail(studentId: string, windowDays = 30) {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - windowDays);

    const rows = await this.prisma.client.aIUsage.findMany({
      where: { studentId, createdAt: { gte: windowStart } },
      select: { subjectId: true, feature: true, costUsd: true },
    });

    const bySubjectId = new Map<string, { subjectId: string | null; costUsd: number; byFeature: Map<string, number> }>();
    for (const row of rows) {
      const key = row.subjectId ?? "__none__";
      const entry = bySubjectId.get(key) ?? { subjectId: row.subjectId, costUsd: 0, byFeature: new Map<string, number>() };
      entry.costUsd += Number(row.costUsd);
      entry.byFeature.set(row.feature, (entry.byFeature.get(row.feature) ?? 0) + Number(row.costUsd));
      bySubjectId.set(key, entry);
    }

    const subjectIds = [...bySubjectId.values()].map((entry) => entry.subjectId).filter((id): id is string => id != null);
    const subjects = subjectIds.length > 0
      ? await this.prisma.client.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true, nameEn: true, nameAr: true } })
      : [];
    const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));

    return {
      windowDays,
      totalUsd: rows.reduce((sum, row) => sum + Number(row.costUsd), 0),
      bySubject: [...bySubjectId.values()]
        .map((entry) => ({
          subjectId: entry.subjectId,
          subjectNameEn: entry.subjectId ? subjectById.get(entry.subjectId)?.nameEn ?? "(unknown subject)" : "(no subject)",
          subjectNameAr: entry.subjectId ? subjectById.get(entry.subjectId)?.nameAr ?? "" : "",
          costUsd: entry.costUsd,
          byFeature: Object.fromEntries(entry.byFeature),
        }))
        .sort((a, b) => b.costUsd - a.costUsd),
    };
  }
}
