import { selectRelevantGrounding } from "./grounding-selector.util";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

/**
 * A Unit's groundingNotesJson may describe several Topics — these tests
 * lock in the single most important safety property of this module:
 * generating "Parts of a Plant" must never pull in "Plant Life Cycle"
 * content just because they share a Unit, per the spec that drove this
 * feature ("TOPIC determines immediate teaching scope").
 */
describe("selectRelevantGrounding", () => {
  const twoTopicUnit: GroundingNotes = {
    unitTitle: "Plants",
    gradeLevel: "Year 5",
    subject: "Science",
    learningObjectives: ["Identify plant parts.", "Describe the plant life cycle."],
    concepts: [
      { name: "Roots", description: "Roots absorb water and nutrients.", sourcePages: [12], importance: "core" },
      { name: "Stem", description: "The stem supports the plant.", sourcePages: [12], importance: "core" },
      { name: "Seed", description: "A seed grows into a new plant.", sourcePages: [15], importance: "core" },
      { name: "Germination", description: "Germination is when a seed starts to grow.", sourcePages: [16], importance: "core" },
    ],
    facts: [
      { fact: "Most plants have roots, a stem, leaves, and flowers.", sourcePages: [12], importance: "core" },
      { fact: "A plant's life cycle begins with a seed.", sourcePages: [15], importance: "core" },
    ],
    vocabulary: [
      { term: "Root", meaning: "Underground plant part.", sourcePages: [12] },
      { term: "Germination", meaning: "The start of seed growth.", sourcePages: [16] },
    ],
    skills: [],
    topicHints: [
      { topicTitle: "Parts of a Plant", relevantConcepts: ["Roots", "Stem"], sourcePages: [12] },
      { topicTitle: "Plant Life Cycle", relevantConcepts: ["Seed", "Germination"], sourcePages: [15, 16] },
    ],
    scopeNotes: [],
  };

  it("returns null (no generation call, falls back to title-only) when groundingNotesJson is null", () => {
    expect(selectRelevantGrounding(null, "Parts of a Plant")).toBeNull();
    expect(selectRelevantGrounding(undefined, "Parts of a Plant")).toBeNull();
  });

  it("exact topicHints match: returns only that hint's concepts/facts/vocabulary, never the other topic's", () => {
    const slice = selectRelevantGrounding(twoTopicUnit, "Parts of a Plant");
    expect(slice).not.toBeNull();
    expect(slice!.matchedViaHint).toBe(true);
    expect(slice!.concepts.map((c) => c.name)).toEqual(["Roots", "Stem"]);
    expect(slice!.concepts.map((c) => c.name)).not.toContain("Seed");
    expect(slice!.concepts.map((c) => c.name)).not.toContain("Germination");
    expect(slice!.vocabulary.map((v) => v.term)).toEqual(["Root"]);
    expect(slice!.vocabulary.map((v) => v.term)).not.toContain("Germination");
  });

  it("the sibling topic gets its own disjoint slice — Unit isolation between Topics under the same Unit", () => {
    const plantsSlice = selectRelevantGrounding(twoTopicUnit, "Parts of a Plant");
    const cycleSlice = selectRelevantGrounding(twoTopicUnit, "Plant Life Cycle");
    expect(cycleSlice!.concepts.map((c) => c.name)).toEqual(["Seed", "Germination"]);
    const plantsNames = new Set(plantsSlice!.concepts.map((c) => c.name));
    const cycleNames = new Set(cycleSlice!.concepts.map((c) => c.name));
    for (const name of plantsNames) expect(cycleNames.has(name)).toBe(false);
  });

  it("title normalization: matches despite case, punctuation, and whitespace differences", () => {
    const slice = selectRelevantGrounding(twoTopicUnit, "  parts of a plant!! ");
    expect(slice).not.toBeNull();
    expect(slice!.matchedViaHint).toBe(true);
    expect(slice!.concepts.map((c) => c.name)).toEqual(["Roots", "Stem"]);
  });

  it("no exact hint match: falls back to a conservative keyword-overlap subset, not the whole Unit", () => {
    const noHints: GroundingNotes = { ...twoTopicUnit, topicHints: [] };
    const slice = selectRelevantGrounding(noHints, "Roots and Stem");
    expect(slice).not.toBeNull();
    expect(slice!.matchedViaHint).toBe(false);
    const names = slice!.concepts.map((c) => c.name);
    expect(names).toContain("Roots");
    expect(names).toContain("Stem");
    expect(names).not.toContain("Seed");
    expect(names).not.toContain("Germination");
  });

  it("no exact hint match and no keyword overlap at all: returns null rather than guessing an unrelated subset", () => {
    const noHints: GroundingNotes = { ...twoTopicUnit, topicHints: [] };
    const slice = selectRelevantGrounding(noHints, "Volcanoes and Earthquakes");
    expect(slice).toBeNull();
  });
});

