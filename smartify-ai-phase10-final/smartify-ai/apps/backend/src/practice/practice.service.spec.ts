import { subjectAccessFixture } from "../common/subject-access.fixtures.testspec";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { withReadyGate } from "../ai/context/topic-content-gate.fixtures.testspec";
import { PracticeService } from "./practice.service";

/** Covers subject-ownership isolation for the practice engine — a student cannot fetch topics or questions for a subject they never selected. */
describe("PracticeService — authorization & ownership", () => {
  const studentProfile = { id: "student-1", subjects: [{ subjectId: "subject-1" }] };

  function makePrismaMock() {
    return {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        topic: { findMany: jest.fn().mockResolvedValue([withReadyGate({ id: "topic-1" })]) },
        question: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as any;
  }

  const topicAccuracy = { getPerTopicAccuracy: jest.fn().mockResolvedValue([]), getTopicAccuracy: jest.fn().mockResolvedValue(null) } as any;
  // topicId is always undefined in this describe block's calls, so the
  // "if (topicId)" guard in getAdaptiveQuestions() never actually reaches
  // this — a bare stub is enough. Real generation is exercised in
  // question-draft-generator.service.spec.ts.
  const questionGenerator = { ensurePoolForTopic: jest.fn() } as any;

  it("rejects listing topics for a subject the student never selected", async () => {
    const service = new PracticeService(subjectAccessFixture(makePrismaMock()), topicAccuracy, questionGenerator);
    await expect(service.getTopicsForSubject("user-1", "unrelated-subject")).rejects.toThrow(ForbiddenException);
  });

  it("rejects fetching adaptive practice questions for a subject the student never selected", async () => {
    const service = new PracticeService(subjectAccessFixture(makePrismaMock()), topicAccuracy, questionGenerator);
    await expect(service.getAdaptiveQuestions("user-1", "unrelated-subject", undefined)).rejects.toThrow(ForbiddenException);
  });

  it("allows listing topics for a subject the student genuinely selected", async () => {
    const service = new PracticeService(subjectAccessFixture(makePrismaMock()), topicAccuracy, questionGenerator);
    await expect(service.getTopicsForSubject("user-1", "subject-1")).resolves.toBeDefined();
  });
});

/**
 * Phase 10E: Practice's adaptive question pool must never leak seed/demo
 * placeholder Questions into a real student session — same rationale as
 * the Diagnostic's own filter (Phase 10D.1) and Quiz/Mock's (this phase).
 */
describe("PracticeService — placeholder containment", () => {
  const studentProfile = { id: "student-1", subjects: [{ subjectId: "subject-1" }] };
  const topicAccuracy = { getPerTopicAccuracy: jest.fn().mockResolvedValue([]), getTopicAccuracy: jest.fn().mockResolvedValue(null) } as any;
  const questionGenerator = { ensurePoolForTopic: jest.fn() } as any;

  it("test 22: excludes isPlaceholder:true Questions from the query itself, not just a post-filter", async () => {
    const questionFindMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        topic: { findMany: jest.fn().mockResolvedValue([withReadyGate({ id: "topic-1" })]) },
        question: { findMany: questionFindMany },
      },
    } as any;
    const service = new PracticeService(subjectAccessFixture(prisma), topicAccuracy, questionGenerator);

    await service.getAdaptiveQuestions("user-1", "subject-1", undefined);

    expect(questionFindMany.mock.calls[0][0].where).toMatchObject({ isPlaceholder: false });
  });

  it("test 25: still returns real, non-placeholder eligible Questions when they exist", async () => {
    const realQuestions = [
      { id: "q1", topicId: "topic-1", difficulty: "EASY", isPlaceholder: false },
      { id: "q2", topicId: "topic-1", difficulty: "MEDIUM", isPlaceholder: false },
    ];
    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        topic: { findMany: jest.fn().mockResolvedValue([withReadyGate({ id: "topic-1" })]) },
        question: { findMany: jest.fn().mockImplementation(async ({ where }: any) => realQuestions.filter((q) => q.isPlaceholder === where.isPlaceholder)) },
      },
    } as any;
    const service = new PracticeService(subjectAccessFixture(prisma), topicAccuracy, questionGenerator);

    const result = await service.getAdaptiveQuestions("user-1", "subject-1", undefined, 2);
    expect(result.questions.length).toBeGreaterThan(0);
  });
});

