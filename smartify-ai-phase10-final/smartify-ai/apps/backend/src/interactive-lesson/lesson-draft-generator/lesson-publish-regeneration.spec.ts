import { installAutoDraftIntoTopic } from "./lesson-publish.service";

/**
 * 2026-10-10 safe regeneration: replacing a Topic's teachingSteps must never
 * break students who already studied it.
 */
function makeTx(opts: { existingLessons?: Array<{ id: string; progress: number }>; sessions?: any[] } = {}) {
  const lessons = (opts.existingLessons ?? []).map((l) => ({ ...l }));
  const sessions = (opts.sessions ?? []).map((s) => ({ ...s }));
  let convCounter = 0;
  const tx: any = {
    lessonDraft: { updateMany: jest.fn(), update: jest.fn() },
    lesson: {
      findMany: jest.fn(async () => lessons.map((l) => ({ id: l.id }))),
      delete: jest.fn(async ({ where: { id } }: any) => ({ id })),
      deleteMany: jest.fn(),
      update: jest.fn(async ({ where: { id }, data }: any) => ({ id, ...data })),
      create: jest.fn(async ({ data }: any) => ({ id: "lesson-new", ...data })),
    },
    learningObjective: {
      deleteMany: jest.fn(),
      create: jest.fn(async ({ data }: any) => ({ id: `lo-${data.descriptionEn}`, ...data })),
    },
    studentProgress: { count: jest.fn(async ({ where: { lessonId } }: any) => lessons.find((l) => l.id === lessonId)?.progress ?? 0) },
    topic: { update: jest.fn(async ({ where: { id }, data }: any) => ({ id, ...data })) },
    lessonSession: {
      findMany: jest.fn(async ({ where }: any) => sessions.filter((s) => s.topicId === where.topicId && s.status === where.status)),
      update: jest.fn(async ({ where: { id }, data }: any) => Object.assign(sessions.find((s) => s.id === id), data)),
    },
    aIConversation: { create: jest.fn(async ({ data }: any) => ({ id: `conv-new-${++convCounter}`, ...data })) },
  };
  return { tx, lessons, sessions };
}

const DRAFT = { id: "draft-2", topicNameEn: "The digestive system", topicNameAr: "الجهاز الهضمي", teachingStepsJson: [{ id: "s1" }] };
const OBJECTIVES = [{ objectiveEn: "Name the organs", objectiveAr: "يسمي الأعضاء" }];

describe("installAutoDraftIntoTopic — safe regeneration", () => {
  it("reuses the existing AI Lesson row instead of deleting it (StudentProgress keeps its foreign key)", async () => {
    const { tx } = makeTx({ existingLessons: [{ id: "lesson-old", progress: 3 }] });
    const result = await installAutoDraftIntoTopic(tx, DRAFT, "topic-1", OBJECTIVES);
    expect(result.lesson.id).toBe("lesson-old");
    expect(tx.lesson.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "lesson-old" } }));
    expect(tx.lesson.create).not.toHaveBeenCalled();
    expect(tx.lesson.delete).not.toHaveBeenCalled();
    expect(tx.lesson.deleteMany).not.toHaveBeenCalled();
    expect(tx.learningObjective.deleteMany).toHaveBeenCalledWith({ where: { lessonId: { in: ["lesson-old"] } } });
    expect(tx.learningObjective.create).toHaveBeenCalledTimes(1);
  });

  it("removes duplicate AI Lesson rows only when no StudentProgress points at them", async () => {
    const { tx } = makeTx({ existingLessons: [{ id: "keep", progress: 0 }, { id: "dup-free", progress: 0 }, { id: "dup-used", progress: 2 }] });
    await installAutoDraftIntoTopic(tx, DRAFT, "topic-1", OBJECTIVES);
    expect(tx.lesson.delete).toHaveBeenCalledTimes(1);
    expect(tx.lesson.delete).toHaveBeenCalledWith({ where: { id: "dup-free" } });
  });

  it("restarts IN_PROGRESS sessions on the new steps and leaves COMPLETED sessions alone", async () => {
    const { tx, sessions } = makeTx({
      existingLessons: [{ id: "lesson-old", progress: 1 }],
      sessions: [
        { id: "a", topicId: "topic-1", studentId: "st-1", status: "IN_PROGRESS", currentStepIndex: 4, stepResultsJson: [{ stepId: "s5" }], nonProgressTurns: 7, conversationId: "conv-a", conversation: { subjectId: "sub-1", title: "T" } },
        { id: "b", topicId: "topic-1", studentId: "st-2", status: "COMPLETED", currentStepIndex: 6, stepResultsJson: [{ stepId: "s7" }], nonProgressTurns: 1, conversationId: "conv-b", conversation: { subjectId: "sub-1", title: "T" } },
      ],
    });
    await installAutoDraftIntoTopic(tx, DRAFT, "topic-1", OBJECTIVES);
    const [inFlight, completed] = sessions;
    expect(inFlight).toMatchObject({ currentStepIndex: 0, stepResultsJson: [], nonProgressTurns: 0, conversationId: "conv-new-1" });
    expect(tx.aIConversation.create).toHaveBeenCalledWith({ data: { studentId: "st-1", subjectId: "sub-1", topicId: "topic-1", title: "T" } });
    expect(completed).toMatchObject({ status: "COMPLETED", currentStepIndex: 6, conversationId: "conv-b" });
  });

  it("first-time publish (no previous Lesson) creates the Lesson and touches no sessions", async () => {
    const { tx } = makeTx();
    const result = await installAutoDraftIntoTopic(tx, DRAFT, "topic-1", OBJECTIVES);
    expect(result.lesson.id).toBe("lesson-new");
    expect(tx.lessonSession.findMany).not.toHaveBeenCalled();
  });
});
