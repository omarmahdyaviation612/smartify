import { readFileSync } from "fs";
import { join } from "path";
import {
  TopicGroundingRefinementService,
  REFINEMENT_PROMPT_VERSION,
  validateRefinementResponse,
  buildRefinementPrompt,
} from "./topic-grounding-refinement.service";
import { TopicGroundingAssignmentService } from "./topic-grounding-assignment.service";
import { sliceFromAssignment } from "./topic-grounding-assignment.util";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

function notes(partial: Partial<GroundingNotes>): GroundingNotes {
  return {
    unitTitle: "Unit 9",
    gradeLevel: "Grade 6",
    subject: "Science",
    learningObjectives: ["Describe the water cycle."],
    concepts: [],
    facts: [],
    vocabulary: [],
    skills: [],
    topicHints: [],
    scopeNotes: [],
    ...partial,
  };
}

// Category B fixture: NO concept/hint dominant match (Steps 1-5 all decline),
// but evidence is scattered across facts/vocabulary/objectives.
const COARSE_NOTES = notes({
  concepts: [{ name: "Unrelated Concept", description: "d", sourcePages: [50], importance: "core" }],
  facts: [{ fact: "Evaporation turns liquid water into vapor.", sourcePages: [12], importance: "core" }],
  vocabulary: [{ term: "Condensation", meaning: "Vapor turning back into liquid.", sourcePages: [13] }],
  learningObjectives: ["Describe the water cycle.", "Explain condensation."],
});

const TOPIC = { id: "t1", nameEn: "The Water Cycle", nameAr: "دورة الماء", order: 1 };
// A second sibling Topic is required so unitTopicCount > 1 — otherwise
// selectRelevantGrounding's SINGLE_TOPIC_FALLBACK would deterministically
// (and correctly) claim the whole Unit for a lone Topic, which is not the
// Category B shape this suite is testing.
const SIBLINGS = [
  { id: "t1", nameEn: "The Water Cycle", order: 1 },
  { id: "t2", nameEn: "Rock Formations", order: 2 },
];

