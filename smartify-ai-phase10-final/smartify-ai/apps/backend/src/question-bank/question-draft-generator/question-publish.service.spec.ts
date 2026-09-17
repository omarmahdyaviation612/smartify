import { BadRequestException, NotFoundException } from "@nestjs/common";
import { QuestionPublishService } from "./question-publish.service";

const BASE_DRAFT = {
  id: "draft-1",
  topicId: "topic-1",
  type: "MULTIPLE_CHOICE",
  difficulty: "EASY",
  promptEn: "What is 2 + 2?",
  promptAr: "كم يساوي 2 + 2؟",
  optionsJson: ["3", "4", "5"],
  correctAnswerJson: "4",
  explanationEn: "2 + 2 makes 4.",
  explanationAr: "2 + 2 يساوي 4.",
  status: "pending_review",
  isAiGenerated: true,
  aiProvider: "openai",
  aiModel: "gpt-4o-mini",
  publishedQuestionId: null,
  publishedAt: null,
};

const REAL_TOPIC = { id: "topic-1", lessons: [{ isPlaceholder: false }] };
const PLACEHOLDER_TOPIC = { id: "topic-1", lessons: [{ isPlaceholder: true }] };

function makePrisma(overrides: any = {}) {
  const client = {
    questionDraft: {
      findUnique: jest.fn().mockResolvedValue("draft" in overrides ? overrides.draft : BASE_DRAFT),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...BASE_DRAFT, ...data })),
    },
    topic: {
      findUnique: jest.fn().mockImplementation(async (args: any) =>
        args?.include ? ("topicWithLessons" in overrides ? overrides.topicWithLessons : REAL_TOPIC) : ("topic" in overrides ? overrides.topic : { id: "topic-1" }),
      ),
    },
    question: {
      create: jest.fn().mockResolvedValue({ id: "question-1" }),
    },
  } as any;
  client.$transaction = (callback: any) => callback(client);
  return { client } as any;
}

describe("QuestionPublishService.approve", () => {
  it("test 11: approves a valid, human-reviewed pending_review draft", async () => {
    const prisma = makePrisma();
    const service = new QuestionPublishService(prisma);

    await service.approve("draft-1", "reviewer-1");

    expect(prisma.client.questionDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "draft-1" }, data: expect.objectContaining({ status: "approved", reviewedByUserId: "reviewer-1" }) }),
    );
  });

  it("test 19: reviewer metadata (reviewedAt, reviewedByUserId) persists on approve", async () => {
    const prisma = makePrisma();
    const service = new QuestionPublishService(prisma);
    await service.approve("draft-1", "reviewer-42");

    const data = prisma.client.questionDraft.update.mock.calls[0][0].data;
    expect(data.reviewedAt).toBeInstanceOf(Date);
    expect(data.reviewedByUserId).toBe("reviewer-42");
  });

  it("throws NotFoundException for an unknown draft", async () => {
    const prisma = makePrisma({ draft: null });
    const service = new QuestionPublishService(prisma);
    await expect(service.approve("missing")).rejects.toThrow(NotFoundException);
  });

  it("rejects approval of a draft that is not pending_review", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "approved" } });
    const service = new QuestionPublishService(prisma);
    await expect(service.approve("draft-1")).rejects.toThrow(BadRequestException);
  });

  it("test 10: an invalid draft (missing Arabic prompt) cannot approve", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, promptAr: null } });
    const service = new QuestionPublishService(prisma);
    await expect(service.approve("draft-1")).rejects.toThrow(BadRequestException);
    expect(prisma.client.questionDraft.update).not.toHaveBeenCalled();
  });

  it("rejects approval when the target Topic is a placeholder Topic", async () => {
    const prisma = makePrisma({ topicWithLessons: PLACEHOLDER_TOPIC });
    const service = new QuestionPublishService(prisma);
    await expect(service.approve("draft-1")).rejects.toThrow(BadRequestException);
    expect(prisma.client.questionDraft.update).not.toHaveBeenCalled();
  });

  it("rejects approval when the target Topic no longer exists", async () => {
    const prisma = makePrisma({ topicWithLessons: null });
    const service = new QuestionPublishService(prisma);
    await expect(service.approve("draft-1")).rejects.toThrow(BadRequestException);
  });
});

describe("QuestionPublishService.reject", () => {
  it("rejects a pending_review draft, recording a reason", async () => {
    const prisma = makePrisma();
    const service = new QuestionPublishService(prisma);
    await service.reject("draft-1", "reviewer-1", "Numbers don't match the stated difficulty.");

    expect(prisma.client.questionDraft.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: { status: "rejected", reviewedAt: expect.any(Date), reviewedByUserId: "reviewer-1", rejectionReason: "Numbers don't match the stated difficulty." },
    });
  });

  it("test 18: a rejected draft cannot publish", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "rejected" } });
    const service = new QuestionPublishService(prisma);
    await expect(service.publish("draft-1")).rejects.toThrow(BadRequestException);
    expect(prisma.client.question.create).not.toHaveBeenCalled();
  });

  it("cannot reject a draft that isn't pending_review", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "approved" } });
    const service = new QuestionPublishService(prisma);
    await expect(service.reject("draft-1")).rejects.toThrow(BadRequestException);
  });
});

