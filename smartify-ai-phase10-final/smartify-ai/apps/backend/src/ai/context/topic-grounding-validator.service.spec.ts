import { readFileSync } from "fs";
import { join } from "path";
import { VALIDATOR_PROMPT_VERSION, TopicGroundingValidatorService, buildValidatorPrompt, parseValidatorResponse } from "./topic-grounding-validator.service";
import { TopicGroundingAssignmentService } from "./topic-grounding-assignment.service";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

// IMPORTANT fixture design note: selectRelevantGrounding's keyword-overlap
// branch (Steps 1-3) only ever scores against CONCEPTS, and its exact-match
// branch only ever compares the FULL normalized title. So for a Topic to
// genuinely reach the validator (Steps 1-5 must all decline), the ONE
// candidate the validator confirms must be a topicHint with PARTIAL overlap
// (never an exact title match, and no CONCEPT may share any keyword with the
// Topic's title, or Steps 1-3 would already have resolved it deterministically).
const notes: GroundingNotes = {
  unitTitle: "Unit 5",
  gradeLevel: "Grade 4",
  subject: "Math",
  learningObjectives: ["Round numbers to the nearest ten."],
  concepts: [{ name: "Volcano Formation", description: "Unrelated concept.", sourcePages: [99], importance: "core" }],
  facts: [],
  vocabulary: [],
  skills: [],
  topicHints: [{ topicTitle: "Rounding Whole Numbers", relevantConcepts: [], sourcePages: [10] }],
  scopeNotes: [],
};

// Unresolved by Steps 1-5 (no concept and no exact hint match), but with
// exactly one unambiguous unclaimed topicHint candidate ("Rounding Whole
// Numbers", Jaccard 0.5 against this title).
const UNRESOLVED_TOPIC = { id: "t3", nameEn: "Rounding Numbers Practice", order: 3 };
const SIBLINGS = [
  { id: "t1", nameEn: "A Quiet Afternoon", order: 1 },
  { id: "t2", nameEn: "A Trip Downtown", order: 2 },
  UNRESOLVED_TOPIC,
];

describe("parseValidatorResponse", () => {
  it("accepts a clean SUPPORTED token", () => {
    expect(parseValidatorResponse("SUPPORTED")).toEqual({ supported: true, reason: "Model reported SUPPORTED." });
  });

  it("accepts SUPPORTED with a plain trailing reason", () => {
    const r = parseValidatorResponse("SUPPORTED - the evidence clearly matches.");
    expect(r.supported).toBe(true);
  });

  it("accepts a clean NOT_SUPPORTED token", () => {
    expect(parseValidatorResponse("NOT_SUPPORTED").supported).toBe(false);
  });

  it("fails safe to NOT_SUPPORTED for an empty response", () => {
    expect(parseValidatorResponse("").supported).toBe(false);
  });

  it("fails safe to NOT_SUPPORTED for a garbage word", () => {
    expect(parseValidatorResponse("maybe").supported).toBe(false);
  });

  it("fails safe to NOT_SUPPORTED for an ambiguous hedge after SUPPORTED", () => {
    expect(parseValidatorResponse("SUPPORTED, but actually not sure").supported).toBe(false);
  });

  it("fails safe to NOT_SUPPORTED for a JSON blob", () => {
    expect(parseValidatorResponse('{"answer":"yes"}').supported).toBe(false);
  });
});

describe("buildValidatorPrompt", () => {
  it("shows only the ONE candidate, never a full list to pick from", () => {
    const prompt = buildValidatorPrompt({
      topicNameEn: "Rounding Numbers Practice",
      topicOrder: 3,
      siblingTopics: [{ nameEn: "A Quiet Afternoon", order: 1, claimedNames: [] }],
      unitTitle: "Unit 5",
      subject: "Math",
      gradeLevel: "Grade 4",
      candidate: { kind: "HINT", name: "Rounding Whole Numbers", score: 0.5, hint: notes.topicHints[0] },
    });
    expect(prompt).toContain("CANDIDATE (topic hint): Rounding Whole Numbers");
    expect(prompt).toContain("never pick from this list");
    expect(prompt).not.toContain("Volcano Formation");
  });
});

