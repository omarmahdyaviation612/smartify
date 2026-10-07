import { BadRequestException } from "@nestjs/common";
import { AdminCurriculumService } from "./admin-curriculum.service";

describe("AdminCurriculumService subject deletion and school terms", () => {
  function makeService(subjectResult: any) {
    const tx: any = {
      subject: { findUnique: jest.fn().mockResolvedValue(subjectResult), delete: jest.fn() },
      unit: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }), deleteMany: jest.fn() },
      aIUsage: { count: jest.fn().mockResolvedValue(0) },
      aIDailyUsageCounter: { count: jest.fn().mockResolvedValue(0), deleteMany: jest.fn() },
      practiceSubmission: { count: jest.fn().mockResolvedValue(0) },
      lessonTrial: { count: jest.fn().mockResolvedValue(0) },
      subscription: { count: jest.fn().mockResolvedValue(0) },
      aIConversation: { count: jest.fn().mockResolvedValue(0) },
      studentProgress: { count: jest.fn().mockResolvedValue(0), deleteMany: jest.fn() },
      questionAttempt: { count: jest.fn().mockResolvedValue(0), deleteMany: jest.fn() },
      quizResult: { count: jest.fn().mockResolvedValue(0), deleteMany: jest.fn() },
      lessonSession: { count: jest.fn().mockResolvedValue(0), deleteMany: jest.fn() },
      learningObjective: { deleteMany: jest.fn() },
      lessonDraft: { deleteMany: jest.fn() },
      questionDraft: { deleteMany: jest.fn() },
      lessonVisualAsset: { deleteMany: jest.fn() },
      topicGroundingAssignment: { deleteMany: jest.fn() },
      topicSourceEvidence: { deleteMany: jest.fn() },
      groundingConceptAlias: { deleteMany: jest.fn() },
      unitGroundingProgress: { deleteMany: jest.fn() },
      tutorAnswerCache: { deleteMany: jest.fn() },
      learningMaterial: { deleteMany: jest.fn() },
      lesson: { deleteMany: jest.fn() },
      question: { updateMany: jest.fn(), deleteMany: jest.fn() },
      topic: { deleteMany: jest.fn() },
    };
    const client = { $transaction: jest.fn((callback: (tx: any) => unknown) => callback(tx)) };
    const service = new AdminCurriculumService({ client } as any, {} as any, {} as any, {} as any, {} as any);
    return { service, tx, client };
  }

  it("refuses to delete a subject that has student entitlements", async () => {
    const { service, tx } = makeService({
      id: "subject-1",
      nameEn: "Math",
      units: [{ id: "unit-1", topics: [{ id: "topic-1", lessons: [], questions: [] }] }],
      sharedToSubjects: [],
      _count: { studentSubjects: 1 },
    });

    await expect(service.deleteSubject("subject-1")).rejects.toThrow(BadRequestException);
    expect(tx.subject.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete a subject selected in a student's free lesson trial", async () => {
    const { service, tx } = makeService({ id: "subject-1", nameEn: "Math", units: [], sharedToSubjects: [], _count: {} });
    tx.lessonTrial.count.mockResolvedValue(1);

    await expect(service.deleteSubject("subject-1")).rejects.toThrow(BadRequestException);
    expect(tx.lessonTrial.count).toHaveBeenCalledWith({ where: { subjectIds: { array_contains: ["subject-1"] } } });
    expect(tx.subject.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete a subject referenced by a subscription", async () => {
    const { service, tx } = makeService({ id: "subject-1", nameEn: "Math", units: [], sharedToSubjects: [], _count: {} });
    tx.subscription.count.mockResolvedValue(1);

    await expect(service.deleteSubject("subject-1")).rejects.toThrow(BadRequestException);
    expect(tx.subscription.count).toHaveBeenCalledWith({ where: { selectedSubjectIds: { array_contains: ["subject-1"] } } });
    expect(tx.subject.delete).not.toHaveBeenCalled();
  });

  it("assigns the requested term only to units that are still unassigned", async () => {
    const { service, tx } = makeService(null);
    tx.unit.updateMany.mockResolvedValue({ count: 8 });

    await expect(service.assignUnassignedUnitsToTerm("TERM_1")).resolves.toEqual({ updatedUnits: 8, term: "TERM_1" });
    expect(tx.unit.updateMany).toHaveBeenCalledWith({ where: { term: null }, data: { term: "TERM_1" } });
  });

  it("removes an unused subject and its curriculum tree in one transaction", async () => {
    const { service, tx, client } = makeService({
      id: "subject-1",
      nameEn: "Math",
      units: [{ id: "unit-1", topics: [{ id: "topic-1", lessons: [{ id: "lesson-1" }], questions: [{ id: "question-1" }] }] }],
      sharedToSubjects: [],
      grade: { level: 1, curriculum: { code: "BRITISH_INTL" } },
      _count: {},
    });

    await expect(service.deleteSubject("subject-1")).resolves.toMatchObject({ deletedUnits: 1, deletedTopics: 1 });
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.lesson.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["lesson-1"] } } });
    expect(tx.question.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["question-1"] } } });
    expect(tx.topic.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["topic-1"] } } });
    expect(tx.unit.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["unit-1"] } } });
    expect(tx.subject.delete).toHaveBeenCalledWith({ where: { id: "subject-1" } });
  });
});
