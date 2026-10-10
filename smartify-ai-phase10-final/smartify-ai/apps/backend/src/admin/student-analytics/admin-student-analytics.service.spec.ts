import { NotFoundException } from "@nestjs/common";
import { AdminStudentAnalyticsService } from "./admin-student-analytics.service";

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

function profile(id: string, userId: string, extra: Record<string, unknown> = {}) {
  return {
    id, userId, fullName: `Student ${id}`, age: 9, country: "EG", preferredLang: "ar",
    governorate: "Cairo", area: "Nasr City", schoolNameManual: "Manual School", createdAt: daysAgo(5),
    user: { id: userId, email: `${id}@x.com`, isTestStudent: false, createdAt: daysAgo(6), isActive: true },
    curriculum: { id: "cur-eg", nameEn: "Egyptian National Curriculum", code: "EG_NATIONAL" },
    grade: { id: "g4", nameEn: "Grade 4", level: 4 },
    school: null, subjects: [], subscription: null, lessonTrial: null, freeTutorTrial: null,
    ...extra,
  };
}

function makePrisma() {
  const profiles = [
    profile("s1", "u1", {
      school: { nameEn: "Cairo School", nameAr: "مدرسة", governorate: "Giza", area: "Dokki" },
      subjects: [{ subjectId: "math", expiresAt: null, createdAt: daysAgo(4), subject: { nameEn: "Mathematics" } }],
      subscription: { status: "active", monthlyTotalEGP: 140, currentPeriodEnd: null },
    }),
    profile("s2", "u2", { lessonTrial: { createdAt: daysAgo(3), _count: { consumptions: 1 } } }),
    profile("s3", "u3"),
  ];
  const g = (rows: unknown[]) => jest.fn().mockResolvedValue(rows);
  // Answers depend on the query (all sessions vs completed ones, all attempts vs correct ones), so they can be reused.
  const lessonGroups = jest.fn().mockImplementation(async ({ where }: any) => where.completedAt
    ? [{ studentId: "s1", _count: { _all: 2 } }]
    : [{ studentId: "s1", _count: { _all: 3 }, _max: { updatedAt: daysAgo(1) } }, { studentId: "s2", _count: { _all: 1 }, _max: { updatedAt: daysAgo(2) } }]);
  const attemptGroups = jest.fn().mockImplementation(async ({ where }: any) => where.isCorrect
    ? [{ studentId: "s1", _count: { _all: 7 } }]
    : [{ studentId: "s1", _count: { _all: 10 }, _max: { attemptedAt: daysAgo(1) } }]);
  const client: any = {
    studentProfile: { findMany: jest.fn().mockResolvedValue(profiles), findUnique: jest.fn().mockResolvedValue(null) },
    lessonSession: { groupBy: lessonGroups, findMany: g([{ studentId: "s1", startedAt: daysAgo(1), completedAt: daysAgo(1) }]) },
    quizResult: { groupBy: g([{ studentId: "s1", _count: { _all: 2 }, _avg: { score: 80 }, _max: { createdAt: daysAgo(1) } }]), count: jest.fn().mockResolvedValue(2) },
    questionAttempt: { groupBy: attemptGroups, findMany: g([{ studentId: "s1", attemptedAt: daysAgo(1), isCorrect: true }, { studentId: "s1", attemptedAt: daysAgo(1), isCorrect: false }]) },
    homeworkSession: { groupBy: g([]), count: jest.fn().mockResolvedValue(0) },
    aIConversation: { groupBy: g([{ studentId: "s1", _count: { _all: 4 } }]) },
    aIUsage: {
      groupBy: g([{ userId: "u1", _count: { _all: 20 }, _sum: { costUsd: 0.5, inputTokens: 1000, outputTokens: 500 }, _max: { createdAt: daysAgo(1) } }]),
      findMany: g([
        { userId: "u1", feature: "tutor_chat", costUsd: 0.3, inputTokens: 100, outputTokens: 50, createdAt: daysAgo(1) },
        { userId: "content-actor", feature: "lesson_draft_generation", costUsd: 0.2, inputTokens: 100, outputTokens: 50, createdAt: daysAgo(1) },
      ]),
    },
    instapayPaymentSubmission: { groupBy: g([]), findMany: g([{ submittedAmountEGP: 140 }]) },
    // u1-u3 signed up before onboarding step tracking existed; u4 after.
    user: { findMany: g([{ id: "u1", createdAt: new Date("2026-09-01") }, { id: "u2", createdAt: new Date("2026-09-01") }, { id: "u3", createdAt: new Date("2026-09-01") }, { id: "u4", createdAt: now }]) },
    studentSubject: { findMany: g([{ subject: { nameEn: "Mathematics", grade: { nameEn: "Grade 4", curriculum: { nameEn: "Egyptian National Curriculum" } } } }]) },
    studentSupportTicket: { count: jest.fn().mockResolvedValue(1) },
    auditLog: { findMany: g([{ userId: "u4", entityId: "profile" }, { userId: "u4", entityId: "curriculum" }]) },
  };
  return { client };
}

describe("AdminStudentAnalyticsService", () => {
  it("lists each student with school, location, subjects, activity, AI cost and stage", async () => {
    const service = new AdminStudentAnalyticsService(makePrisma() as any);
    const { total, students } = await service.listStudents({});
    expect(total).toBe(3);
    const s1 = students.find((s) => s.studentId === "s1")!;
    expect(s1).toMatchObject({
      school: "مدرسة", governorate: "Giza", area: "Dokki", subjects: ["Mathematics"],
      stage: "paid", lessonsStarted: 3, lessonsCompleted: 2, quizzes: 2, avgQuizScore: 80,
      practiceAttempts: 10, practiceAccuracy: 0.7, tutorChats: 4, aiCalls: 20, aiCostUsd: 0.5, aiTokens: 1500,
    });
    expect(students.find((s) => s.studentId === "s2")).toMatchObject({ stage: "trial", school: "Manual School", governorate: "Cairo" });
    expect(students.find((s) => s.studentId === "s3")).toMatchObject({ stage: "registered", aiCostUsd: 0 });
  });

  it("filters by search text and stage", async () => {
    const service = new AdminStudentAnalyticsService(makePrisma() as any);
    expect((await service.listStudents({ q: "dokki" })).students.map((s) => s.studentId)).toEqual(["s1"]);
    expect((await service.listStudents({ status: "trial" })).students.map((s) => s.studentId)).toEqual(["s2"]);
  });

  it("builds the overview funnel and splits AI cost into student vs platform content", async () => {
    const service = new AdminStudentAnalyticsService(makePrisma() as any);
    const o = await service.overview(30);
    expect(o.funnel.map((f) => f.count)).toEqual([4, 3, 1, 2, 1, 1]);
    expect(o.ai.studentUsd).toBeCloseTo(0.3);
    expect(o.ai.platformContentUsd).toBeCloseTo(0.2);
    expect(o.totals).toMatchObject({ registeredAccounts: 4, onboardedStudents: 3, payingStudents: 1, mrrEGP: 140, verifiedPaymentsEGPInWindow: 140 });
    expect(o.daily).toHaveLength(30);
    // Only u4 signed up after step tracking started; it reached step 2 and stopped.
    expect(o.onboardingFunnel.steps.map((s) => s.count)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(o.breakdowns.governorate[0]).toEqual({ key: "Cairo", count: 2 });
  });

  it("returns 404 for an unknown student", async () => {
    const service = new AdminStudentAnalyticsService(makePrisma() as any);
    await expect(service.studentDetail("missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});
