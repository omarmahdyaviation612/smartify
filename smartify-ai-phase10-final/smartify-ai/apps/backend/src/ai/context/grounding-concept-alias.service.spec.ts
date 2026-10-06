import { readFileSync } from "fs";
import { join } from "path";
import { validateAliasResponse, buildAliasSourceItems, buildAliasPrompt, GroundingConceptAliasService, ALIAS_GENERATION_VERSION } from "./grounding-concept-alias.service";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

function notes(partial: Partial<GroundingNotes>): GroundingNotes {
  return {
    unitTitle: "Unit 1",
    gradeLevel: "Grade 4",
    subject: "Islamic Education",
    learningObjectives: [],
    concepts: [],
    facts: [],
    vocabulary: [],
    skills: [],
    topicHints: [],
    scopeNotes: [],
    ...partial,
  };
}

const BASE_NOTES = notes({
  concepts: [
    { name: "النبوة", description: "Prophethood.", sourcePages: [1], importance: "core" },
    { name: "الرسالة", description: "Messengership.", sourcePages: [2], importance: "core" },
  ],
  topicHints: [{ topicTitle: "Faith and Prophethood", relevantConcepts: ["النبوة"], sourcePages: [1] }],
});

describe("validateAliasResponse", () => {
  it("accepts a well-formed response restating real concepts/hints in the other language", () => {
    const raw = JSON.stringify([
      { itemKind: "CONCEPT", itemName: "النبوة", canonicalLabel: "prophethood", aliasEn: "Prophethood", aliasAr: null },
      { itemKind: "CONCEPT", itemName: "الرسالة", canonicalLabel: "messengership", aliasEn: "Messengership", aliasAr: null },
      { itemKind: "HINT", itemName: "Faith and Prophethood", canonicalLabel: "faith-prophethood", aliasEn: null, aliasAr: "الإيمان والنبوة" },
    ]);
    const result = validateAliasResponse(raw, BASE_NOTES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.accepted).toHaveLength(3);
  });

  it("rejects the WHOLE response when any single item references a non-existent concept (one bad item taints everything)", () => {
    const raw = JSON.stringify([
      { itemKind: "CONCEPT", itemName: "النبوة", canonicalLabel: "prophethood", aliasEn: "Prophethood", aliasAr: null },
      { itemKind: "CONCEPT", itemName: "A Concept That Was Never Extracted", canonicalLabel: "invented", aliasEn: "Invented", aliasAr: null },
    ]);
    const result = validateAliasResponse(raw, BASE_NOTES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("HALLUCINATED_ITEM");
  });

  it("rejects malformed/unparseable JSON", () => {
    expect(validateAliasResponse("not json", BASE_NOTES).ok).toBe(false);
    expect(validateAliasResponse('{"not":"an array"}', BASE_NOTES).ok).toBe(false);
  });

  it("accepts a valid array wrapped in a ```json Markdown code fence (a real production failure: OpenAI's json_object response mode can't be used here since this response is an array, so the model sometimes wraps it in prose/fences instead)", () => {
    const inner = JSON.stringify([{ itemKind: "CONCEPT", itemName: "النبوة", canonicalLabel: "prophethood", aliasEn: "Prophethood", aliasAr: null }]);
    const raw = "```json\n" + inner + "\n```";
    const result = validateAliasResponse(raw, BASE_NOTES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.accepted).toHaveLength(1);
  });

  it("accepts a valid array wrapped in a plain ``` code fence (no language tag)", () => {
    const inner = JSON.stringify([{ itemKind: "CONCEPT", itemName: "الرسالة", canonicalLabel: "messengership", aliasEn: "Messengership", aliasAr: null }]);
    const raw = "```\n" + inner + "\n```";
    const result = validateAliasResponse(raw, BASE_NOTES);
    expect(result.ok).toBe(true);
  });

  it("still rejects genuinely malformed content even inside a code fence — fence-stripping never masks a real parse failure", () => {
    const raw = "```json\nnot actually json\n```";
    const result = validateAliasResponse(raw, BASE_NOTES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNPARSEABLE_JSON");
  });

  it("rejects an alias implausibly long relative to the source item's own name (fabricated-elaboration guard)", () => {
    const raw = JSON.stringify([
      {
        itemKind: "CONCEPT",
        itemName: "النبوة",
        canonicalLabel: "prophethood",
        aliasEn:
          "Prophethood, which is the state of being chosen by God to receive divine revelation and guide people, a role held by many messengers throughout history including Abraham, Moses, and Muhammad, peace be upon them all",
        aliasAr: null,
      },
    ]);
    const result = validateAliasResponse(raw, BASE_NOTES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MALFORMED_ITEM");
  });

  it("skips (does not error on) an item with no usable alias offered", () => {
    const raw = JSON.stringify([{ itemKind: "CONCEPT", itemName: "النبوة", canonicalLabel: "prophethood", aliasEn: null, aliasAr: null }]);
    const result = validateAliasResponse(raw, BASE_NOTES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.accepted).toHaveLength(0);
  });
});

describe("buildAliasSourceItems / buildAliasPrompt", () => {
  it("shows all concepts and hints, one bounded call per Unit", () => {
    const items = buildAliasSourceItems(BASE_NOTES);
    expect(items).toHaveLength(3);
    const prompt = buildAliasPrompt(BASE_NOTES.unitTitle, BASE_NOTES.subject, BASE_NOTES.gradeLevel, items);
    expect(prompt).toContain("النبوة");
    expect(prompt).toContain("restating the meaning of this exact, already-verified item");
    expect(prompt).toContain("must NOT add any fact");
  });
});

describe("GroundingConceptAliasService", () => {
  function build(content: string) {
    const generate = jest.fn().mockResolvedValue({ content, inputTokens: 20, outputTokens: 5 });
    const upsert = jest.fn().mockResolvedValue({});
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      client: {
        unit: {
          findUnique: jest.fn().mockResolvedValue({ id: "u1", groundingNotesJson: BASE_NOTES, groundingVersion: 1, groundingSourceFingerprint: "fp" }),
        },
        groundingConceptAlias: { upsert, count },
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
    const service = new GroundingConceptAliasService(prisma, providerFactory, usageService);
    return { service, upsert, count, generate, prisma, usageService };
  }

  it("persists accepted aliases with the current generationVersion, keyed by (unitId, itemKind, itemName)", async () => {
    const { service, upsert } = build(
      JSON.stringify([{ itemKind: "CONCEPT", itemName: "النبوة", canonicalLabel: "prophethood", aliasEn: "Prophethood", aliasAr: null }]),
    );
    const result = await service.generateAliasesForUnit("u1");
    expect(result.outcome).toBe("GENERATED");
    const call = upsert.mock.calls[0][0];
    expect(call.where.unitId_itemKind_itemName).toEqual({ unitId: "u1", itemKind: "CONCEPT", itemName: "النبوة" });
    expect(call.create.generationVersion).toBe(ALIAS_GENERATION_VERSION);
  });

  it("REJECTED, no upsert, when the response is invalid", async () => {
    const { service, upsert } = build("garbage, not JSON");
    const result = await service.generateAliasesForUnit("u1");
    expect(result.outcome).toBe("REJECTED");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("retries exactly once at 1200 tokens when a 600-token response is unparseable", async () => {
    const valid = JSON.stringify([{ itemKind: "CONCEPT", itemName: BASE_NOTES.concepts[0].name, canonicalLabel: "prophethood", aliasEn: "Prophethood", aliasAr: null }]);
    const { service, generate } = build("not complete");
    generate.mockReset();
    generate.mockResolvedValueOnce({ content: "```json\\n[", inputTokens: 20, outputTokens: 600 });
    generate.mockResolvedValueOnce({ content: valid, inputTokens: 20, outputTokens: 10 });
    const result = await service.generateAliasesForUnit("u1");
    expect(result.outcome).toBe("GENERATED");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls.map((c: any[]) => c[0].maxOutputTokens)).toEqual([600, 1200]);
  });

  it("does not make a third call when the 1200-token retry is also truncated", async () => {
    const { service, generate } = build("not complete");
    generate.mockReset();
    generate.mockResolvedValueOnce({ content: "```json\\n[", inputTokens: 20, outputTokens: 600 });
    generate.mockResolvedValueOnce({ content: "```json\\n[", inputTokens: 20, outputTokens: 1200 });
    const result = await service.generateAliasesForUnit("u1");
    expect(result.outcome).toBe("REJECTED");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("does not retry malformed non-truncated output", async () => {
    const { service, generate } = build("garbage, not JSON");
    expect((await service.generateAliasesForUnit("u1")).outcome).toBe("REJECTED");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("hasCurrentAliases reflects generationVersion-scoped count", async () => {
    const { service, count } = build("[]");
    count.mockResolvedValue(2);
    expect(await service.hasCurrentAliases("u1")).toBe(true);
    expect(count.mock.calls[0][0].where.generationVersion).toBe(ALIAS_GENERATION_VERSION);
  });
});

describe("GroundingConceptAliasService is structurally unreachable from any student-facing runtime path", () => {
  const backendSrc = join(__dirname, "..", "..");
  const read = (rel: string) => readFileSync(join(backendSrc, rel), "utf8");

  it("is not a provider in AIModule", () => {
    const module = read("ai/ai.module.ts");
    expect(module).not.toContain('from "./context/grounding-concept-alias.service"');
    for (const key of ["providers", "exports"]) {
      const list = module.split(`${key}: [`)[1]?.split("]")[0] ?? "";
      expect(list).not.toContain("GroundingConceptAliasService");
    }
  });

  it("is not imported by any of the four runtime consumers", () => {
    for (const file of [
      "interactive-lesson/interactive-lesson.service.ts",
      "interactive-lesson/lesson-draft-generator/lesson-draft-generator.service.ts",
      "question-bank/question-draft-generator/question-draft-generator.service.ts",
      "tutor/tutor.service.ts",
    ]) {
      expect(read(file)).not.toContain("grounding-concept-alias");
    }
  });
});
