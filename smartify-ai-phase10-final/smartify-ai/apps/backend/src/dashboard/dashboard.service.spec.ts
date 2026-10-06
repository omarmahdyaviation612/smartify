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
    gradeId?: string;
  }) {
    const profile = "profile" in opts ? opts.profile : {
      id: "student-1",
      userId: "user-1",
      fullName: "Test Student",
      curriculumId: "curriculum-eg",
      gradeId: opts.gradeId ?? "grade-1-eg",
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
        subject: { findMany: jest.fn(async ({ where }: any) => Object.entries(SUBJECTS).filter(([, s]) => s.gradeId === where.gradeId).map(([id]) => ({ id, nameEn: id, nameAr: id }))) },
        // Availability is an OFFERING (GradeSubject) since the shared-subjects
        // merge: the dashboard reads `.subject` off each offering row rather
        // than filtering `subject.gradeId` by the student's grade.
        gradeSubject: {
          findMany: jest.fn(async ({ where }: any) =>
            Object.entries(SUBJECTS)
              .filter(([, s]) => s.gradeId === where.gradeId)
              .map(([id, s]) => ({ id: `off-${id}`, gradeId: where.gradeId, subjectId: id, isActive: true, subject: { id, nameEn: id, nameAr: id, ...s } })),
          ),
        },
        assessment: { findFirst: jest.fn().mockResolvedValue(null) },
        questionAttempt: { findMany: jest.fn().mockResolvedValue([]) },
        topic: {
          findMany: jest.fn().mockImplementation(async ({ where }: any) => {
            const subjectIdIn: string[] = where?.unit?.subjectId?.in ?? [];
            return ALL_TOPICS.filter((t) => {
              const unit = (UNITS as any)[t.unitId];
              if (!unit) return false;
              if (!subjectIdIn.includes(unit.subjectId)) return false;
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

  // BEHAVIOUR CHANGE (shared subjects Phase 1, Task 11) — read this before
  // trusting this file as a grade-scoping guarantee.
  //
  // The dashboard used to add `subject: { gradeId: profile.gradeId }` as a
  // DEFENSIVE backstop: it assumed a StudentSubject row could be stale/point
  // at another grade's subject, and hid the content in that case. That clause
  // is gone, because a shared subject's content home IS another curriculum's
  // grade — the very case this change exists to serve — so the clause hid
  // legitimate content for exactly those students (see the regression test
  // below, and the GradeSubject offering rule in common/grade-subject.util.ts).
  //
  // The two purposes conflict and cannot both hold in one query, so the
  // backstop moved rather than disappeared: a stale entitlement is now caught
  // by the GradeSubject invariant checker
  // (common/grade-subject-invariants.ts, kind
  // ENTITLEMENT_NOT_OFFERED_FOR_STUDENT_GRADE — covered in
  // grade-subject-invariants.spec.ts and run read-only against the real
  // database by grade-subject-invariants.postgres.spec.ts).
  //
  // Net effect recorded here deliberately, and it CHANGED AGAIN with the
  // origin/main merge (2026-10-06): the dashboard now discovers subjects
  // through the same offering-based `subjectDiscoveryWhere` the rest of the
  // app uses, so a stale StudentSubject row pointing at a subject this grade
  // does not offer never reaches the topic query at all. The guarantee is
  // therefore RESTORED — and now for the right reason (availability is the
  // offering) rather than the removed `subject.gradeId` clause — while the
  // invariant checker still catches the bad row.
  it("CASE 3 — a stale StudentSubject row for another grade's subject is still hidden, now because the grade does not OFFER it", async () => {
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

    // grade-2-eg offers no such subject, so it is never listed.
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
    // Grade 1 EG_NATIONAL here, and nothing else: the CONTENT filter is the
    // student's own subjectIds. Availability is an OFFERING question
    // (GradeSubject), so `subject.gradeId` must NOT appear — a shared
    // subject's content home is a different curriculum's grade entirely.
    expect(call.where).toEqual({ unit: { subjectId: { in: ["subject-math-g1-eg"] } } });
  });

  // British Grade 1 owns no Arabic of its own: the Arabic Subject's content
  // home is grade-1-eg. Under the old `subject: { gradeId: profile.gradeId }`
  // clause this topic was filtered out and the student saw an empty Arabic
  // section — with no error anywhere.
  it("lists a shared subject's topics for a student whose grade merely offers it", async () => {
    (SUBJECTS as any)["subject-arabic-eg1"] = { gradeId: "grade-1-eg" };
    (UNITS as any)["unit-arabic-eg1"] = { subjectId: "subject-arabic-eg1" };
    ALL_TOPICS.push({
      id: "topic-arabic-eg1", unitId: "unit-arabic-eg1", nameEn: "Arabic Reading", order: 1,
      teachingStepsJson: [{ type: "INTRO" }],
    } as any);

    const { service, prisma } = makeService({ selectedSubjectIds: ["subject-arabic-eg1"], gradeId: "grade-1-uk" });
    // The whole point of a shared subject: the offering's grade is the
    // student's (grade-1-uk) while the subject's own content home is
    // grade-1-eg. The default fixture mock filters offerings by the subject's
    // home grade, so it is overridden here to model that deliberately.
    prisma.client.gradeSubject.findMany = jest.fn(async () => [
      { id: "off-arabic-uk1", gradeId: "grade-1-uk", subjectId: "subject-arabic-eg1", isActive: true,
        subject: { id: "subject-arabic-eg1", nameEn: "Arabic", nameAr: "العربية", gradeId: "grade-1-eg", isActive: true } },
    ]);

    const summary = await service.getSummary("user-1");

    expect(summary.pilotLessons.map((l: any) => l.topicId)).toContain("topic-arabic-eg1");
    // And it was discovered through the offering filter for the student's own grade.
    expect(prisma.client.gradeSubject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ gradeId: "grade-1-uk" }) }),
    );
  });
});
