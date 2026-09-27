import { readFileSync } from "fs";
import { join } from "path";
import { MAPPER_PROMPT_VERSION, TopicGroundingMapperService, buildMapperPrompt, validateMapperResponse } from "./topic-grounding-mapper.service";
import { TopicGroundingAssignmentService } from "./topic-grounding-assignment.service";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

const notes: GroundingNotes = {
  unitTitle: "Unit 4",
  gradeLevel: "Grade 2",
  subject: "English",
  learningObjectives: ["Retell a short story."],
  concepts: [
    { name: "Sequencing Events", description: "Ordering what happens.", sourcePages: [30], importance: "core" },
    { name: "Character Feelings", description: "How characters feel.", sourcePages: [31], importance: "core" },
  ],
  facts: [{ fact: "A story has a beginning, middle and end.", sourcePages: [30], importance: "core" }],
  vocabulary: [{ term: "sequence", meaning: "an order", sourcePages: [30] }],
  skills: [],
  topicHints: [{ topicTitle: "Retelling a Story", relevantConcepts: ["Sequencing Events"], sourcePages: [30] }],
  scopeNotes: [],
};

// A Topic whose title gives the deterministic steps nothing to work with —
// exactly the 118-Topic production shape the mapper exists for.
const UNRESOLVED_TOPIC = { id: "t3", nameEn: "The Lost Kite (Listening)", order: 3 };
const SIBLINGS = [
  { id: "t1", nameEn: "Sequencing Events", order: 1 },
  { id: "t2", nameEn: "Character Feelings", order: 2 },
  UNRESOLVED_TOPIC,
];

describe("validateMapperResponse", () => {
  it("accepts a selection made entirely of verbatim existing concepts and hint titles", () => {
    const result = validateMapperResponse(
      JSON.stringify({ matchedConceptNames: ["Sequencing Events"], matchedHintTitles: ["Retelling a Story"], confidence: "HIGH", reason: "The Topic retells a story." }),
      notes,
    );
    expect(result.ok).toBe(true);
    expect((result as any).matchedConceptNames).toEqual(["Sequencing Events"]);
  });

  it("rejects a HALLUCINATED concept name — and discards the WHOLE response, not just the bad name", () => {
    const result = validateMapperResponse(
      JSON.stringify({ matchedConceptNames: ["Sequencing Events", "Kite Flying Safety"], matchedHintTitles: null, confidence: "HIGH", reason: "r" }),
      notes,
    );
    expect(result.ok).toBe(false);
    expect((result as any).code).toBe("HALLUCINATED_CONCEPT_NAME");
    expect(result).not.toHaveProperty("matchedConceptNames");
  });

  it("rejects a name that differs from a real one only by case/whitespace (verbatim means verbatim)", () => {
    const result = validateMapperResponse(JSON.stringify({ matchedConceptNames: ["sequencing events "], matchedHintTitles: null, confidence: "HIGH", reason: "r" }), notes);
    expect((result as any).code).toBe("HALLUCINATED_CONCEPT_NAME");
  });

  it("accepts a name that is verbatim present in notes.vocabulary[].term, not concepts or hints (field-scope fix, 2026-09-27)", () => {
    // Mirrors the real production cases (Topics "Honoring the Guest", "A
    // Collage") where the model correctly named a vocabulary term and was
    // wrongly rejected because only concepts/hints were checked.
    const result = validateMapperResponse(
      JSON.stringify({ matchedConceptNames: ["sequence"], matchedHintTitles: null, confidence: "HIGH", reason: "The Topic teaches this vocabulary term." }),
      notes,
    );
    expect(result.ok).toBe(true);
    expect((result as any).matchedConceptNames).toEqual(["sequence"]);
  });

  it("still rejects a name absent from concepts, hints AND vocabulary (near-miss, no fuzzy matching introduced)", () => {
    const result = validateMapperResponse(
      JSON.stringify({ matchedConceptNames: ["sequencing"], matchedHintTitles: null, confidence: "HIGH", reason: "r" }),
      notes,
    );
    expect(result.ok).toBe(false);
    expect((result as any).code).toBe("HALLUCINATED_CONCEPT_NAME");
  });

  it("still rejects a vocabulary term that differs only by case/whitespace (verbatim means verbatim, even in the widened pool)", () => {
    const result = validateMapperResponse(
      JSON.stringify({ matchedConceptNames: ["Sequence "], matchedHintTitles: null, confidence: "HIGH", reason: "r" }),
      notes,
    );
    expect((result as any).code).toBe("HALLUCINATED_CONCEPT_NAME");
  });

  it("rejects a hallucinated hint title", () => {
    const result = validateMapperResponse(JSON.stringify({ matchedConceptNames: [], matchedHintTitles: ["Flying Kites"], confidence: "HIGH", reason: "r" }), notes);
    expect((result as any).code).toBe("HALLUCINATED_HINT_TITLE");
  });

  it("rejects unparseable JSON, empty output and a non-object", () => {
    expect((validateMapperResponse("not json at all", notes) as any).code).toBe("UNPARSEABLE_JSON");
    expect((validateMapperResponse("", notes) as any).code).toBe("UNPARSEABLE_JSON");
    expect((validateMapperResponse("[]", notes) as any).code).toBe("NOT_AN_OBJECT");
  });

  it("rejects missing or wrongly-typed required fields", () => {
    expect((validateMapperResponse(JSON.stringify({ matchedConceptNames: ["Sequencing Events"] }), notes) as any).code).toBe("MISSING_FIELDS");
    expect((validateMapperResponse(JSON.stringify({ matchedConceptNames: "Sequencing Events", confidence: "HIGH", reason: "r" }), notes) as any).code).toBe("MISSING_FIELDS");
    expect((validateMapperResponse(JSON.stringify({ matchedConceptNames: [], matchedHintTitles: null, confidence: "MAYBE", reason: "r" }), notes) as any).code).toBe("MISSING_FIELDS");
  });

  it("rejects an empty selection that claims HIGH confidence (a contradiction)", () => {
    expect((validateMapperResponse(JSON.stringify({ matchedConceptNames: [], matchedHintTitles: null, confidence: "HIGH", reason: "r" }), notes) as any).code).toBe("EMPTY_BUT_HIGH_CONFIDENCE");
  });

  it("accepts an empty selection at LOW confidence (the prescribed 'nothing matched' answer)", () => {
    expect(validateMapperResponse(JSON.stringify({ matchedConceptNames: [], matchedHintTitles: null, confidence: "LOW", reason: "Nothing relevant." }), notes).ok).toBe(true);
  });
});

