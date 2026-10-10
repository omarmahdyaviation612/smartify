import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Admin student analytics (2026-10-11). One read-only place to see who the
 * students are (school, location, curriculum, grade, chosen subjects), what
 * each one tried and did (trials, lessons, quizzes, practice, homework, tutor
 * chats, payments, support) and how much AI each one consumed — plus a
 * platform-wide analytics overview. Everything is computed from existing
 * tables; nothing here writes.
 *
 * Aggregation is done per student with groupBy queries and joined in memory —
 * fine at the current scale (hundreds/low thousands of students).
 */

export interface StudentListFilters {
  q?: string;
  curriculumId?: string;
  gradeId?: string;
  governorate?: string;
  status?: "paid" | "trial" | "registered" | "all";
  includeTest?: boolean;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const maxDate = (...ds: Array<Date | null | undefined>) =>
  ds.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

function lastNDays(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(dayKey(d));
  }
  return out;
}

function countBy<T>(items: T[], key: (t: T) => string | null | undefined): Array<{ key: string; count: number }> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it) || "Unknown";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
}

/** When onboarding step tracking (POST /onboarding/progress) went live. */
export const ONBOARDING_TRACKING_SINCE = new Date("2026-10-10T23:00:00Z");

@Injectable()
export class AdminStudentAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /** Every student profile with the per-student activity aggregates used by the list and the overview. */
  private async loadStudentRows(includeTest: boolean) {
    const profiles = await this.db.studentProfile.findMany({
      where: { user: { deletedAt: null, ...(includeTest ? {} : { isTestStudent: false }) } },
      include: {
        user: { select: { id: true, email: true, isTestStudent: true, createdAt: true, isActive: true } },
        curriculum: { select: { id: true, nameEn: true, code: true } },
        grade: { select: { id: true, nameEn: true, level: true } },
        school: { select: { nameEn: true, nameAr: true, governorate: true, area: true } },
        subjects: { select: { subjectId: true, expiresAt: true, createdAt: true, subject: { select: { nameEn: true } } } },
        subscription: { select: { status: true, monthlyTotalEGP: true, currentPeriodEnd: true } },
        lessonTrial: { select: { createdAt: true, _count: { select: { consumptions: true } } } },
        freeTutorTrial: { select: { questionsUsed: true, completedAt: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    const studentIds = profiles.map((p) => p.id);
    const userIds = profiles.map((p) => p.userId);
    const inStudents = { in: studentIds };

    const [lessons, lessonsDone, quizzes, attempts, attemptsCorrect, homework, tutorChats, ai, paid] = await Promise.all([
      this.db.lessonSession.groupBy({ by: ["studentId"], where: { studentId: inStudents }, _count: { _all: true }, _max: { updatedAt: true } }),
      this.db.lessonSession.groupBy({ by: ["studentId"], where: { studentId: inStudents, completedAt: { not: null } }, _count: { _all: true } }),
      this.db.quizResult.groupBy({ by: ["studentId"], where: { studentId: inStudents }, _count: { _all: true }, _avg: { score: true }, _max: { createdAt: true } }),
      this.db.questionAttempt.groupBy({ by: ["studentId"], where: { studentId: inStudents }, _count: { _all: true }, _max: { attemptedAt: true } }),
      this.db.questionAttempt.groupBy({ by: ["studentId"], where: { studentId: inStudents, isCorrect: true }, _count: { _all: true } }),
      this.db.homeworkSession.groupBy({ by: ["studentId"], where: { studentId: inStudents }, _count: { _all: true }, _max: { createdAt: true } }),
      this.db.aIConversation.groupBy({ by: ["studentId"], where: { studentId: inStudents, lessonSession: { is: null } }, _count: { _all: true } }),
      this.db.aIUsage.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _count: { _all: true }, _sum: { costUsd: true, inputTokens: true, outputTokens: true }, _max: { createdAt: true } }),
      this.db.instapayPaymentSubmission.groupBy({ by: ["studentId"], where: { studentId: inStudents, status: "VERIFIED" }, _count: { _all: true }, _sum: { submittedAmountEGP: true } }),
    ]);
    const by = <T extends { studentId: string }>(rows: T[]) => new Map(rows.map((r) => [r.studentId, r]));
    const L = by(lessons), LD = by(lessonsDone), Q = by(quizzes), A = by(attempts), AC = by(attemptsCorrect), H = by(homework), T = by(tutorChats), P = by(paid);
    const AI = new Map(ai.map((r) => [r.userId, r]));

    return profiles.map((p) => {
      const ai = AI.get(p.userId);
      const attemptsCount = A.get(p.id)?._count._all ?? 0;
      const paidActive = p.subscription?.status === "active" || (P.get(p.id)?._count._all ?? 0) > 0;
      const tried = (L.get(p.id)?._count._all ?? 0) > 0 || (p.lessonTrial?._count.consumptions ?? 0) > 0 || (p.freeTutorTrial?.questionsUsed ?? 0) > 0;
      return {
        studentId: p.id,
        userId: p.userId,
        fullName: p.fullName,
        email: p.user.email,
        age: p.age,
        isTestStudent: p.user.isTestStudent,
        joinedAt: p.user.createdAt,
        onboardedAt: p.createdAt,
        preferredLang: p.preferredLang,
        country: p.country,
        governorate: p.school?.governorate ?? p.governorate ?? null,
        area: p.school?.area ?? p.area ?? null,
        school: p.school ? p.school.nameAr || p.school.nameEn : p.schoolNameManual ?? null,
        curriculum: { id: p.curriculum.id, name: p.curriculum.nameEn, code: p.curriculum.code },
        grade: { id: p.grade.id, name: p.grade.nameEn, level: p.grade.level },
        subjects: p.subjects.map((s) => s.subject.nameEn),
        subscriptionStatus: p.subscription?.status ?? null,
        monthlyTotalEGP: p.subscription ? num(p.subscription.monthlyTotalEGP) : null,
        paidEGP: num(P.get(p.id)?._sum.submittedAmountEGP),
        stage: paidActive ? "paid" : tried ? "trial" : "registered",
        trialLessonsUsed: p.lessonTrial?._count.consumptions ?? 0,
        tutorTrialQuestionsUsed: p.freeTutorTrial?.questionsUsed ?? 0,
        lessonsStarted: L.get(p.id)?._count._all ?? 0,
        lessonsCompleted: LD.get(p.id)?._count._all ?? 0,
        quizzes: Q.get(p.id)?._count._all ?? 0,
        avgQuizScore: Q.get(p.id)?._avg.score ?? null,
        practiceAttempts: attemptsCount,
        practiceAccuracy: attemptsCount ? (AC.get(p.id)?._count._all ?? 0) / attemptsCount : null,
        homeworkSessions: H.get(p.id)?._count._all ?? 0,
        tutorChats: T.get(p.id)?._count._all ?? 0,
        aiCalls: ai?._count._all ?? 0,
        aiCostUsd: num(ai?._sum.costUsd),
        aiTokens: num(ai?._sum.inputTokens) + num(ai?._sum.outputTokens),
        lastActiveAt: maxDate(L.get(p.id)?._max.updatedAt, Q.get(p.id)?._max.createdAt, A.get(p.id)?._max.attemptedAt, H.get(p.id)?._max.createdAt, ai?._max.createdAt),
      };
    });
  }

  async listStudents(filters: StudentListFilters) {
    let rows = await this.loadStudentRows(!!filters.includeTest);
    const q = filters.q?.trim().toLowerCase();
    if (q) rows = rows.filter((r) => [r.fullName, r.email, r.school, r.governorate, r.area].some((v) => v?.toLowerCase().includes(q)));
    if (filters.curriculumId) rows = rows.filter((r) => r.curriculum.id === filters.curriculumId);
    if (filters.gradeId) rows = rows.filter((r) => r.grade.id === filters.gradeId);
    if (filters.governorate) rows = rows.filter((r) => r.governorate === filters.governorate);
    if (filters.status && filters.status !== "all") rows = rows.filter((r) => r.stage === filters.status);
    return { total: rows.length, students: rows };
  }

  async overview(days = 30, includeTest = false) {
    const window = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
    const since = new Date(Date.now() - window * 86_400_000);
    const rows = await this.loadStudentRows(includeTest);
    const studentIds = rows.map((r) => r.studentId);
    const studentUserIds = new Set(rows.map((r) => r.userId));

    const [registeredUsers, studentSubjects, lessonsInWindow, quizzesInWindow, attemptsInWindow, homeworkInWindow, ticketsInWindow, aiInWindow, verifiedPayments] = await Promise.all([
      this.db.user.findMany({ where: { role: "STUDENT", deletedAt: null, ...(includeTest ? {} : { isTestStudent: false }) }, select: { id: true, createdAt: true } }),
      this.db.studentSubject.findMany({ where: { studentId: { in: studentIds } }, select: { subject: { select: { nameEn: true, grade: { select: { nameEn: true, curriculum: { select: { nameEn: true } } } } } } } }),
      this.db.lessonSession.findMany({ where: { studentId: { in: studentIds }, startedAt: { gte: since } }, select: { studentId: true, startedAt: true, completedAt: true } }),
      this.db.quizResult.count({ where: { studentId: { in: studentIds }, createdAt: { gte: since } } }),
      this.db.questionAttempt.findMany({ where: { studentId: { in: studentIds }, attemptedAt: { gte: since } }, select: { studentId: true, attemptedAt: true, isCorrect: true } }),
      this.db.homeworkSession.count({ where: { studentId: { in: studentIds }, createdAt: { gte: since } } }),
      this.db.studentSupportTicket.count({ where: { createdAt: { gte: since } } }),
      this.db.aIUsage.findMany({ where: { createdAt: { gte: since } }, select: { userId: true, feature: true, costUsd: true, inputTokens: true, outputTokens: true, createdAt: true } }),
      this.db.instapayPaymentSubmission.findMany({ where: { status: "VERIFIED", verifiedAt: { gte: since } }, select: { submittedAmountEGP: true } }),
    ]);

    // Daily series.
    const daysList = lastNDays(window);
    const series = new Map(daysList.map((d) => [d, { day: d, signups: 0, activeStudents: new Set<string>(), lessons: 0, aiCostUsd: 0 }]));
    for (const u of registeredUsers) {
      const s = series.get(dayKey(u.createdAt));
      if (s) s.signups++;
    }
    for (const l of lessonsInWindow) {
      const s = series.get(dayKey(l.startedAt));
      if (s) { s.lessons++; s.activeStudents.add(l.studentId); }
    }
    for (const a of attemptsInWindow) series.get(dayKey(a.attemptedAt))?.activeStudents.add(a.studentId);
    const userToStudent = new Map(rows.map((r) => [r.userId, r.studentId]));
    let studentAiUsd = 0, platformAiUsd = 0, aiTokens = 0;
    const byFeature = new Map<string, { calls: number; costUsd: number }>();
    for (const u of aiInWindow) {
      const cost = num(u.costUsd);
      aiTokens += u.inputTokens + u.outputTokens;
      const isStudent = studentUserIds.has(u.userId);
      if (isStudent) studentAiUsd += cost; else platformAiUsd += cost;
      const f = byFeature.get(u.feature) ?? { calls: 0, costUsd: 0 };
      f.calls++; f.costUsd += cost; byFeature.set(u.feature, f);
      const s = series.get(dayKey(u.createdAt));
      if (s) { s.aiCostUsd += cost; if (isStudent) s.activeStudents.add(userToStudent.get(u.userId)!); }
    }
    const activeInWindow = new Set<string>();
    for (const s of series.values()) for (const id of s.activeStudents) activeInWindow.add(id);

    // Funnel (all time).
    const withSubjects = rows.filter((r) => r.subjects.length > 0).length;
    const tried = rows.filter((r) => r.stage !== "registered").length;
    const completedLesson = rows.filter((r) => r.lessonsCompleted > 0).length;
    const paid = rows.filter((r) => r.stage === "paid").length;

    // Onboarding step funnel — only accounts created since step tracking
    // shipped, so earlier sign-ups (never tracked) don't skew the drop-offs.
    const trackedUsers = registeredUsers.filter((u) => u.createdAt >= ONBOARDING_TRACKING_SINCE);
    const trackedIds = new Set(trackedUsers.map((u) => u.id));
    const stepLogs = trackedIds.size
      ? await this.db.auditLog.findMany({ where: { action: "onboarding.step", userId: { in: [...trackedIds] } }, select: { userId: true, entityId: true } })
      : [];
    const reached = (step: string) => new Set(stepLogs.filter((l: { userId: string | null; entityId: string | null }) => l.entityId === step && l.userId).map((l: { userId: string | null }) => l.userId)).size;
    const onboardingFunnel = {
      trackedSince: ONBOARDING_TRACKING_SINCE.toISOString(),
      steps: [
        { stage: "Signed up", count: trackedUsers.length },
        { stage: "Opened onboarding", count: reached("profile") },
        { stage: "Entered name & age", count: reached("curriculum") },
        { stage: "Chose curriculum", count: reached("grade-subjects") },
        { stage: "Saved grade & subjects", count: rows.filter((r) => trackedIds.has(r.userId)).length },
        { stage: "Finished placement test", count: reached("plan-ready") },
      ],
    };

    const ages = countBy(rows, (r) => (r.age <= 6 ? "≤6" : r.age >= 13 ? "13+" : String(r.age)));

    return {
      windowDays: window,
      includeTest,
      totals: {
        registeredAccounts: registeredUsers.length,
        onboardedStudents: rows.length,
        activeStudentsInWindow: activeInWindow.size,
        payingStudents: paid,
        mrrEGP: rows.filter((r) => r.subscriptionStatus === "active").reduce((s, r) => s + (r.monthlyTotalEGP ?? 0), 0),
        verifiedPaymentsEGPInWindow: verifiedPayments.reduce((s, p) => s + num(p.submittedAmountEGP), 0),
      },
      funnel: [
        { stage: "Registered", count: registeredUsers.length },
        { stage: "Completed onboarding", count: rows.length },
        { stage: "Chose subjects", count: withSubjects },
        { stage: "Tried a lesson / tutor", count: tried },
        { stage: "Completed a lesson", count: completedLesson },
        { stage: "Paid", count: paid },
      ],
      onboardingFunnel,
      activity: {
        lessonsStarted: lessonsInWindow.length,
        lessonsCompleted: lessonsInWindow.filter((l) => l.completedAt).length,
        quizzes: quizzesInWindow,
        practiceAttempts: attemptsInWindow.length,
        practiceAccuracy: attemptsInWindow.length ? attemptsInWindow.filter((a) => a.isCorrect).length / attemptsInWindow.length : null,
        homeworkSessions: homeworkInWindow,
        supportTickets: ticketsInWindow,
      },
      ai: {
        totalUsd: studentAiUsd + platformAiUsd,
        studentUsd: studentAiUsd,
        platformContentUsd: platformAiUsd,
        tokens: aiTokens,
        calls: aiInWindow.length,
        avgUsdPerActiveStudent: activeInWindow.size ? studentAiUsd / activeInWindow.size : 0,
        byFeature: [...byFeature.entries()].map(([feature, v]) => ({ feature, ...v })).sort((a, b) => b.costUsd - a.costUsd),
        topStudents: [...rows].sort((a, b) => b.aiCostUsd - a.aiCostUsd).slice(0, 10).filter((r) => r.aiCostUsd > 0)
          .map((r) => ({ studentId: r.studentId, fullName: r.fullName, aiCostUsd: r.aiCostUsd, aiCalls: r.aiCalls })),
      },
      daily: [...series.values()].map((s) => ({ day: s.day, signups: s.signups, activeStudents: s.activeStudents.size, lessons: s.lessons, aiCostUsd: s.aiCostUsd })),
      breakdowns: {
        curriculum: countBy(rows, (r) => r.curriculum.name),
        grade: countBy(rows, (r) => `${r.curriculum.name} · ${r.grade.name}`),
        governorate: countBy(rows, (r) => r.governorate),
        school: countBy(rows, (r) => r.school).slice(0, 15),
        subject: countBy(studentSubjects, (s) => `${s.subject.nameEn} · ${s.subject.grade.nameEn} · ${s.subject.grade.curriculum.nameEn}`).slice(0, 20),
        age: ages,
        language: countBy(rows, (r) => (r.preferredLang === "ar" ? "Arabic" : r.preferredLang === "en" ? "English" : r.preferredLang)),
        stage: countBy(rows, (r) => r.stage),
      },
    };
  }

  async studentDetail(studentId: string) {
    const p = await this.db.studentProfile.findUnique({
      where: { id: studentId },
      include: {
        user: { select: { id: true, email: true, isTestStudent: true, isActive: true, createdAt: true } },
        curriculum: { select: { nameEn: true, code: true } },
        grade: { select: { nameEn: true, level: true } },
        school: { select: { nameEn: true, nameAr: true, governorate: true, area: true } },
        subjects: { select: { createdAt: true, expiresAt: true, subject: { select: { id: true, nameEn: true, priceEGP: true } } } },
        subscription: { select: { status: true, monthlyTotalEGP: true, currentPeriodStart: true, currentPeriodEnd: true, homeworkAddonActive: true, createdAt: true } },
        lessonTrial: { select: { createdAt: true, consumptions: { select: { createdAt: true, subject: { select: { nameEn: true } }, topic: { select: { nameEn: true } } } } } },
        freeTutorTrial: { select: { questionsUsed: true, createdAt: true, completedAt: true, subject: { select: { nameEn: true } } } },
        referredBy: { select: { code: true, createdAt: true, referrer: { select: { fullName: true } } } },
        _count: { select: { referralsMade: true } },
        parentLinks: { select: { parent: { select: { fullName: true } } } },
      },
    });
    if (!p) throw new NotFoundException("Student not found.");

    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const [lessons, quizzes, attempts, homework, tutorConversations, tickets, payments, aiByFeature, aiRecent, aiBySubject] = await Promise.all([
      this.db.lessonSession.findMany({
        where: { studentId },
        orderBy: { updatedAt: "desc" },
        select: { status: true, currentStepIndex: true, startedAt: true, updatedAt: true, completedAt: true, topic: { select: { nameEn: true, teachingStepsJson: true, unit: { select: { subject: { select: { nameEn: true } } } } } } },
      }),
      this.db.quizResult.findMany({ where: { studentId }, orderBy: { createdAt: "desc" }, take: 50, select: { quizType: true, score: true, correctCount: true, totalQuestions: true, createdAt: true, topic: { select: { nameEn: true } } } }),
      this.db.questionAttempt.findMany({ where: { studentId }, select: { isCorrect: true, source: true, attemptedAt: true, question: { select: { topic: { select: { unit: { select: { subject: { select: { nameEn: true } } } } } } } } } }),
      this.db.homeworkSession.findMany({ where: { studentId }, orderBy: { createdAt: "desc" }, take: 30, select: { status: true, solvedAt: true, solutionRevealed: true, createdAt: true, extractedQuestion: true, subject: { select: { nameEn: true } } } }),
      this.db.aIConversation.findMany({ where: { studentId, lessonSession: { is: null } }, orderBy: { updatedAt: "desc" }, take: 30, select: { title: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } } }),
      this.db.studentSupportTicket.findMany({ where: { studentUserId: p.userId }, orderBy: { createdAt: "desc" }, take: 20, select: { title: true, status: true, createdAt: true, closedAt: true } }),
      this.db.instapayPaymentSubmission.findMany({ where: { studentId }, orderBy: { createdAt: "desc" }, select: { kind: true, status: true, expectedAmountEGP: true, submittedAmountEGP: true, createdAt: true, verifiedAt: true, rejectionReason: true } }),
      this.db.aIUsage.groupBy({ by: ["feature"], where: { userId: p.userId }, _count: { _all: true }, _sum: { costUsd: true, inputTokens: true, outputTokens: true } }),
      this.db.aIUsage.findMany({ where: { userId: p.userId, createdAt: { gte: since30 } }, select: { costUsd: true, createdAt: true } }),
      this.db.aIUsage.groupBy({ by: ["subjectId"], where: { userId: p.userId }, _sum: { costUsd: true }, _count: { _all: true } }),
    ]);

    const subjectNames = new Map(
      (await this.db.subject.findMany({ where: { id: { in: aiBySubject.map((r) => r.subjectId).filter((x): x is string => !!x) } }, select: { id: true, nameEn: true } }))
        .map((s) => [s.id, s.nameEn]),
    );
    const practiceBySubject = new Map<string, { attempts: number; correct: number }>();
    for (const a of attempts) {
      const key = a.question.topic.unit.subject.nameEn;
      const v = practiceBySubject.get(key) ?? { attempts: 0, correct: 0 };
      v.attempts++; if (a.isCorrect) v.correct++;
      practiceBySubject.set(key, v);
    }
    const aiDaily = new Map(lastNDays(30).map((d) => [d, 0]));
    for (const u of aiRecent) { const k = dayKey(u.createdAt); if (aiDaily.has(k)) aiDaily.set(k, aiDaily.get(k)! + num(u.costUsd)); }

    const timeline = [
      { at: p.user.createdAt, type: "signup", text: "Created account" },
      { at: p.createdAt, type: "onboarding", text: `Onboarded: ${p.curriculum.nameEn} · ${p.grade.nameEn}` },
      ...p.subjects.map((s) => ({ at: s.createdAt, type: "subject", text: `Got access to ${s.subject.nameEn}` })),
      ...(p.lessonTrial?.consumptions ?? []).map((c) => ({ at: c.createdAt, type: "trial", text: `Free trial lesson: ${c.topic.nameEn} (${c.subject.nameEn})` })),
      ...lessons.map((l) => ({ at: l.startedAt, type: "lesson", text: `Started lesson: ${l.topic.nameEn}` })),
      ...lessons.filter((l) => l.completedAt).map((l) => ({ at: l.completedAt!, type: "lesson_done", text: `Completed lesson: ${l.topic.nameEn}` })),
      ...quizzes.map((q) => ({ at: q.createdAt, type: "quiz", text: `${q.quizType}${q.topic ? `: ${q.topic.nameEn}` : ""} — ${q.correctCount}/${q.totalQuestions}` })),
      ...homework.map((h) => ({ at: h.createdAt, type: "homework", text: `Homework help (${h.subject.nameEn})${h.solvedAt ? " — solved" : ""}` })),
      ...payments.map((pay) => ({ at: pay.createdAt, type: "payment", text: `InstaPay ${num(pay.submittedAmountEGP)} EGP — ${pay.status}` })),
      ...tickets.map((t) => ({ at: t.createdAt, type: "support", text: `Support: ${t.title}` })),
    ].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 100);

    return {
      profile: {
        studentId: p.id,
        fullName: p.fullName,
        email: p.user.email,
        age: p.age,
        country: p.country,
        preferredLang: p.preferredLang,
        governorate: p.school?.governorate ?? p.governorate,
        area: p.school?.area ?? p.area,
        school: p.school ? p.school.nameAr || p.school.nameEn : p.schoolNameManual,
        schoolFromList: !!p.school,
        curriculum: p.curriculum.nameEn,
        grade: p.grade.nameEn,
        goals: p.goals,
        weeklyStudyHours: p.weeklyStudyHours,
        joinedAt: p.user.createdAt,
        isTestStudent: p.user.isTestStudent,
        isActive: p.user.isActive,
        parents: p.parentLinks.map((l) => l.parent.fullName),
        referredBy: p.referredBy ? { code: p.referredBy.code, referrer: p.referredBy.referrer.fullName, at: p.referredBy.createdAt } : null,
        referralsMade: p._count.referralsMade,
      },
      subjects: p.subjects.map((s) => ({ name: s.subject.nameEn, priceEGP: s.subject.priceEGP != null ? num(s.subject.priceEGP) : null, since: s.createdAt, expiresAt: s.expiresAt })),
      subscription: p.subscription ? { ...p.subscription, monthlyTotalEGP: num(p.subscription.monthlyTotalEGP) } : null,
      trials: {
        lessonTrial: p.lessonTrial ? { startedAt: p.lessonTrial.createdAt, lessons: p.lessonTrial.consumptions.map((c) => ({ subject: c.subject.nameEn, topic: c.topic.nameEn, at: c.createdAt })) } : null,
        tutorTrial: p.freeTutorTrial ? { subject: p.freeTutorTrial.subject.nameEn, questionsUsed: p.freeTutorTrial.questionsUsed, startedAt: p.freeTutorTrial.createdAt, completedAt: p.freeTutorTrial.completedAt } : null,
      },
      lessons: lessons.map((l) => ({
        topic: l.topic.nameEn,
        subject: l.topic.unit.subject.nameEn,
        status: l.completedAt ? "COMPLETED" : l.status,
        step: l.currentStepIndex + 1,
        totalSteps: Array.isArray(l.topic.teachingStepsJson) ? (l.topic.teachingStepsJson as unknown[]).length : null,
        startedAt: l.startedAt,
        lastActivityAt: l.updatedAt,
        completedAt: l.completedAt,
      })),
      quizzes,
      practice: {
        attempts: attempts.length,
        accuracy: attempts.length ? attempts.filter((a) => a.isCorrect).length / attempts.length : null,
        bySource: countBy(attempts, (a) => a.source),
        bySubject: [...practiceBySubject.entries()].map(([subject, v]) => ({ subject, ...v, accuracy: v.correct / v.attempts })),
      },
      homework: homework.map((h) => ({ ...h, extractedQuestion: h.extractedQuestion.slice(0, 160) })),
      tutorConversations: tutorConversations.map((c) => ({ title: c.title, messages: c._count.messages, startedAt: c.createdAt, lastAt: c.updatedAt })),
      supportTickets: tickets,
      payments: payments.map((pay) => ({ ...pay, expectedAmountEGP: num(pay.expectedAmountEGP), submittedAmountEGP: num(pay.submittedAmountEGP) })),
      ai: {
        totalUsd: aiByFeature.reduce((s, r) => s + num(r._sum.costUsd), 0),
        calls: aiByFeature.reduce((s, r) => s + r._count._all, 0),
        tokens: aiByFeature.reduce((s, r) => s + num(r._sum.inputTokens) + num(r._sum.outputTokens), 0),
        byFeature: aiByFeature.map((r) => ({ feature: r.feature, calls: r._count._all, costUsd: num(r._sum.costUsd), tokens: num(r._sum.inputTokens) + num(r._sum.outputTokens) })).sort((a, b) => b.costUsd - a.costUsd),
        bySubject: aiBySubject.map((r) => ({ subject: r.subjectId ? subjectNames.get(r.subjectId) ?? "Unknown" : "No subject", calls: r._count._all, costUsd: num(r._sum.costUsd) })).sort((a, b) => b.costUsd - a.costUsd),
        daily: [...aiDaily.entries()].map(([day, costUsd]) => ({ day, costUsd })),
      },
      timeline,
    };
  }
}