/**
 * 2026-09-26 single-Topic Unit fallback (the "Chapter 1" incident): a
 * Unit's SOLE Topic given a generic, non-descriptive name has zero lexical
 * overlap with its own real, correct grounding and was wrongly blocked as
 * if unsupported — even though there is no cross-topic ambiguity to guard
 * against when a Unit has exactly one Topic. This never applies to a
 * multi-Topic Unit, and never permits any fact/example beyond what the
 * real grounding already contains — it only widens WHICH slice of that
 * real grounding a lone Topic receives.
 */
describe("selectRelevantGrounding — single-Topic Unit fallback (2026-09-26)", () => {
  const singleTopicUnit: GroundingNotes = {
    unitTitle: "Story — Anne & Dolphine",
    gradeLevel: "Year 3",
    subject: "English Language",
    learningObjectives: ["Understand character interactions."],
    concepts: [
      { name: "Character Description", description: "Anna is a playful character.", sourcePages: [1], importance: "core" },
      { name: "Dolphins", description: "Dolphins are friendly and help people.", sourcePages: [13], importance: "core" },
    ],
    facts: [{ fact: "Anna befriends a dolphin.", sourcePages: [9], importance: "core" }],
    vocabulary: [{ term: "Dolphin", meaning: "A playful sea mammal.", sourcePages: [8] }],
    skills: [],
    topicHints: [
      { topicTitle: "Character Interactions", relevantConcepts: ["Character Description"], sourcePages: [1] },
      { topicTitle: "Dolphins and Friendship", relevantConcepts: ["Dolphins"], sourcePages: [13] },
    ],
    scopeNotes: [],
  };

  it("one Topic + a descriptive, matching name: the existing narrow hint-matched selector still wins (fallback never triggers)", () => {
    const slice = selectRelevantGrounding(singleTopicUnit, "Character Interactions", 1);
    expect(slice).not.toBeNull();
    expect(slice!.matchedViaHint).toBe(true);
    expect(slice!.concepts.map((c) => c.name)).toEqual(["Character Description"]);
    expect(slice!.concepts.map((c) => c.name)).not.toContain("Dolphins");
  });

  it("one Topic + zero lexical match (e.g. a generic 'Chapter 1' name): falls back to the Unit's FULL grounding rather than blocking", () => {
    const slice = selectRelevantGrounding(singleTopicUnit, "Chapter 1", 1);
    expect(slice).not.toBeNull();
    expect(slice!.matchedViaHint).toBe(false);
    expect(slice!.concepts.map((c) => c.name)).toEqual(["Character Description", "Dolphins"]);
    expect(slice!.facts).toEqual(singleTopicUnit.facts);
    expect(slice!.vocabulary).toEqual(singleTopicUnit.vocabulary);
    expect(slice!.learningObjectives).toEqual(singleTopicUnit.learningObjectives);
  });

  it("multiple Topics (2+) + zero lexical match: still returns null — the fallback must never apply when cross-topic ambiguity is possible", () => {
    const sliceWithCount2 = selectRelevantGrounding(singleTopicUnit, "Chapter 1", 2);
    expect(sliceWithCount2).toBeNull();
  });

  it("unitTopicCount omitted entirely (existing callers untouched by this change): behaves exactly as before — null, never the fallback", () => {
    const sliceNoCount = selectRelevantGrounding(singleTopicUnit, "Chapter 1");
    expect(sliceNoCount).toBeNull();
  });

  it("missing grounding entirely: still blocks regardless of Topic count", () => {
    expect(selectRelevantGrounding(null, "Chapter 1", 1)).toBeNull();
  });

  it("the fallback never invents content outside the real grounding — every fact/concept in the fallback slice is verbatim from groundingNotesJson", () => {
    const slice = selectRelevantGrounding(singleTopicUnit, "Chapter 1", 1);
    for (const concept of slice!.concepts) expect(singleTopicUnit.concepts).toContainEqual(concept);
    for (const fact of slice!.facts) expect(singleTopicUnit.facts).toContainEqual(fact);
  });
});

describe("selectRelevantGrounding — purity (no provider/DB calls)", () => {
  it("is a synchronous, pure function — calling it can never itself introduce a provider call", () => {
    const result = selectRelevantGrounding(null, "anything", 1);
    expect(result instanceof Promise).toBe(false);
  });
});