describe("TopicGroundingValidatorService.validateCandidate", () => {
  function build(content: string, generateImpl?: () => Promise<any>) {
    const generate = generateImpl ? jest.fn(generateImpl) : jest.fn().mockResolvedValue({ content, inputTokens: 50, outputTokens: 5 });
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      client: {
        topic: {
          findUnique: jest.fn().mockResolvedValue({
            ...UNRESOLVED_TOPIC,
            groundingAssignment: null,
            unit: { id: "u1", groundingNotesJson: notes, groundingVersion: 1, groundingSourceFingerprint: "fp", topics: SIBLINGS },
          }),
        },
        topicGroundingAssignment: { upsert },
        aIUsage: { create: jest.fn().mockResolvedValue({}) },
      },
    } as any;
    const providerFactory = {
      getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate }, providerKey: "openai", model: "gpt-test" }),
      getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0, costPerOutputToken: 0 }),
    } as any;
    const usageService = {
      estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.01),
      reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "r1" }),
      releaseBudget: jest.fn().mockResolvedValue(undefined),
      reconcileBudget: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new TopicGroundingValidatorService(prisma, providerFactory, usageService, new TopicGroundingAssignmentService(prisma));
    return { service, upsert, generate, prisma, usageService };
  }

  it("persists READY via upsert on a SUPPORTED response, with method AI_MAPPER and validator version/reason", async () => {
    const { service, upsert, generate } = build("SUPPORTED - the description matches exactly.");
    const outcome = await service.validateCandidate("t3");
    expect(outcome.outcome).toBe("READY");
    expect(generate).toHaveBeenCalledTimes(1);
    const written = upsert.mock.calls[0][0].create;
    expect(written.method).toBe("AI_MAPPER");
    expect(written.status).toBe("READY");
    expect(written.confidence).toBe("HIGH");
    expect(written.mapperPromptVersion).toBe(VALIDATOR_PROMPT_VERSION);
    expect(written.reason).toContain("[VALIDATOR]");
    expect(written.matchedConceptNames).toEqual([]);
    expect(written.matchedHintTitles).toEqual(["Rounding Whole Numbers"]);
  });

  it("persists BLOCKED (never READY) on a NOT_SUPPORTED response", async () => {
    const { service, upsert } = build("NOT_SUPPORTED - the evidence is too weak.");
    const outcome = await service.validateCandidate("t3");
    expect(outcome.outcome).toBe("BLOCKED");
    const written = upsert.mock.calls[0][0].create;
    expect(written.status).toBe("BLOCKED");
    expect(written.confidence).toBe("LOW");
    expect(written.matchedConceptNames).toEqual([]);
  });

  it.each([["", "empty string"], ["maybe", "a bare unrelated word"], ["SUPPORTED, but actually not sure", "an ambiguous hedge"]])(
    "treats a malformed provider response (%s) as NOT_SUPPORTED — %s",
    async (content) => {
      const { service, upsert } = build(content);
      const outcome = await service.validateCandidate("t3");
      expect(outcome.outcome).toBe("BLOCKED");
      expect(upsert.mock.calls[0][0].create.status).toBe("BLOCKED");
    },
  );

  it("treats a JSON blob response as NOT_SUPPORTED", async () => {
    const { service, upsert } = build('{"verdict":"yes"}');
    const outcome = await service.validateCandidate("t3");
    expect(outcome.outcome).toBe("BLOCKED");
    expect(upsert.mock.calls[0][0].create.status).toBe("BLOCKED");
  });

  it("SKIPPED_DETERMINISTIC — no provider call — when Steps 1-5 would resolve the Topic", async () => {
    const { service, generate, prisma, upsert } = build("SUPPORTED");
    prisma.client.topic.findUnique.mockResolvedValue({
      id: "t1",
      nameEn: "Addition Facts",
      order: 1,
      groundingAssignment: null,
      unit: { id: "u1", groundingNotesJson: notes, groundingVersion: 1, groundingSourceFingerprint: "fp", topics: [{ id: "t1", nameEn: "Addition Facts", order: 1 }] },
    });
    const outcome = await service.validateCandidate("t1");
    expect(outcome.outcome).toBe("SKIPPED_DETERMINISTIC");
    expect(generate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("NOT_GROUNDED — no provider call — when the Unit has no completed grounding", async () => {
    const { service, generate, prisma, upsert } = build("SUPPORTED");
    prisma.client.topic.findUnique.mockResolvedValue({
      ...UNRESOLVED_TOPIC,
      groundingAssignment: null,
      unit: { id: "u1", groundingNotesJson: null, groundingVersion: null, groundingSourceFingerprint: null, topics: SIBLINGS },
    });
    const outcome = await service.validateCandidate("t3");
    expect(outcome.outcome).toBe("NOT_GROUNDED");
    expect(generate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("SKIPPED_ALREADY_READY — no provider call — when a valid READY assignment already exists", async () => {
    const { service, generate, prisma, upsert } = build("SUPPORTED");
    prisma.client.topic.findUnique.mockResolvedValue({
      ...UNRESOLVED_TOPIC,
      groundingAssignment: { status: "READY", unitGroundingVersion: 1, unitSourceFingerprint: "fp" },
      unit: { id: "u1", groundingNotesJson: notes, groundingVersion: 1, groundingSourceFingerprint: "fp", topics: SIBLINGS },
    });
    const outcome = await service.validateCandidate("t3");
    expect(outcome.outcome).toBe("SKIPPED_ALREADY_READY");
    expect(generate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("SKIPPED_NO_SINGLE_CANDIDATE — no provider call — when candidate identification finds none", async () => {
    const ambiguousNotes: GroundingNotes = {
      ...notes,
      concepts: [{ name: "Volcano Formation", description: "d", sourcePages: [99], importance: "core" }],
      topicHints: [
        { topicTitle: "The World and Beauty", relevantConcepts: [], sourcePages: [1] },
        { topicTitle: "The World and Nature", relevantConcepts: [], sourcePages: [2] },
        { topicTitle: "The World and Colors", relevantConcepts: [], sourcePages: [3] },
      ],
    };
    const { service, generate, prisma, upsert } = build("SUPPORTED");
    const ambiguousTopic = { id: "t3", nameEn: "How Does the World Become More Beautiful?", order: 3 };
    prisma.client.topic.findUnique.mockResolvedValue({
      ...ambiguousTopic,
      groundingAssignment: null,
      unit: {
        id: "u1",
        groundingNotesJson: ambiguousNotes,
        groundingVersion: 1,
        groundingSourceFingerprint: "fp",
        topics: [{ id: "t1", nameEn: "A Quiet Afternoon", order: 1 }, ambiguousTopic],
      },
    });
    const outcome = await service.validateCandidate("t3");
    expect(outcome.outcome).toBe("SKIPPED_NO_SINGLE_CANDIDATE");
    expect(generate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("makes exactly ONE provider call for a genuine single-candidate case, and propagates (never retries) a provider error", async () => {
    const { service, generate } = build("", async () => {
      throw new Error("provider quota exceeded");
    });
    await expect(service.validateCandidate("t3")).rejects.toThrow("provider quota exceeded");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("reserves/reconciles budget via AIUsageService, attributed to CONTENT_AUTHORING_ACTOR_ID, never a student", async () => {
    const { service, usageService, prisma } = build("SUPPORTED");
    await service.validateCandidate("t3");
    expect(usageService.reserveBudget.mock.calls[0][0]).toBe("cmtz6270z0000u9c5h6ua0y67");
    expect(usageService.reconcileBudget).toHaveBeenCalled();
    expect(prisma.client.aIUsage.create.mock.calls[0][0].data.userId).toBe("cmtz6270z0000u9c5h6ua0y67");
    expect(prisma.client.aIUsage.create.mock.calls[0][0].data.studentId).toBeNull();
  });
});

describe("the validator is structurally unreachable from any student-facing runtime path", () => {
  const backendSrc = join(__dirname, "..", "..");
  const read = (rel: string) => readFileSync(join(backendSrc, rel), "utf8");

  it("is not a provider in AIModule (nor any request-handling module)", () => {
    const module = read("ai/ai.module.ts");
    expect(module).not.toContain('from "./context/topic-grounding-validator.service"');
    for (const key of ["providers", "exports"]) {
      const list = module.split(`${key}: [`)[1]?.split("]")[0] ?? "";
      expect(list).not.toContain("TopicGroundingValidatorService");
    }
  });

  it("is not imported by any of the four runtime consumers", () => {
    for (const file of [
      "interactive-lesson/interactive-lesson.service.ts",
      "interactive-lesson/lesson-draft-generator/lesson-draft-generator.service.ts",
      "question-bank/question-draft-generator/question-draft-generator.service.ts",
      "tutor/tutor.service.ts",
    ]) {
      expect(read(file)).not.toContain("topic-grounding-validator");
      expect(read(file)).not.toContain("TopicGroundingValidatorService");
    }
  });
});