describe("buildMapperPrompt", () => {
  const prompt = buildMapperPrompt({ topicNameEn: UNRESOLVED_TOPIC.nameEn, topicOrder: 3, siblingTopics: SIBLINGS, notes });

  it("instructs the model that it may only SELECT existing items and must never invent one", () => {
    expect(prompt).toContain("You are selecting EXISTING items from the lists provided below.");
    expect(prompt).toContain("You may NEVER invent a concept name or hint title that is not verbatim present in the lists.");
    expect(prompt).toContain("return an empty selection with confidence LOW");
    expect(prompt).toContain("Never guess.");
  });

  it("supplies the Topic, the Unit's OTHER Topic titles+order, and the full Unit grounding metadata", () => {
    expect(prompt).toContain('TOPIC TO ASSIGN: "The Lost Kite (Listening)" (order 3)');
    expect(prompt).toContain("1. Sequencing Events");
    expect(prompt).toContain("2. Character Feelings");
    expect(prompt).toContain("Retelling a Story");
    expect(prompt).toContain("Character Feelings");
    expect(prompt).toContain("A story has a beginning, middle and end.");
    expect(prompt).toContain("sequence");
    expect(prompt).toContain("Retell a short story.");
  });

  it("never lists the Topic being assigned among the sibling Topics it must not claim", () => {
    const siblingBlock = prompt.split("THE UNIT'S OTHER TOPICS")[1].split("LEARNING OBJECTIVES")[0];
    expect(siblingBlock).not.toContain("The Lost Kite");
  });
});

