import { NotFoundException } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";

/**
 * Phase 10C: DashboardService.getSummary() must only ever surface
 * interactive topics that belong to the student's own selected
 * curriculum/grade/subjects — relational IDs only, never a name match,
 * and never "all interactive topics in the system" as a fallback for an
 * incomplete profile. This mock Prisma client actually APPLIES the
 * `where` clause against an in-memory fixture (not just records what was
 * passed), so these tests exercise the real scoping behavior end-to-end,
 * not merely the shape of the query.
 */
describe("DashboardService.getSummary — Phase 10C content scoping", () => {
  // ---- Fixture hierarchy ----
  // Grade 1 / EG_NATIONAL: subject-math-g1-eg (selected by the test student), subject-arabic-g1-eg (not selected)
  // Grade 2 / EG_NATIONAL: subject-math-g2-eg (different grade)
  // Grade 1 / BRITISH_INTL: subject-math-g1-uk (different curriculum)
  const SUBJECTS = {
    "subject-math-g1-eg": { gradeId: "grade-1-eg" },
    "subject-arabic-g1-eg": { gradeId: "grade-1-eg" },
    "subject-math-g2-eg": { gradeId: "grade-2-eg" },
    "subject-math-g1-uk": { gradeId: "grade-1-uk" },
  };
  const UNITS = {
    "unit-math-g1-eg": { subjectId: "subject-math-g1-eg" },
    "unit-arabic-g1-eg": { subjectId: "subject-arabic-g1-eg" },
    "unit-math-g2-eg": { subjectId: "subject-math-g2-eg" },
    "unit-math-g1-uk": { subjectId: "subject-math-g1-uk" },
  };
  const ALL_TOPICS = [
    { id: "topic-addition-g1-eg", unitId: "unit-math-g1-eg", nameEn: "Addition (Part 1)", order: 1, teachingStepsJson: [{ type: "INTRO" }] },
    { id: "topic-arabic-reading-g1-eg", unitId: "unit-arabic-g1-eg", nameEn: "Reading Letters", order: 1, teachingStepsJson: [{ type: "INTRO" }] },
    { id: "topic-addition-g2-eg", unitId: "unit-math-g2-eg", nameEn: "Grade 2 Addition", order: 1, teachingStepsJson: [{ type: "INTRO" }] },
    { id: "topic-addition-g1-uk", unitId: "unit-math-g1-uk", nameEn: "UK Addition", order: 1, teachingStepsJson: [{ type: "INTRO" }] },
    { id: "topic-fractions-g1-eg-draft", unitId: "unit-math-g1-eg", nameEn: "Fractions (not yet interactive)", order: 2, teachingStepsJson: null },
  ];

  function makeService(opts: {
    profile?: any;
    selectedSubjectIds?: string[]; // StudentSubject rows
  }) {
    const profile = "profile" in opts ? opts.profile : {
      id: "student-1",
      userId: "user-1",
      fullName: "Test Student",
      curriculumId: "curriculum-eg",
      gradeId: "grade-1-eg",
      curriculum: { nameEn: "Egyptian National", nameAr: "المصري" },
      grade: { nameEn: "Grade 1", nameAr: "الأول" },
      subjects: (opts.selectedSubjectIds ?? []).map((subjectId) => ({
        subjectId,
        subject: { id: subjectId, nameEn: subjectId, nameAr: subjectId },
      })),
      learningPlans: [],
    };

    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
        assessment: { findFirst: jest.fn().mockResolvedValue(null) },
        questionAttempt: { findMany: jest.fn().mockResolvedValue([]) },
        topic: {
          findMany: jest.fn().mockImplementation(async ({ where }: any) => {
            const subjectIdIn: string[] = where?.unit?.subjectId?.in ?? [];
            const requiredGradeId: string | undefined = where?.unit?.subject?.gradeId;
            return ALL_TOPICS.filter((t) => {
              const unit = (UNITS as any)[t.unitId];
              if (!unit) return false;
              if (!subjectIdIn.includes(unit.subjectId)) return false;
              if (requiredGradeId) {
                const subject = (SUBJECTS as any)[unit.subjectId];
                if (!subject || subject.gradeId !== requiredGradeId) return false;
              }
              return true;
            }).map((t) => ({ ...t, unit: { nameEn: t.unitId, nameAr: t.unitId, order: 1 } }));
          }),
        },
        lessonSession: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as any;

    const topicAccuracy = { getPerTopicAccuracy: jest.fn().mockResolvedValue([]) } as any;
    return { service: new DashboardService(prisma, topicAccuracy), prisma };
  }

  it("CASE 1 — a Grade 1 EG_NATIONAL Mathematics student receives every Grade 1 Mathematics topic, generated or not", async () => {
    const { service } = makeService({ selectedSubjectIds: ["subject-math-g1-eg"] });
    const summary = await service.getSummary("user-1");
    // Includes topic-fractions-g1-eg-draft (teachingStepsJson: null) — see
    // CASE 6 below for why title-only topics must be listed too.
    expect(summary.pilotLessons.map((l: any) => l.topicId)).toEqual(["topic-addition-g1-eg", "topic-fractions-g1-eg-draft"]);
  });

  it("CASE 2 — same curriculum/grade but Mathematics NOT selected: zero Mathematics interactive topics", async () => {
    const { service } = makeService({ selectedSubjectIds: ["subject-arabic-g1-eg"] });
    const summary = await service.getSummary("user-1");
    expect(summary.pilotLessons.map((l: any) => l.topicId)).not.toContain("topic-addition-g1-eg");
    expect(summary.pilotLessons.map((l: any) => l.topicId)).toEqual(["topic-arabic-reading-g1-eg"]);
  });

  it("CASE 3 — a student from another grade never receives Grade 1 Mathematics topics, even if subjectIds somehow included that subject", async () => {
    // Grade 2 profile, but (defensively) subjectIds includes the GRADE-1 math subject id —
    // simulating a hypothetical stale/incorrect StudentSubject row. The grade-level guard must still block it.
    const { service } = makeService({
      profile: {
        id: "student-2", userId: "user-2", fullName: "Grade 2 Student",
        curriculumId: "curriculum-eg", gradeId: "grade-2-eg",
        curriculum: { nameEn: "Egyptian National", nameAr: "المصري" },
        grade: { nameEn: "Grade 2", nameAr: "الثاني" },
        subjects: [{ subjectId: "subject-math-g1-eg", subject: { id: "subject-math-g1-eg", nameEn: "x", nameAr: "x" } }],
        learningPlans: [],
      },
    });
    const summary = await service.getSummary("user-2");
    expect(summary.pilotLessons.map((l: any) => l.topicId)).not.toContain("topic-addition-g1-eg");
  });

  it("CASE 4 — a student from another curriculum never receives Egyptian National topics", async () => {
    const { service } = makeService({
      profile: {
        id: "student-3", userId: "user-3", fullName: "UK Student",
        curriculumId: "curriculum-uk", gradeId: "grade-1-uk",
        curriculum: { nameEn: "British International", nameAr: "البريطاني" },
        grade: { nameEn: "Grade 1", nameAr: "الأول" },
        subjects: [{ subjectId: "subject-math-g1-uk", subject: { id: "subject-math-g1-uk", nameEn: "x", nameAr: "x" } }],
        learningPlans: [],
      },
    });
    const summary = await service.getSummary("user-3");
    expect(summary.pilotLessons.map((l: any) => l.topicId)).toEqual(["topic-addition-g1-uk"]);
    expect(summary.pilotLessons.map((l: any) => l.topicId)).not.toContain("topic-addition-g1-eg");
  });

  it("CASE 5 — a profile with zero selected subjects never falls back to all interactive topics", async () => {
    const { service } = makeService({ selectedSubjectIds: [] });
    const summary = await service.getSummary("user-1");
    expect(summary.pilotLessons).toEqual([]);
  });

  it("CASE 5b — no StudentProfile at all fails closed with NotFoundException, never a default/fake summary", async () => {
    const { service } = makeService({ profile: null });
    await expect(service.getSummary("user-none")).rejects.toThrow(NotFoundException);
  });

  it("CASE 6 — a topic with teachingStepsJson = null (never opened yet) STILL appears, with status NOT_STARTED — launch-speed lazy-generation path (2026-09-19): the old behavior hid it here, and nothing else could ever make it visible, so a student had no way to discover or start it at all", async () => {
    const { service } = makeService({ selectedSubjectIds: ["subject-math-g1-eg"] });
    const summary = await service.getSummary("user-1");
    const draft = summary.pilotLessons.find((l: any) => l.topicId === "topic-fractions-g1-eg-draft");
    expect(draft).toBeDefined();
    expect(draft?.status).toBe("NOT_STARTED");
  });

  it("scopes the topic query itself by relational IDs (subjectId + gradeId), never by name", async () => {
    const { service, prisma } = makeService({ selectedSubjectIds: ["subject-math-g1-eg"] });
    await service.getSummary("user-1");
    const call = prisma.client.topic.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ unit: { subjectId: { in: ["subject-math-g1-eg"] }, subject: { gradeId: "grade-1-eg" } } });
  });
});