describe("QuestionPublishService.reviewDraft", () => {
  it("test 20: persists bilingual field edits exactly as submitted", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, promptAr: null } });
    const service = new QuestionPublishService(prisma);

    await service.reviewDraft("draft-1", { promptAr: "نص عربي مراجَع.", explanationAr: "شرح عربي مراجَع." });

    expect(prisma.client.questionDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "draft-1" },
        data: expect.objectContaining({ promptAr: "نص عربي مراجَع.", explanationAr: "شرح عربي مراجَع." }),
      }),
    );
  });

  it("rejects reviewing a draft that is not pending_review", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "approved" } });
    const service = new QuestionPublishService(prisma);
    await expect(service.reviewDraft("draft-1", { promptAr: "x" })).rejects.toThrow(BadRequestException);
  });

  it("rejects an empty edit set", async () => {
    const prisma = makePrisma();
    const service = new QuestionPublishService(prisma);
    await expect(service.reviewDraft("draft-1", {})).rejects.toThrow(BadRequestException);
  });

  it("throws NotFoundException for an unknown draft", async () => {
    const prisma = makePrisma({ draft: null });
    const service = new QuestionPublishService(prisma);
    await expect(service.reviewDraft("missing", { promptAr: "x" })).rejects.toThrow(NotFoundException);
  });
});

describe("QuestionPublishService.publish", () => {
  it("test 9: pending_review cannot publish directly", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "pending_review" } });
    const service = new QuestionPublishService(prisma);
    await expect(service.publish("draft-1")).rejects.toThrow(BadRequestException);
    expect(prisma.client.question.create).not.toHaveBeenCalled();
  });

  it("test 12/13/14: an approved draft publishes exactly one Question, isPlaceholder=false, linked to the correct Topic", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "approved" } });
    const service = new QuestionPublishService(prisma);

    const result = await service.publish("draft-1");

    expect(prisma.client.question.create).toHaveBeenCalledTimes(1);
    const data = prisma.client.question.create.mock.calls[0][0].data;
    expect(data.isPlaceholder).toBe(false);
    expect(data.topicId).toBe("topic-1");
    expect(result).toEqual({ questionId: "question-1", alreadyPublished: false });
  });

  it("test 20 (publish side): bilingual fields persist exactly onto the published Question", async () => {
    const draft = { ...BASE_DRAFT, status: "approved", promptAr: "نص مراجَع بدقة.", explanationAr: "شرح مراجَع بدقة." };
    const prisma = makePrisma({ draft });
    const service = new QuestionPublishService(prisma);

    await service.publish("draft-1");

    const data = prisma.client.question.create.mock.calls[0][0].data;
    expect(data.promptAr).toBe("نص مراجَع بدقة.");
    expect(data.explanationAr).toBe("شرح مراجَع بدقة.");
  });

  it("preserves isAiGenerated from the draft's own origin", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "approved", isAiGenerated: true } });
    const service = new QuestionPublishService(prisma);
    await service.publish("draft-1");
    expect(prisma.client.question.create.mock.calls[0][0].data.isAiGenerated).toBe(true);
  });

  it("stores publishedQuestionId and publishedAt on the draft as part of the same transaction", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "approved" } });
    const service = new QuestionPublishService(prisma);
    await service.publish("draft-1");

    expect(prisma.client.questionDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "draft-1" }, data: expect.objectContaining({ status: "published", publishedQuestionId: "question-1" }) }),
    );
    expect(prisma.client.questionDraft.update.mock.calls[0][0].data.publishedAt).toBeInstanceOf(Date);
  });

  it("test 17: is transactional — a failure partway through never persists the publish-link update", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "approved" } });
    prisma.client.question.create = jest.fn().mockRejectedValue(new Error("simulated failure mid-transaction"));
    const service = new QuestionPublishService(prisma);

    await expect(service.publish("draft-1")).rejects.toThrow("simulated failure mid-transaction");
    expect(prisma.client.questionDraft.update).not.toHaveBeenCalled();
  });

  it("test 15/16: second publish call is idempotent — returns the existing Question ID, zero duplicate rows", async () => {
    const publishedDraft = { ...BASE_DRAFT, status: "published", publishedQuestionId: "question-1", publishedAt: new Date() };
    const prisma = makePrisma({ draft: publishedDraft });
    const service = new QuestionPublishService(prisma);

    const result = await service.publish("draft-1");

    expect(prisma.client.question.create).not.toHaveBeenCalled();
    expect(prisma.client.questionDraft.update).not.toHaveBeenCalled();
    expect(result).toEqual({ questionId: "question-1", alreadyPublished: true });
  });

  it("never depends on any AI provider — QuestionPublishService only takes PrismaService", () => {
    expect(QuestionPublishService.length).toBe(1);
  });
});