/**
 * Correctness hardening (2026-09-20) — submitPractice() had no meaningful
 * grading/persistence coverage before this suite. Answer shapes used here
 * (a single string, matching one of a fixed optionsJson list) are the ONLY
 * shape the real schema/validator actually produces today — see
 * question-draft-validator.ts's own documented MVP-ready-types contract
 * (MULTIPLE_CHOICE/TRUE_FALSE, correctAnswerJson always a single string).
 * No other answer shape is invented here.
 */
describe("PracticeService.submitPractice — grading & persistence", () => {
  const studentProfile = { id: "student-1", subjects: [{ subjectId: "subject-1" }] };

  // Two questions with DIFFERENT correct answers, both in the student's
  // owned "subject-1" — used to catch a class of bug where grading
  // accidentally compares against the wrong question's key (e.g.
  // array-position instead of a real id-keyed lookup). topic.unit.subjectId
  // is what submitPractice's scope-validation (2026-09-20) actually reads.
  const Q1 = { id: "q1", topicId: "topic-1", correctAnswerJson: "Paris", explanationEn: "Paris is the capital of France.", explanationAr: null, topic: withReadyGate({ id: "topic-1", unit: { subjectId: "subject-1" } }) };
  const Q2 = { id: "q2", topicId: "topic-1", correctAnswerJson: "London", explanationEn: "London is the capital of the UK.", explanationAr: null, topic: withReadyGate({ id: "topic-1", unit: { subjectId: "subject-1" } }) };

  function makePrisma(opts: { questions?: any[]; profile?: any } = {}) {
    const attemptCreateMany = jest.fn().mockResolvedValue({ count: 0 });
    const questionFindMany = jest.fn().mockResolvedValue(opts.questions ?? [Q1, Q2]);
    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue("profile" in opts ? opts.profile : studentProfile) },
        question: { findMany: questionFindMany },
        questionAttempt: { createMany: attemptCreateMany },
      },
    } as any;
    return { prisma, attemptCreateMany, questionFindMany };
  }

  it("A: a correct answer grades isCorrect=true and persists a matching QuestionAttempt with source \"practice\"", async () => {
    const { prisma, attemptCreateMany } = makePrisma();
    const service = new PracticeService(subjectAccessFixture(prisma), {} as any, {} as any);

    const result = await service.submitPractice("user-1", [{ questionId: "q1", answer: "Paris" }]);

    expect(result.feedback[0]).toMatchObject({ questionId: "q1", isCorrect: true });
    expect(result.correctCount).toBe(1);
    expect(attemptCreateMany).toHaveBeenCalledWith({
      data: [{ studentId: "student-1", questionId: "q1", answerJson: "Paris", isCorrect: true, source: "practice" }],
    });
  });

  it("B: an incorrect answer grades isCorrect=false and persists it as such", async () => {
    const { prisma, attemptCreateMany } = makePrisma();
    const service = new PracticeService(subjectAccessFixture(prisma), {} as any, {} as any);

    const result = await service.submitPractice("user-1", [{ questionId: "q1", answer: "Berlin" }]);

    expect(result.feedback[0]).toMatchObject({ questionId: "q1", isCorrect: false });
    expect(result.correctCount).toBe(0);
    expect(attemptCreateMany.mock.calls[0][0].data[0]).toMatchObject({ isCorrect: false });
  });

  it("C/D: multiple answers each map to and are graded against THEIR OWN Question's correctAnswerJson — not a neighboring question's key", async () => {
    const { prisma, attemptCreateMany } = makePrisma();
    const service = new PracticeService(subjectAccessFixture(prisma), {} as any, {} as any);

    // q1's real answer is "Paris"; the submitted answer for q1 is "London"
    // (q2's real answer) — a positional/index-based grading bug would
    // likely mark this correct against the wrong key. Likewise for q2.
    const result = await service.submitPractice("user-1", [
      { questionId: "q1", answer: "London" },
      { questionId: "q2", answer: "Paris" },
    ]);

    const byId = new Map(result.feedback.map((f) => [f.questionId, f]));
    expect(byId.get("q1")).toMatchObject({ isCorrect: false, correctAnswer: "Paris" });
    expect(byId.get("q2")).toMatchObject({ isCorrect: false, correctAnswer: "London" });
    expect(result.correctCount).toBe(0);

    const rowsById = new Map(attemptCreateMany.mock.calls[0][0].data.map((r: any) => [r.questionId, r]));
    expect(rowsById.get("q1")).toMatchObject({ questionId: "q1", answerJson: "London", isCorrect: false });
    expect(rowsById.get("q2")).toMatchObject({ questionId: "q2", answerJson: "Paris", isCorrect: false });
  });

  it("E: the persisted attempt's studentId is always the server-resolved profile id, never anything client-supplied (there is no client studentId field at all)", async () => {
    const { prisma, attemptCreateMany } = makePrisma({ profile: { id: "student-9", subjects: [{ subjectId: "subject-1" }] } });
    const service = new PracticeService(subjectAccessFixture(prisma), {} as any, {} as any);

    await service.submitPractice("user-1", [{ questionId: "q1", answer: "Paris" }]);

    expect(attemptCreateMany.mock.calls[0][0].data[0].studentId).toBe("student-9");
  });

  it("F: the persisted attempt references the real matched Question row by id, preserving the Question->Topic chain implicitly", async () => {
    const { prisma, attemptCreateMany } = makePrisma();
    const service = new PracticeService(subjectAccessFixture(prisma), {} as any, {} as any);

    await service.submitPractice("user-1", [{ questionId: "q2", answer: "London" }]);

    expect(attemptCreateMany.mock.calls[0][0].data[0].questionId).toBe("q2");
  });

  it("H: an empty submission is rejected explicitly with BadRequestException, after the onboarding/profile check", async () => {
    const { prisma, attemptCreateMany, questionFindMany } = makePrisma();
    const service = new PracticeService(subjectAccessFixture(prisma), {} as any, {} as any);

    await expect(service.submitPractice("user-1", [])).rejects.toThrow(BadRequestException);
    expect(questionFindMany).not.toHaveBeenCalled();
    expect(attemptCreateMany).not.toHaveBeenCalled();
  });

  it("I — CHARACTERIZATION (not a fix): an unknown/nonexistent questionId is silently dropped — no error, excluded from feedback/total/persistence, valid answers in the same submission are still processed normally", async () => {
    const { prisma, attemptCreateMany } = makePrisma({ questions: [Q1] }); // Prisma's own findMany would simply omit a nonexistent id from its result set — modeled here directly.
    const service = new PracticeService(subjectAccessFixture(prisma), {} as any, {} as any);

    const result = await service.submitPractice("user-1", [
      { questionId: "q1", answer: "Paris" },
      { questionId: "does-not-exist", answer: "anything" },
    ]);

    expect(result.total).toBe(1);
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0].questionId).toBe("q1");
    expect(attemptCreateMany.mock.calls[0][0].data).toHaveLength(1);
  });
});