function build(content: string, generateImpl?: () => Promise<any>) {
  const generate = generateImpl ? jest.fn(generateImpl) : jest.fn().mockResolvedValue({ content, inputTokens: 80, outputTokens: 20 });
  const upsert = jest.fn().mockResolvedValue({});
  const prisma = {
    client: {
      topic: {
        findUnique: jest.fn().mockResolvedValue({
          ...TOPIC,
          groundingAssignment: null,
          unit: { id: "u1", groundingNotesJson: COARSE_NOTES, groundingVersion: 1, groundingSourceFingerprint: "fp", topics: SIBLINGS },
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
  const service = new TopicGroundingRefinementService(prisma, providerFactory, usageService, new TopicGroundingAssignmentService(prisma));
  return { service, upsert, generate, prisma, usageService };
}

describe("validateRefinementResponse", () => {
  it("accepts FACT, VOCABULARY, and OBJECTIVE selections in addition to CONCEPT/HINT", () => {
    const raw = JSON.stringify({
      supported: true,
      selectedItems: [
        { kind: "FACT", name: "Evaporation turns liquid water into vapor." },
        { kind: "VOCABULARY", name: "Condensation" },
        { kind: "OBJECTIVE", name: "Explain condensation." },
      ],
      confidence: "HIGH",
      reason: "Direct textual evidence for the water cycle.",
    });
    const result = validateRefinementResponse(raw, COARSE_NOTES);
    expect(result.ok).toBe(true);
    if (result.ok && result.supported) expect(result.selectedItems).toHaveLength(3);
  });

  it("accepts a minimal {supported: false} as a complete, valid negative response (no confidence/reason/selectedItems required)", () => {
    const result = validateRefinementResponse(JSON.stringify({ supported: false }), COARSE_NOTES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.supported).toBe(false);
      if (!result.supported) {
        expect(result.confidence).toBe("LOW"); // safe default, never fabricated as HIGH
        expect(typeof result.reason).toBe("string");
      }
    }
  });

  it("a supported:false response with irrelevant/malformed positive-only fields is still a valid negative — those fields are ignored, never used to promote", () => {
    const raw = JSON.stringify({ supported: false, selectedItems: "not even an array", confidence: 12345, reason: { not: "a string" } });
    const result = validateRefinementResponse(raw, COARSE_NOTES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.supported).toBe(false);
  });

  it("supported:true still requires confidence/reason — the positive path is NOT weakened by the negative-path fix", () => {
    const raw = JSON.stringify({ supported: true, selectedItems: [{ kind: "FACT", name: "Evaporation turns liquid water into vapor." }] });
    const result = validateRefinementResponse(raw, COARSE_NOTES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MISSING_FIELDS");
  });

  it("supported:true with hallucinated evidence is still rejected — the positive path is NOT weakened", () => {
    const raw = JSON.stringify({ supported: true, selectedItems: [{ kind: "FACT", name: "An invented fact." }], confidence: "HIGH", reason: "x" });
    const result = validateRefinementResponse(raw, COARSE_NOTES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("HALLUCINATED_ITEM");
  });

  it("rejects the whole response when any selected item is invented (not verbatim present)", () => {
    const raw = JSON.stringify({
      supported: true,
      selectedItems: [{ kind: "FACT", name: "A fact that was never extracted from any textbook." }],
      confidence: "HIGH",
      reason: "x",
    });
    const result = validateRefinementResponse(raw, COARSE_NOTES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("HALLUCINATED_ITEM");
  });

  it("rejects cross-Unit evidence — a name verbatim in some OTHER Unit's notes is still hallucinated against THIS Unit's notes (defense-in-depth)", () => {
    const otherUnitFactText = "A fact real only in a different Unit's notes.";
    const raw = JSON.stringify({ supported: true, selectedItems: [{ kind: "FACT", name: otherUnitFactText }], confidence: "HIGH", reason: "x" });
    const result = validateRefinementResponse(raw, COARSE_NOTES);
    expect(result.ok).toBe(false);
  });

  it("rejects supported:true with empty selectedItems", () => {
    const raw = JSON.stringify({ supported: true, selectedItems: [], confidence: "HIGH", reason: "x" });
    const result = validateRefinementResponse(raw, COARSE_NOTES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMPTY_BUT_SUPPORTED");
  });

  it("accepts a clean NOT_SUPPORTED response (Category-C shape: genuinely no evidence)", () => {
    const raw = JSON.stringify({ supported: false, confidence: "HIGH", reason: "No evidence anywhere in this Unit supports this Topic." });
    const result = validateRefinementResponse(raw, COARSE_NOTES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.supported).toBe(false);
  });

  it("rejects malformed/unparseable JSON and missing fields", () => {
    expect(validateRefinementResponse("not json", COARSE_NOTES).ok).toBe(false);
    expect(validateRefinementResponse('{"supported":true}', COARSE_NOTES).ok).toBe(false);
  });
});

describe("buildRefinementPrompt", () => {
  it("shows facts, vocabulary, and learning objectives — a broader surface than the mapper's concept+hint-only prompt", () => {
    const prompt = buildRefinementPrompt({
      topicNameEn: TOPIC.nameEn,
      topicNameAr: TOPIC.nameAr,
      topicOrder: TOPIC.order,
      siblingTopics: [],
      notes: COARSE_NOTES,
    });
    expect(prompt).toContain("Evaporation turns liquid water into vapor.");
    expect(prompt).toContain("Condensation");
    expect(prompt).toContain("Describe the water cycle.");
    expect(prompt).toContain("must NOT create facts, invent source pages");
  });
});

describe("TopicGroundingRefinementService.refineCoarseGrounding", () => {
  it("persists READY selecting a FACT and VOCABULARY term (evidence scattered outside concepts/hints)", async () => {
    const { service, upsert } = build(
      JSON.stringify({
        supported: true,
        selectedItems: [
          { kind: "FACT", name: "Evaporation turns liquid water into vapor." },
          { kind: "VOCABULARY", name: "Condensation" },
        ],
        confidence: "HIGH",
        reason: "Direct evidence.",
      }),
    );
    const outcome = await service.refineCoarseGrounding("t1");
    expect(outcome.outcome).toBe("READY");
    const written = upsert.mock.calls[0][0].create;
    expect(written.method).toBe("AI_MAPPER");
    expect(written.status).toBe("READY");
    expect(written.mapperPromptVersion).toBe(REFINEMENT_PROMPT_VERSION);
    expect(written.matchedConceptNames).toEqual(expect.arrayContaining(["Evaporation turns liquid water into vapor.", "Condensation"]));

    // Design-decision verification: the persisted fact/vocab TEXT resolves
    // back to REAL content (never an empty slice) via sliceFromAssignment.
    const slice = sliceFromAssignment(COARSE_NOTES, {
      unitGroundingVersion: 1,
      unitSourceFingerprint: "fp",
      assignmentVersion: 3,
      method: "AI_MAPPER",
      mapperPromptVersion: REFINEMENT_PROMPT_VERSION,
      status: "READY",
      matchedConceptNames: written.matchedConceptNames,
      matchedHintTitles: written.matchedHintTitles,
    });
    expect(slice).not.toBeNull();
    expect(slice!.facts.map((f) => f.fact)).toContain("Evaporation turns liquid water into vapor.");
    expect(slice!.vocabulary.map((v) => v.term)).toContain("Condensation");
    // sourcePages inherited from the ORIGINAL fact/vocab objects, never invented.
    const fact = slice!.facts.find((f) => f.fact === "Evaporation turns liquid water into vapor.");
    expect(fact!.sourcePages).toEqual([12]);
  });

  it("persists BLOCKED (never READY) on NOT_SUPPORTED", async () => {
    const { service, upsert } = build(JSON.stringify({ supported: false, confidence: "HIGH", reason: "No evidence found." }));
    const outcome = await service.refineCoarseGrounding("t1");
    expect(outcome.outcome).toBe("VALID_NOT_SUPPORTED");
    expect(upsert.mock.calls[0][0].create.status).toBe("BLOCKED");
  });

  it("persists BLOCKED (never READY) on LOW confidence, even if supported:true (LOW is never promoted)", async () => {
    const { service, upsert } = build(
      JSON.stringify({ supported: true, selectedItems: [{ kind: "FACT", name: "Evaporation turns liquid water into vapor." }], confidence: "LOW", reason: "weak" }),
    );
    const outcome = await service.refineCoarseGrounding("t1");
    expect(outcome.outcome).toBe("VALID_NOT_SUPPORTED");
    expect(upsert.mock.calls[0][0].create.status).toBe("BLOCKED");
  });

  it("Category-C-shaped fixture (genuinely no matching evidence anywhere) results in BLOCKED, never force-matched", async () => {
    const { service, upsert, prisma } = build(JSON.stringify({ supported: false, confidence: "HIGH", reason: "Nothing in this Unit covers this Topic." }));
    prisma.client.topic.findUnique.mockResolvedValue({
      id: "t9",
      nameEn: "A Totally Unrelated Topic",
      nameAr: "x",
      order: 1,
      groundingAssignment: null,
      unit: {
        id: "u2",
        groundingNotesJson: notes({ concepts: [{ name: "Something Else Entirely", description: "d", sourcePages: [1], importance: "core" }] }),
        groundingVersion: 1,
        groundingSourceFingerprint: "fp",
        topics: [
          { id: "t9", nameEn: "A Totally Unrelated Topic", order: 1 },
          { id: "t10", nameEn: "Another Sibling Topic", order: 2 },
        ],
      },
    });
    const outcome = await service.refineCoarseGrounding("t9");
    expect(outcome.outcome).toBe("VALID_NOT_SUPPORTED");
    expect(upsert.mock.calls[0][0].create.status).toBe("BLOCKED");
  });

  it("SKIPPED_DETERMINISTIC — no provider call — when Steps 1-5 would already resolve the Topic", async () => {
    const { service, generate, prisma, upsert } = build("{}");
    prisma.client.topic.findUnique.mockResolvedValue({
      id: "t1",
      nameEn: "Unrelated Concept",
      nameAr: "x",
      order: 1,
      groundingAssignment: null,
      unit: { id: "u1", groundingNotesJson: COARSE_NOTES, groundingVersion: 1, groundingSourceFingerprint: "fp", topics: [{ id: "t1", nameEn: "Unrelated Concept", order: 1 }] },
    });
    const outcome = await service.refineCoarseGrounding("t1");
    expect(outcome.outcome).toBe("SKIPPED_DETERMINISTIC");
    expect(generate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("SKIPPED_ALREADY_READY — no provider call — when a valid READY assignment already exists", async () => {
    const { service, generate, prisma, upsert } = build("{}");
    prisma.client.topic.findUnique.mockResolvedValue({
      ...TOPIC,
      groundingAssignment: { status: "READY", unitGroundingVersion: 1, unitSourceFingerprint: "fp" },
      unit: { id: "u1", groundingNotesJson: COARSE_NOTES, groundingVersion: 1, groundingSourceFingerprint: "fp", topics: SIBLINGS },
    });
    const outcome = await service.refineCoarseGrounding("t1");
    expect(outcome.outcome).toBe("SKIPPED_ALREADY_READY");
    expect(generate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("SKIPPED_ALREADY_VALID_NOT_SUPPORTED — no provider call — when a prior run already persisted a genuinely-decided verdict under the current REFINEMENT_PROMPT_VERSION", async () => {
    const { service, generate, prisma, upsert } = build("{}");
    prisma.client.topic.findUnique.mockResolvedValue({
      ...TOPIC,
      groundingAssignment: {
        status: "BLOCKED",
        method: "AI_MAPPER",
        unitGroundingVersion: 1,
        unitSourceFingerprint: "fp",
        mapperPromptVersion: REFINEMENT_PROMPT_VERSION,
        reason: "[REFINEMENT:DECIDED] Nothing in this Unit covers this Topic.",
      },
      unit: { id: "u1", groundingNotesJson: COARSE_NOTES, groundingVersion: 1, groundingSourceFingerprint: "fp", topics: SIBLINGS },
    });
    const outcome = await service.refineCoarseGrounding("t1");
    expect(outcome.outcome).toBe("SKIPPED_ALREADY_VALID_NOT_SUPPORTED");
    expect(generate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("a persisted row from a TECHNICAL failure (no DECIDED_PREFIX — e.g. a stale row from before this fix) is NOT skipped — it always falls through to a real retry", async () => {
    const { service, generate, prisma } = build(JSON.stringify({ supported: false, confidence: "HIGH", reason: "x" }));
    prisma.client.topic.findUnique.mockResolvedValue({
      ...TOPIC,
      groundingAssignment: {
        status: "BLOCKED",
        method: "AI_MAPPER",
        unitGroundingVersion: 1,
        unitSourceFingerprint: "fp",
        mapperPromptVersion: REFINEMENT_PROMPT_VERSION,
        reason: "[REFINEMENT] MISSING_FIELDS: a stale technical-failure row from before this fix.",
      },
      unit: { id: "u1", groundingNotesJson: COARSE_NOTES, groundingVersion: 1, groundingSourceFingerprint: "fp", topics: SIBLINGS },
    });
    const outcome = await service.refineCoarseGrounding("t1");
    expect(generate).toHaveBeenCalledTimes(1); // a real attempt was made, not skipped
    expect(outcome.outcome).toBe("VALID_NOT_SUPPORTED");
  });

  it("a TECHNICAL_FAILURE (malformed JSON) is never persisted — so a rerun always retries it for real, never treating it as decided", async () => {
    const { service, upsert } = build("not valid json at all");
    const outcome = await service.refineCoarseGrounding("t1");
    expect(outcome.outcome).toBe("TECHNICAL_FAILURE");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("a TECHNICAL_FAILURE (hallucinated item on a supported:true response) is never persisted either", async () => {
    const { service, upsert } = build(JSON.stringify({ supported: true, selectedItems: [{ kind: "FACT", name: "An invented fact." }], confidence: "HIGH", reason: "x" }));
    const outcome = await service.refineCoarseGrounding("t1");
    expect(outcome.outcome).toBe("TECHNICAL_FAILURE");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("NOT_GROUNDED — no provider call — when the Unit has no completed grounding", async () => {
    const { service, generate, prisma, upsert } = build("{}");
    prisma.client.topic.findUnique.mockResolvedValue({
      ...TOPIC,
      groundingAssignment: null,
      unit: { id: "u1", groundingNotesJson: null, groundingVersion: null, groundingSourceFingerprint: null, topics: SIBLINGS },
    });
    const outcome = await service.refineCoarseGrounding("t1");
    expect(outcome.outcome).toBe("NOT_GROUNDED");
    expect(generate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("propagates (never swallows/retries) a provider quota-outage error, and makes exactly ONE call", async () => {
    const { service, generate } = build("", async () => {
      throw new Error("provider quota exceeded");
    });
    await expect(service.refineCoarseGrounding("t1")).rejects.toThrow("provider quota exceeded");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("attributes budget/usage to CONTENT_AUTHORING_ACTOR_ID, never a student", async () => {
    const { service, usageService, prisma } = build(JSON.stringify({ supported: false, confidence: "HIGH", reason: "x" }));
    await service.refineCoarseGrounding("t1");
    expect(usageService.reserveBudget.mock.calls[0][0]).toBe("cmtz6270z0000u9c5h6ua0y67");
    expect(prisma.client.aIUsage.create.mock.calls[0][0].data.studentId).toBeNull();
  });
});

describe("TopicGroundingRefinementService is structurally unreachable from any student-facing runtime path", () => {
  const backendSrc = join(__dirname, "..", "..");
  const read = (rel: string) => readFileSync(join(backendSrc, rel), "utf8");

  it("is not a provider in AIModule", () => {
    const module = read("ai/ai.module.ts");
    expect(module).not.toContain('from "./context/topic-grounding-refinement.service"');
    for (const key of ["providers", "exports"]) {
      const list = module.split(`${key}: [`)[1]?.split("]")[0] ?? "";
      expect(list).not.toContain("TopicGroundingRefinementService");
    }
  });

  it("is not imported by any of the four runtime consumers", () => {
    for (const file of [
      "interactive-lesson/interactive-lesson.service.ts",
      "interactive-lesson/lesson-draft-generator/lesson-draft-generator.service.ts",
      "question-bank/question-draft-generator/question-draft-generator.service.ts",
      "tutor/tutor.service.ts",
    ]) {
      expect(read(file)).not.toContain("topic-grounding-refinement");
    }
  });
});