describe("TopicGroundingMapperService.mapTopic", () => {
  function build(content: string) {
    const generate = jest.fn().mockResolvedValue({ content, inputTokens: 100, outputTokens: 20 });
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      client: {
        topic: {
          findUnique: jest.fn().mockResolvedValue({
            ...UNRESOLVED_TOPIC,
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
    const service = new TopicGroundingMapperService(prisma, providerFactory, usageService, new TopicGroundingAssignmentService(prisma));
    return { service, upsert, generate, prisma, usageService };
  }

  it("persists a valid HIGH-confidence selection as an AI_MAPPER / READY row", async () => {
    const { service, upsert } = build(JSON.stringify({ matchedConceptNames: ["Sequencing Events"], matchedHintTitles: ["Retelling a Story"], confidence: "HIGH", reason: "It retells a story." }));
    const outcome = await service.mapTopic("t3");
    expect(outcome.outcome).toBe("READY");
    const written = upsert.mock.calls[0][0].create;
    expect(written.method).toBe("AI_MAPPER");
    expect(written.status).toBe("READY");
    expect(written.confidence).toBe("HIGH");
    expect(written.mapperModel).toBe("gpt-test");
    expect(written.mapperPromptVersion).toBe(MAPPER_PROMPT_VERSION);
    expect(written.reason).toBe("It retells a story.");
    expect(written.matchedConceptNames).toEqual(["Sequencing Events"]);
  });

  it("persists a vocabulary-only selection as an AI_MAPPER / READY row (previously wrongly BLOCKED as HALLUCINATED)", async () => {
    const { service, upsert } = build(JSON.stringify({ matchedConceptNames: ["sequence"], matchedHintTitles: null, confidence: "HIGH", reason: "This Topic teaches the vocabulary term directly." }));
    const outcome = await service.mapTopic("t3");
    expect(outcome.outcome).toBe("READY");
    const written = upsert.mock.calls[0][0].create;
    expect(written.status).toBe("READY");
    expect(written.matchedConceptNames).toEqual(["sequence"]);
  });

  it("persists a HALLUCINATED response as BLOCKED with NO selection kept", async () => {
    const { service, upsert } = build(JSON.stringify({ matchedConceptNames: ["Kite Flying Safety"], matchedHintTitles: null, confidence: "HIGH", reason: "r" }));
    const outcome = await service.mapTopic("t3");
    expect(outcome.outcome).toBe("BLOCKED");
    expect((outcome as any).code).toBe("HALLUCINATED_CONCEPT_NAME");
    expect(upsert.mock.calls[0][0].create.status).toBe("BLOCKED");
    expect(upsert.mock.calls[0][0].create.matchedConceptNames).toEqual([]);
  });

  it("persists MALFORMED JSON as BLOCKED", async () => {
    const { service, upsert } = build("{oops");
    expect((await service.mapTopic("t3")).outcome).toBe("BLOCKED");
    expect(upsert.mock.calls[0][0].create.status).toBe("BLOCKED");
    expect(upsert.mock.calls[0][0].create.confidence).toBe("LOW");
  });

  it("persists a LOW-confidence result as BLOCKED — never usable grounding, even though names validated", async () => {
    const { service, upsert } = build(JSON.stringify({ matchedConceptNames: ["Character Feelings"], matchedHintTitles: null, confidence: "LOW", reason: "Not sure." }));
    expect((await service.mapTopic("t3")).outcome).toBe("BLOCKED");
    const written = upsert.mock.calls[0][0].create;
    expect(written.status).toBe("BLOCKED");
    expect(written.confidence).toBe("LOW");
  });

  it("refuses to run at all for a Topic the deterministic steps would resolve (no provider call)", async () => {
    const { service, generate, prisma, upsert } = build("{}");
    prisma.client.topic.findUnique.mockResolvedValue({
      id: "t1",
      nameEn: "Sequencing Events",
      order: 1,
      unit: { id: "u1", groundingNotesJson: notes, groundingVersion: 1, groundingSourceFingerprint: "fp", topics: SIBLINGS },
    });
    expect((await service.mapTopic("t1")).outcome).toBe("SKIPPED_DETERMINISTIC");
    expect(generate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("makes no provider call and persists nothing when the Unit is not grounded", async () => {
    const { service, generate, prisma, upsert } = build("{}");
    prisma.client.topic.findUnique.mockResolvedValue({
      ...UNRESOLVED_TOPIC,
      unit: { id: "u1", groundingNotesJson: null, groundingVersion: null, groundingSourceFingerprint: null, topics: SIBLINGS },
    });
    expect((await service.mapTopic("t3")).outcome).toBe("NOT_GROUNDED");
    expect(generate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("bills the platform content-authoring actor, never a student", async () => {
    const { service, usageService, prisma } = build(JSON.stringify({ matchedConceptNames: ["Sequencing Events"], matchedHintTitles: null, confidence: "HIGH", reason: "r" }));
    await service.mapTopic("t3");
    expect(usageService.reserveBudget.mock.calls[0][0]).toBe("cmtz6270z0000u9c5h6ua0y67");
    expect(prisma.client.aIUsage.create.mock.calls[0][0].data.userId).toBe("cmtz6270z0000u9c5h6ua0y67");
  });
});

describe("the AI mapper is structurally unreachable from any student-facing runtime path", () => {
  const backendSrc = join(__dirname, "..", "..");
  const read = (rel: string) => readFileSync(join(backendSrc, rel), "utf8");

  it("is not a provider in AIModule (nor any request-handling module)", () => {
    const module = read("ai/ai.module.ts");
    // The name appears only in the comment explaining its deliberate absence —
    // never as an import, a provider or an export.
    expect(module).not.toContain('from "./context/topic-grounding-mapper.service"');
    for (const key of ["providers", "exports"]) {
      const list = module.split(`${key}: [`)[1]?.split("]")[0] ?? "";
      expect(list).not.toContain("TopicGroundingMapperService");
    }
  });

  it("is not imported by any of the four runtime consumers", () => {
    for (const file of [
      "interactive-lesson/interactive-lesson.service.ts",
      "interactive-lesson/lesson-draft-generator/lesson-draft-generator.service.ts",
      "question-bank/question-draft-generator/question-draft-generator.service.ts",
      "tutor/tutor.service.ts",
    ]) {
      expect(read(file)).not.toContain("topic-grounding-mapper");
      expect(read(file)).not.toContain("TopicGroundingMapperService");
    }
  });
});
