import { identifySingleCandidate, identifySingleCandidateWithAliases, type ConceptAliasBridge } from "./topic-grounding-validator-candidate.util";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

function notes(partial: Partial<GroundingNotes>): GroundingNotes {
  return {
    unitTitle: "Unit",
    gradeLevel: "Grade 4",
    subject: "Math",
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

describe("identifySingleCandidate", () => {
  it("finds the single, clear-winner unclaimed concept when its name is a near-restatement of the Topic title", () => {
    const groundingNotes = notes({
      concepts: [
        { name: "التقريب", description: "Rounding numbers.", sourcePages: [10], importance: "core" },
        { name: "الأعداد الزوجية", description: "Even numbers.", sourcePages: [20], importance: "core" },
      ],
    });
    const topic = { id: "t1", nameEn: "التقريب", order: 1 };
    const siblings = [topic, { id: "t2", nameEn: "الأعداد الزوجية والفردية", order: 2 }];
    const result = identifySingleCandidate(groundingNotes, topic, siblings);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("CONCEPT");
    expect(result!.name).toBe("التقريب");
  });

  it("returns null for the '4 tied ambiguous concepts' shape — several unclaimed concepts each with similar weak overlap", () => {
    const groundingNotes = notes({
      concepts: [
        { name: "The World and Beauty", description: "d", sourcePages: [1], importance: "core" },
        { name: "The World and Nature", description: "d", sourcePages: [2], importance: "core" },
        { name: "The World and Colors", description: "d", sourcePages: [3], importance: "core" },
        { name: "The World and Art", description: "d", sourcePages: [4], importance: "core" },
      ],
    });
    const topic = { id: "t1", nameEn: "How Does the World Become More Beautiful?", order: 1 };
    const siblings = [topic];
    expect(identifySingleCandidate(groundingNotes, topic, siblings)).toBeNull();
  });

  it("returns null when the Topic title has zero lexical overlap with anything unclaimed", () => {
    const groundingNotes = notes({
      concepts: [{ name: "Volcano Formation", description: "d", sourcePages: [1], importance: "core" }],
    });
    const topic = { id: "t1", nameEn: "A Trip to the Farm", order: 1 };
    expect(identifySingleCandidate(groundingNotes, topic, [topic])).toBeNull();
  });

  it("excludes a candidate already claimed by a sibling Topic (reuses Step 5's claim logic)", () => {
    const groundingNotes = notes({
      concepts: [{ name: "Rounding Numbers", description: "d", sourcePages: [1], importance: "core" }],
    });
    // The sibling's title itself keyword-matches "Rounding Numbers" via Step 2
    // (KEYWORD_OVERLAP), so it claims the concept — leaving nothing unclaimed
    // for our Topic to match against.
    const sibling = { id: "t2", nameEn: "Rounding Numbers", order: 2 };
    const topic = { id: "t1", nameEn: "Rounding Whole Numbers Practice", order: 1 };
    const result = identifySingleCandidate(groundingNotes, topic, [topic, sibling]);
    expect(result).toBeNull();
  });

  it("returns null when there are zero unclaimed concepts/hints at all", () => {
    const groundingNotes = notes({ concepts: [] });
    const topic = { id: "t1", nameEn: "Anything", order: 1 };
    expect(identifySingleCandidate(groundingNotes, topic, [topic])).toBeNull();
  });

  it("returns null when notes are missing", () => {
    const topic = { id: "t1", nameEn: "Anything", order: 1 };
    expect(identifySingleCandidate(null, topic, [topic])).toBeNull();
    expect(identifySingleCandidate(undefined, topic, [topic])).toBeNull();
  });
});

describe("identifySingleCandidateWithAliases (bilingual alias bridge)", () => {
  it("matches an English Topic title against an Arabic concept via its persisted English alias, and resolves back to the ORIGINAL concept's real sourcePages/content", () => {
    const groundingNotes = notes({
      concepts: [
        { name: "النبوة", description: "Prophethood.", sourcePages: [42], importance: "core" },
        { name: "الرسالة", description: "Messengership.", sourcePages: [43], importance: "core" },
      ],
    });
    const topic = { id: "t1", nameEn: "Between Prophethood and Messengership", order: 1 };
    const siblings = [topic];
    const aliases: ConceptAliasBridge[] = [
      { itemKind: "CONCEPT", itemName: "النبوة", canonicalLabel: "prophethood", aliasEn: "Prophethood", aliasAr: null },
      { itemKind: "CONCEPT", itemName: "الرسالة", canonicalLabel: "messengership", aliasEn: "Messengership", aliasAr: null },
    ];

    // Without aliases, there is zero lexical overlap (different scripts) — never guesses.
    expect(identifySingleCandidate(groundingNotes, topic, siblings)).toBeNull();

    // With aliases, "Prophethood"+"Messengership" tokens overlap strongly with
    // BOTH candidates' English aliases, roughly evenly, so — correctly — this
    // combined-title case still requires a clear winner per-candidate; test a
    // title that isolates one candidate instead.
    const soleTopic = { id: "t2", nameEn: "Prophethood", order: 1 };
    const result = identifySingleCandidateWithAliases(groundingNotes, soleTopic, [soleTopic], aliases);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("CONCEPT");
    // The candidate returned is the ORIGINAL Arabic concept object — never the alias string.
    expect(result!.name).toBe("النبوة");
    expect(result!.concept?.sourcePages).toEqual([42]);
    expect(result!.concept?.description).toBe("Prophethood.");
  });

  it("a stale alias row referencing a since-removed concept is inert (no crash, no false match)", () => {
    const groundingNotes = notes({
      concepts: [{ name: "Volcano Formation", description: "d", sourcePages: [1], importance: "core" }],
    });
    const topic = { id: "t1", nameEn: "Some Unrelated Title", order: 1 };
    const staleAliases: ConceptAliasBridge[] = [
      { itemKind: "CONCEPT", itemName: "A Concept That No Longer Exists", canonicalLabel: "x", aliasEn: "Some Unrelated Title", aliasAr: null },
    ];
    expect(identifySingleCandidateWithAliases(groundingNotes, topic, [topic], staleAliases)).toBeNull();
  });
});