/**
 * Question-scope validation (2026-09-20) — closes the gap the previous
 * task's "G" characterization test deliberately left open: submitPractice
 * now derives each resolved Question's real Subject via
 * Question.topic.unit.subjectId and rejects the WHOLE submission if any
 * resolved Question isn't in the student's own StudentSubject set. This
 * is a set-membership check, never a single-subject restriction — a
 * student may legitimately submit across several of their own owned
 * subjects in one request.
 */
describe("PracticeService.submitPractice — question-scope validation", () => {
  const studentProfile = { id: "student-1", subjects: [{ subjectId: "subject-1" }, { subjectId: "subject-2" }] };

  const OWNED_Q1 = { id: "q1", topicId: "topic-1", correctAnswerJson: "Paris", explanationEn: null, explanationAr: null, topic: withReadyGate({ id: "topic-1", unit: { subjectId: "subject-1" } }) };
  const OWNED_Q2_OTHER_SUBJECT = { id: "q2", topicId: "topic-2", correctAnswerJson: "4", explanationEn: null, explanationAr: null, topic: withReadyGate({ id: "topic-2", unit: { subjectId: "subject-2" } }) };
  const UNOWNED_Q = { id: "q-foreign", topicId: "topic-foreign", correctAnswerJson: "42", explanationEn: null, explanationAr: null, topic: withReadyGate({ id: "topic-foreign", unit: { subjectId: "subject-the-student-never-selected" } }) };

  function makePrisma(opts: { questions?: any[]; profile?: any } = {}) {
    const attemptCreateMany = jest.fn().mockResolvedValue({ count: 0 });
    const questionFindMany = jest.fn().mockResolvedValue(opts.questions ?? [OWNED_Q1]);
    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue("profile" in opts ? opts.profile : studentProfile) },
        question: { findMany: questionFindMany },
        questionAttempt: { createMany: attemptCreateMany },
      },
    } as any;
    return { prisma, attemptCreateMany, questionFindMany };
  }

  it("A: a Question from a Subject the student owns is accepted and persisted normally", async () => {
    const { prisma, attemptCreateMany } = makePrisma({ questions: [OWNED_Q1] });
    const service = new PracticeService(subjectAccessFixture(prisma), {} as any, {} as any);

    const result = await service.submitPractice("user-1", [{ questionId: "q1", answer: "Paris" }]);

    expect(result.feedback[0]).toMatchObject({ questionId: "q1", isCorrect: true });
    expect(attemptCreateMany).toHaveBeenCalledTimes(1);
  });

  it("B: a Question from a Subject the student does NOT own is rejected with ForbiddenException, and NOTHING is persisted", async () => {
    const { prisma, attemptCreateMany } = makePrisma({ questions: [UNOWNED_Q] });
    const service = new PracticeService(subjectAccessFixture(prisma), {} as any, {} as any);

    await expect(service.submitPractice("user-1", [{ questionId: "q-foreign", answer: "42" }])).rejects.toThrow(ForbiddenException);
    expect(attemptCreateMany).not.toHaveBeenCalled();
  });

  it("C: a mixed submission (one owned Question + one foreign Question) is rejected ATOMICALLY — the owned question's otherwise-valid attempt is NOT partially persisted", async () => {
    const { prisma, attemptCreateMany } = makePrisma({ questions: [OWNED_Q1, UNOWNED_Q] });
    const service = new PracticeService(subjectAccessFixture(prisma), {} as any, {} as any);

    await expect(
      service.submitPractice("user-1", [
        { questionId: "q1", answer: "Paris" }, // genuinely owned and genuinely correct
        { questionId: "q-foreign", answer: "42" }, // foreign subject
      ]),
    ).rejects.toThrow(ForbiddenException);
    expect(attemptCreateMany).not.toHaveBeenCalled(); // zero writes — not even for q1
  });

  it("D: Questions spanning TWO subjects the student BOTH owns are accepted together — this is a set-membership check, never a single-subject restriction", async () => {
    const { prisma, attemptCreateMany } = makePrisma({ questions: [OWNED_Q1, OWNED_Q2_OTHER_SUBJECT] });
    const service = new PracticeService(subjectAccessFixture(prisma), {} as any, {} as any);

    const result = await service.submitPractice("user-1", [
      { questionId: "q1", answer: "Paris" },
      { questionId: "q2", answer: "4" },
    ]);

    expect(result.total).toBe(2);
    expect(attemptCreateMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it("E: an unknown/nonexistent questionId alongside a foreign-subject question is still just silently skipped for the unknown one — the foreign one is what triggers the rejection, not the unknown id", async () => {
    const { prisma, attemptCreateMany } = makePrisma({ questions: [UNOWNED_Q] }); // "does-not-exist" never resolves to a row at all
    const service = new PracticeService(subjectAccessFixture(prisma), {} as any, {} as any);

    await expect(
      service.submitPractice("user-1", [
        { questionId: "does-not-exist", answer: "anything" },
        { questionId: "q-foreign", answer: "42" },
      ]),
    ).rejects.toThrow(ForbiddenException);
    expect(attemptCreateMany).not.toHaveBeenCalled();
  });

  it("cross-student integrity (§10): Student A cannot persist an attempt for a Question belonging only to a Subject Student A never selected — even though that Subject/Question is real, shared curriculum content another student (B) legitimately owns", async () => {
    // Student A owns only "subject-1"; the question belongs to "subject-2",
    // which happens to be a real subject some OTHER student (B) has
    // selected — the Question row itself is real, shared content (never
    // duplicated per-student); only Student A's own scope is what's being
    // tested here.
    const studentA = { id: "student-A", subjects: [{ subjectId: "subject-1" }] };
    const questionOwnedOnlyByBsSubject = { id: "q-b-only", topicId: "topic-b", correctAnswerJson: "x", explanationEn: null, explanationAr: null, topic: withReadyGate({ id: "topic-b", unit: { subjectId: "subject-2" } }) };
    const { prisma, attemptCreateMany } = makePrisma({ profile: studentA, questions: [questionOwnedOnlyByBsSubject] });
    const service = new PracticeService(subjectAccessFixture(prisma), {} as any, {} as any);

    await expect(service.submitPractice("user-A", [{ questionId: "q-b-only", answer: "x" }])).rejects.toThrow(ForbiddenException);
    expect(attemptCreateMany).not.toHaveBeenCalled();
  });
});
