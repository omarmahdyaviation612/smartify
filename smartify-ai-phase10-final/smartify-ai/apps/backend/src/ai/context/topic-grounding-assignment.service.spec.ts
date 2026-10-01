import { computeDeterministicAssignment, TopicGroundingAssignmentService } from "./topic-grounding-assignment.service";
import {
  TOPIC_GROUNDING_ASSIGNMENT_VERSION,
  DETERMINISTIC_ASSIGNMENT_VERSION,
  MAPPER_PROMPT_VERSION,
  assignmentIdentityMatches,
  resolveAssignedGroundingSlice,
  sliceFromAssignment,
  type PersistedTopicGroundingAssignment,
} from "./topic-grounding-assignment.util";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

function notes(partial: Partial<GroundingNotes>): GroundingNotes {
  return {
    unitTitle: "Unit 3",
    gradeLevel: "Grade 2",
    subject: "Mathematics",
    learningObjectives: ["Objective A"],
    concepts: [],
    facts: [],
    vocabulary: [],
    skills: [],
    topicHints: [],
    scopeNotes: [],
    ...partial,
  };
}

// --- Regression fixtures for Steps 1-3 (the existing, unchanged selector) ---

const hintUnit = notes({
  concepts: [
    { name: "Roots", description: "d", sourcePages: [4], importance: "core" },
    { name: "Life Cycle Stages", description: "d", sourcePages: [9], importance: "core" },
  ],
  facts: [{ fact: "Roots absorb water.", sourcePages: [4], importance: "core" }],
  vocabulary: [{ term: "Root", meaning: "m", sourcePages: [4] }],
  topicHints: [
    { topicTitle: "Parts of a Plant", relevantConcepts: ["Roots"], sourcePages: [4] },
    { topicTitle: "Plant Life Cycle", relevantConcepts: ["Life Cycle Stages"], sourcePages: [9] },
  ],
});

const keywordUnit = notes({
  concepts: [
    { name: "Roots and Stem", description: "d", sourcePages: [4], importance: "core" },
    { name: "Volcano Formation", description: "d", sourcePages: [20], importance: "core" },
  ],
});

// --- Page/order fixtures for Step 5 ---

const pageOrderConcepts = [
  { name: "Addition Facts", description: "d", sourcePages: [10, 11], importance: "core" as const },
  { name: "Money at the Shop", description: "d", sourcePages: [13], importance: "core" as const },
  { name: "Taking Away", description: "d", sourcePages: [16, 17], importance: "core" as const },
];

const isolatedGapUnit = notes({ concepts: pageOrderConcepts });
const isolatedGapTopics = [
  { id: "t1", nameEn: "Addition Facts", order: 1 },
  { id: "t2", nameEn: "A Trip Downtown", order: 2 },
  { id: "t3", nameEn: "Taking Away", order: 3 },
];

const sharedGapTopics = [
  { id: "t1", nameEn: "Addition Facts", order: 1 },
  { id: "t2", nameEn: "A Trip Downtown", order: 2 },
  { id: "t3", nameEn: "A Quiet Afternoon", order: 3 },
  { id: "t4", nameEn: "Taking Away", order: 4 },
];

describe("computeDeterministicAssignment — Steps 1-3 (regression: existing selector, recorded not rewritten)", () => {
  it("records an exact topicHints match as HINT_MATCH, with the verbatim hint title", () => {
    const result = computeDeterministicAssignment(hintUnit, { id: "t1", nameEn: "Parts of a Plant", order: 1 }, [
      { id: "t1", nameEn: "Parts of a Plant", order: 1 },
      { id: "t2", nameEn: "Plant Life Cycle", order: 2 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.method).toBe("HINT_MATCH");
    expect(result!.confidence).toBe("HIGH");
    expect(result!.matchedConceptNames).toEqual(["Roots"]);
    expect(result!.matchedHintTitles).toEqual(["Parts of a Plant"]);
  });

  it("records a keyword-overlap match as KEYWORD_OVERLAP and never drags in an unrelated sibling concept", () => {
    const result = computeDeterministicAssignment(keywordUnit, { id: "t1", nameEn: "Roots and Stem", order: 1 }, [
      { id: "t1", nameEn: "Roots and Stem", order: 1 },
      { id: "t2", nameEn: "Volcanoes", order: 2 },
    ]);
    expect(result!.method).toBe("KEYWORD_OVERLAP");
    expect(result!.matchedConceptNames).toEqual(["Roots and Stem"]);
    expect(result!.matchedHintTitles).toBeNull();
  });

  it("records the single-Topic-Unit fallback as SINGLE_TOPIC_FALLBACK (the \"Chapter 1\" incident)", () => {
    const soleTopic = [{ id: "t1", nameEn: "Chapter 1", order: 1 }];
    const result = computeDeterministicAssignment(keywordUnit, soleTopic[0], soleTopic);
    expect(result!.method).toBe("SINGLE_TOPIC_FALLBACK");
    expect(result!.matchedConceptNames).toEqual(["Roots and Stem", "Volcano Formation"]);
  });

  it("returns null (unresolved) for a creatively-titled Topic in a multi-Topic Unit", () => {
    const result = computeDeterministicAssignment(keywordUnit, { id: "t3", nameEn: "The Lost Kite (Reading)", order: 3 }, [
      { id: "t1", nameEn: "Roots and Stem", order: 1 },
      { id: "t2", nameEn: "Volcanoes", order: 2 },
      { id: "t3", nameEn: "The Lost Kite (Reading)", order: 3 },
    ]);
    expect(result).toBeNull();
  });
});

describe("computeDeterministicAssignment — Step 4 (REVIEW_FULL_UNIT)", () => {
  const reviewTopics = [
    { id: "t1", nameEn: "Addition Facts", order: 1 },
    { id: "t2", nameEn: "Taking Away", order: 2 },
    { id: "t3", nameEn: "Unit 3 Review", order: 3 },
  ];

  it("assigns the FULL Unit grounding to a Review Topic at HIGH confidence", () => {
    const result = computeDeterministicAssignment(isolatedGapUnit, reviewTopics[2], reviewTopics);
    expect(result!.method).toBe("REVIEW_FULL_UNIT");
    expect(result!.confidence).toBe("HIGH");
    expect(result!.matchedConceptNames).toEqual(pageOrderConcepts.map((c) => c.name));
  });

  it("matches revision/recap/summary too, and is only reached when Steps 1-3 found nothing", () => {
    for (const title of ["Revision", "Recap of the term", "Summary"]) {
      const topics = [...reviewTopics.slice(0, 2), { id: "tX", nameEn: title, order: 3 }];
      expect(computeDeterministicAssignment(isolatedGapUnit, topics[2], topics)!.method).toBe("REVIEW_FULL_UNIT");
    }
    // "Addition Facts" resolves at Step 2 and must NOT become REVIEW_FULL_UNIT
    // even though the Unit also contains a Review Topic.
    expect(computeDeterministicAssignment(isolatedGapUnit, reviewTopics[0], reviewTopics)!.method).toBe("KEYWORD_OVERLAP");
  });

  it("is tested against nameEn (English curriculum metadata), never the Arabic title or textbook content", () => {
    const topics = [...reviewTopics.slice(0, 2), { id: "tX", nameEn: "A Quiet Afternoon", order: 3 }];
    expect(computeDeterministicAssignment(isolatedGapUnit, topics[2], topics)?.method).not.toBe("REVIEW_FULL_UNIT");
  });

  it("also matches assessment-shell Topic titles (v2 extension) as REVIEW_FULL_UNIT, with ALL of the Unit's concepts", () => {
    for (const title of [
      "Unit One Assessment",
      "Final Assessment of the First Term",
      "First Term Assessments",
      "Unit Two Assessment",
      "Final Assessment of the Second Term",
    ]) {
      const topics = [...reviewTopics.slice(0, 2), { id: "tX", nameEn: title, order: 3 }];
      const result = computeDeterministicAssignment(isolatedGapUnit, topics[2], topics);
      expect(result!.method).toBe("REVIEW_FULL_UNIT");
      expect(result!.confidence).toBe("HIGH");
      expect(result!.matchedConceptNames).toEqual(pageOrderConcepts.map((c) => c.name));
    }
  });

  it("does NOT match a title that merely mentions assessment in passing, without a structural Unit/Term/Final marker", () => {
    for (const title of ["How Teachers Assess Progress", "Self-Assessment Journal"]) {
      const topics = [...reviewTopics.slice(0, 2), { id: "tX", nameEn: title, order: 3 }];
      expect(computeDeterministicAssignment(isolatedGapUnit, topics[2], topics)?.method).not.toBe("REVIEW_FULL_UNIT");
    }
  });

  it("Steps 1-3 still take precedence over the assessment-shell pattern when they'd otherwise resolve first", () => {
    // "Addition Facts" resolves at Step 2 (KEYWORD_OVERLAP) even though its
    // title contains none of the assessment markers — this proves the tier
    // ordering, mirroring the existing review-pattern precedence test above.
    expect(computeDeterministicAssignment(isolatedGapUnit, reviewTopics[0], reviewTopics)!.method).toBe("KEYWORD_OVERLAP");
  });

  it("TOPIC_GROUNDING_ASSIGNMENT_VERSION is bumped to at least 2 for the assessment-shell semantics change", () => {
    expect(TOPIC_GROUNDING_ASSIGNMENT_VERSION).toBeGreaterThanOrEqual(2);
  });
});

describe("computeDeterministicAssignment — Step 5 (PAGE_ORDER_GAP)", () => {
  it("assigns the unclaimed in-gap concept when the gap is uniquely isolated", () => {
    const result = computeDeterministicAssignment(isolatedGapUnit, isolatedGapTopics[1], isolatedGapTopics);
    expect(result!.method).toBe("PAGE_ORDER_GAP");
    expect(result!.confidence).toBe("HIGH");
    expect(result!.matchedConceptNames).toEqual(["Money at the Shop"]);
  });

  it("never claims a concept already claimed by a Step 1-4 sibling assignment", () => {
    const result = computeDeterministicAssignment(isolatedGapUnit, isolatedGapTopics[1], isolatedGapTopics);
    expect(result!.matchedConceptNames).not.toContain("Addition Facts");
    expect(result!.matchedConceptNames).not.toContain("Taking Away");
  });

  it("leaves an AMBIGUOUS shared gap unresolved (mapper-eligible) rather than guessing", () => {
    const t2 = computeDeterministicAssignment(isolatedGapUnit, sharedGapTopics[1], sharedGapTopics);
    const t3 = computeDeterministicAssignment(isolatedGapUnit, sharedGapTopics[2], sharedGapTopics);
    expect(t2).toBeNull();
    expect(t3).toBeNull();
  });

  it("declines an unbounded gap (no assigned neighbour on one side)", () => {
    const topics = [
      { id: "t0", nameEn: "A Rainy Morning", order: 0 },
      ...isolatedGapTopics,
    ];
    expect(computeDeterministicAssignment(isolatedGapUnit, topics[0], topics)).toBeNull();
  });

  it("declines when the gap contains no unclaimed concept at all", () => {
    const emptyGapUnit = notes({
      concepts: [
        { name: "Addition Facts", description: "d", sourcePages: [10, 11], importance: "core" },
        { name: "Taking Away", description: "d", sourcePages: [16, 17], importance: "core" },
      ],
    });
    expect(computeDeterministicAssignment(emptyGapUnit, isolatedGapTopics[1], isolatedGapTopics)).toBeNull();
  });

  it("returns null when the Unit has no grounding notes at all", () => {
    expect(computeDeterministicAssignment(null, isolatedGapTopics[1], isolatedGapTopics)).toBeNull();
    expect(computeDeterministicAssignment(undefined, isolatedGapTopics[1], isolatedGapTopics)).toBeNull();
  });
});

describe("assignment identity", () => {
  const row: PersistedTopicGroundingAssignment = {
    unitGroundingVersion: 2,
    unitSourceFingerprint: "fp-abc",
    assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION,
    method: "HINT_MATCH",
    mapperPromptVersion: null,
    status: "READY",
    matchedConceptNames: ["Roots"],
    matchedHintTitles: null,
  };

  it("matches when factual identity and the deterministic axis agree", () => {
    expect(assignmentIdentityMatches(row, { groundingVersion: 2, groundingSourceFingerprint: "fp-abc" })).toBe(true);
  });

  it("invalidates when the Unit's groundingVersion changes", () => {
    expect(assignmentIdentityMatches(row, { groundingVersion: 3, groundingSourceFingerprint: "fp-abc" })).toBe(false);
  });

  it("invalidates when the Unit's sourceFingerprint changes", () => {
    expect(assignmentIdentityMatches(row, { groundingVersion: 2, groundingSourceFingerprint: "fp-different" })).toBe(false);
  });

  it("invalidates a deterministic-method row when DETERMINISTIC_ASSIGNMENT_VERSION changes (assignment-logic-only bump)", () => {
    expect(assignmentIdentityMatches({ ...row, assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION + 1 }, { groundingVersion: 2, groundingSourceFingerprint: "fp-abc" })).toBe(false);
  });

  it("never matches a Unit that was never successfully grounded", () => {
    expect(assignmentIdentityMatches(row, { groundingVersion: null, groundingSourceFingerprint: null })).toBe(false);
  });

  // --- The bug fix under test: split algorithm axes per method ---

  const mapperRow: PersistedTopicGroundingAssignment = {
    unitGroundingVersion: 2,
    unitSourceFingerprint: "fp-abc",
    assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION,
    method: "AI_MAPPER",
    mapperPromptVersion: MAPPER_PROMPT_VERSION,
    status: "READY",
    matchedConceptNames: ["Roots"],
    matchedHintTitles: null,
  };

  it("an AI_MAPPER row stays valid when DETERMINISTIC_ASSIGNMENT_VERSION changes but mapperPromptVersion and factual identity are unchanged (the production bug this fixes)", () => {
    const bumped = { ...mapperRow, assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION + 1 };
    expect(assignmentIdentityMatches(bumped, { groundingVersion: 2, groundingSourceFingerprint: "fp-abc" })).toBe(true);
  });

  it("an AI_MAPPER row is invalidated when mapperPromptVersion changes, even if the deterministic axis is untouched", () => {
    const stale = { ...mapperRow, mapperPromptVersion: MAPPER_PROMPT_VERSION - 1 };
    expect(assignmentIdentityMatches(stale, { groundingVersion: 2, groundingSourceFingerprint: "fp-abc" })).toBe(false);
  });

  it("a deterministic-method row is NOT affected by mapperPromptVersion at all (it is never even consulted)", () => {
    const detWithStaleMapperField = { ...row, mapperPromptVersion: -999 };
    expect(assignmentIdentityMatches(detWithStaleMapperField, { groundingVersion: 2, groundingSourceFingerprint: "fp-abc" })).toBe(true);
  });

  it("a Unit factual-identity change unconditionally invalidates BOTH a deterministic row and an AI_MAPPER row", () => {
    expect(assignmentIdentityMatches(row, { groundingVersion: 99, groundingSourceFingerprint: "fp-abc" })).toBe(false);
    expect(assignmentIdentityMatches(mapperRow, { groundingVersion: 99, groundingSourceFingerprint: "fp-abc" })).toBe(false);
    expect(assignmentIdentityMatches(row, { groundingVersion: 2, groundingSourceFingerprint: "fp-changed" })).toBe(false);
    expect(assignmentIdentityMatches(mapperRow, { groundingVersion: 2, groundingSourceFingerprint: "fp-changed" })).toBe(false);
  });
});

describe("sliceFromAssignment / resolveAssignedGroundingSlice", () => {
  const row: PersistedTopicGroundingAssignment = {
    unitGroundingVersion: 1,
    unitSourceFingerprint: "fp",
    assignmentVersion: TOPIC_GROUNDING_ASSIGNMENT_VERSION,
    method: "HINT_MATCH",
    mapperPromptVersion: null,
    status: "READY",
    matchedConceptNames: ["Roots"],
    matchedHintTitles: ["Parts of a Plant"],
  };
  const unit = { groundingVersion: 1, groundingSourceFingerprint: "fp", groundingNotesJson: hintUnit };

  it("re-filters the Unit's LIVE grounding by the persisted names (never cached objects)", () => {
    const edited = notes({
      ...hintUnit,
      concepts: [{ name: "Roots", description: "AN UPDATED DESCRIPTION", sourcePages: [4], importance: "core" }],
    });
    const outcome = resolveAssignedGroundingSlice(row, { ...unit, groundingNotesJson: edited });
    expect(outcome.state).toBe("READY");
    expect((outcome as any).slice.concepts[0].description).toBe("AN UPDATED DESCRIPTION");
  });

  it("scopes to the assigned Topic only — a sibling Topic's concept never leaks in", () => {
    const slice = sliceFromAssignment(hintUnit, row)!;
    expect(slice.concepts.map((c) => c.name)).toEqual(["Roots"]);
    expect(slice.facts.map((f) => f.fact)).toEqual(["Roots absorb water."]);
    expect(slice.matchedViaHint).toBe(true);
  });

  it("reports MISSING for no row, STALE for a mismatched identity and BLOCKED for a blocked row", () => {
    expect(resolveAssignedGroundingSlice(null, unit).state).toBe("MISSING");
    expect(resolveAssignedGroundingSlice(row, { ...unit, groundingVersion: 99 }).state).toBe("STALE");
    expect(resolveAssignedGroundingSlice({ ...row, status: "BLOCKED" }, unit).state).toBe("BLOCKED");
  });

  it("reports EMPTY when a valid row selects nothing from the current grounding", () => {
    const outcome = resolveAssignedGroundingSlice({ ...row, matchedConceptNames: ["Gone"], matchedHintTitles: [] }, unit);
    expect(outcome.state).toBe("EMPTY");
  });

  // --- Field-scope fix (2026-09-27): a persisted name may be a verbatim
  // notes.vocabulary[].term rather than a notes.concepts[].name (see
  // validateMapperResponse's `allowedVocabulary`). Mirrors the real
  // production cases (Topics "Honoring the Guest", "A Collage") as clean
  // fixture data, not the literal production topicIds/strings.
  const vocabRow: PersistedTopicGroundingAssignment = {
    unitGroundingVersion: 1,
    unitSourceFingerprint: "fp",
    assignmentVersion: TOPIC_GROUNDING_ASSIGNMENT_VERSION,
    method: "AI_MAPPER",
    mapperPromptVersion: MAPPER_PROMPT_VERSION,
    status: "READY",
    matchedConceptNames: ["Root"], // verbatim in hintUnit.vocabulary, NOT in hintUnit.concepts
    matchedHintTitles: [],
  };

  it("resolves a vocabulary-sourced persisted name back to real content with real sourcePages (never an empty/broken slice)", () => {
    const slice = sliceFromAssignment(hintUnit, vocabRow)!;
    expect(slice.concepts).toEqual([]);
    expect(slice.vocabulary.map((v) => v.term)).toEqual(["Root"]);
    expect(slice.vocabulary[0].sourcePages).toEqual([4]);
    const outcome = resolveAssignedGroundingSlice(vocabRow, { ...unit, groundingNotesJson: hintUnit });
    expect(outcome.state).toBe("READY");
    expect((outcome.state === "READY" && outcome.slice.vocabulary.map((v) => v.term)) || []).toEqual(["Root"]);
  });

  it("a vocabulary-sourced match does not fabricate unrelated concepts/facts outside its own sourcePages", () => {
    const slice = sliceFromAssignment(hintUnit, vocabRow)!;
    // "Root"'s sourcePages is [4]; "Roots absorb water." also lives on page 4,
    // so it legitimately comes along — but the page-9 "Life Cycle Stages"
    // concept must never leak in.
    expect(slice.facts.map((f) => f.fact)).toEqual(["Roots absorb water."]);
    expect(slice.concepts.some((c) => c.name === "Life Cycle Stages")).toBe(false);
  });

  it("a near-miss name absent from concepts, hints AND vocabulary still resolves to nothing (no fuzzy matching)", () => {
    const slice = sliceFromAssignment(hintUnit, { ...row, matchedConceptNames: ["Rootz"], matchedHintTitles: [] })!;
    expect(slice.concepts).toEqual([]);
    expect(slice.vocabulary).toEqual([]);
  });

  it("a vocabulary term persisted on two different Topics' rows resolves independently for each (sliceFromAssignment is per-row/stateless — sibling-claim exclusivity is a Step 5 write-time concern, not a read-time one)", () => {
    const siblingVocabRow: PersistedTopicGroundingAssignment = { ...vocabRow, matchedConceptNames: ["Root"] };
    const sliceA = sliceFromAssignment(hintUnit, vocabRow)!;
    const sliceB = sliceFromAssignment(hintUnit, siblingVocabRow)!;
    expect(sliceA.vocabulary.map((v) => v.term)).toEqual(["Root"]);
    expect(sliceB.vocabulary.map((v) => v.term)).toEqual(["Root"]);
  });

  it("TOPIC_GROUNDING_ASSIGNMENT_VERSION is bumped to 3 for the vocabulary field-scope fix", () => {
    expect(TOPIC_GROUNDING_ASSIGNMENT_VERSION).toBe(3);
  });
  it("resolves READY TopicSourceEvidence-only and mixed slices with physical pages", () => {
    const sourceOnlyRow = { ...row, matchedConceptNames: ["Extracted Evidence"], matchedHintTitles: [] };
    const evidence = [{ status: "READY", unitId: "u1", sourceFingerprint: "fp", evidenceJson: [{ type: "concept", label: "Extracted Evidence", sourcePages: [88] }] }];
    const emptyNotes = notes({ ...hintUnit, concepts: [], facts: [], vocabulary: [], topicHints: [] });
    const sourceOnly = resolveAssignedGroundingSlice(sourceOnlyRow, { id: "u1", ...unit, groundingNotesJson: emptyNotes }, evidence);
    expect(sourceOnly.state).toBe("READY");
    expect(sourceOnly.state === "READY" && sourceOnly.slice.concepts[0].sourcePages).toEqual([88]);
    const mixed = resolveAssignedGroundingSlice({ ...row, matchedConceptNames: ["Roots", "Extracted Evidence"] }, { id: "u1", ...unit }, evidence);
    expect(mixed.state === "READY" && mixed.slice.concepts.map(c => c.name)).toEqual(["Roots", "Extracted Evidence"]);
  });

  it.each(["NOT_FOUND", "FAILED", "PREPARING", "STALE"])("does not let %s TopicSourceEvidence satisfy a slice", (status) => {
    const selected = { ...row, matchedConceptNames: ["Extracted Evidence"], matchedHintTitles: [] };
    const evidence = [{ status, unitId: "u1", sourceFingerprint: "fp", evidenceJson: [{ type: "concept", label: "Extracted Evidence", sourcePages: [88] }] }];
    expect(resolveAssignedGroundingSlice(selected, { id: "u1", ...unit, groundingNotesJson: notes({ ...hintUnit, concepts: [], facts: [], vocabulary: [], topicHints: [] }) }, evidence).state).toBe("EMPTY");
  });

  it("excludes stale-fingerprint and cross-Unit evidence", () => {
    const selected = { ...row, matchedConceptNames: ["Extracted Evidence"], matchedHintTitles: [] };
    const base = { status: "READY", unitId: "u1", sourceFingerprint: "fp", evidenceJson: [{ type: "concept", label: "Extracted Evidence", sourcePages: [88] }] };
    const emptyUnit = { id: "u1", ...unit, groundingNotesJson: notes({ ...hintUnit, concepts: [], facts: [], vocabulary: [], topicHints: [] }) };
    expect(resolveAssignedGroundingSlice(selected, emptyUnit, [{ ...base, sourceFingerprint: "old" }]).state).toBe("EMPTY");
    expect(resolveAssignedGroundingSlice(selected, emptyUnit, [{ ...base, unitId: "other" }]).state).toBe("EMPTY");
  });
});
describe("TopicGroundingAssignmentService.assignGroundingForTopic", () => {
  function buildService(topicRow: any) {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      client: {
        topic: { findUnique: jest.fn().mockResolvedValue(topicRow) },
        topicGroundingAssignment: { findMany: jest.fn().mockResolvedValue([]), upsert },
      },
    } as any;
    return { service: new TopicGroundingAssignmentService(prisma), upsert, prisma };
  }

  const groundedUnit = {
    id: "u1",
    groundingNotesJson: hintUnit,
    groundingVersion: 1,
    groundingSourceFingerprint: "fp",
    topics: [
      { id: "t1", nameEn: "Parts of a Plant", order: 1 },
      { id: "t2", nameEn: "Plant Life Cycle", order: 2 },
    ],
  };

  it("persists a deterministic assignment for a resolvable Topic", async () => {
    const { service, upsert } = buildService({ id: "t1", nameEn: "Parts of a Plant", order: 1, groundingAssignment: null, unit: groundedUnit });
    const outcome = await service.assignGroundingForTopic("t1");
    expect(outcome).toEqual({ outcome: "ASSIGNED", method: "HINT_MATCH", status: "READY" });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create.matchedConceptNames).toEqual(["Roots"]);
    expect(upsert.mock.calls[0][0].create.assignmentVersion).toBe(TOPIC_GROUNDING_ASSIGNMENT_VERSION);
  });

  it("is an idempotent NO-OP when an existing row's identity already matches (no recomputation, no write)", async () => {
    const existing = {
      method: "HINT_MATCH",
      status: "READY",
      unitGroundingVersion: 1,
      unitSourceFingerprint: "fp",
      assignmentVersion: TOPIC_GROUNDING_ASSIGNMENT_VERSION,
    };
    const { service, upsert, prisma } = buildService({ id: "t1", nameEn: "Parts of a Plant", order: 1, groundingAssignment: existing, unit: groundedUnit });
    const outcome = await service.assignGroundingForTopic("t1");
    expect(outcome).toEqual({ outcome: "UNCHANGED", method: "HINT_MATCH", status: "READY" });
    expect(upsert).not.toHaveBeenCalled();
    expect(prisma.client.topicGroundingAssignment.findMany).not.toHaveBeenCalled();
  });

  it("recomputes when the stored assignmentVersion is stale", async () => {
    const existing = {
      method: "HINT_MATCH",
      status: "READY",
      unitGroundingVersion: 1,
      unitSourceFingerprint: "fp",
      assignmentVersion: TOPIC_GROUNDING_ASSIGNMENT_VERSION - 1,
    };
    const { service, upsert } = buildService({ id: "t1", nameEn: "Parts of a Plant", order: 1, groundingAssignment: existing, unit: groundedUnit });
    expect(await service.assignGroundingForTopic("t1")).toEqual({ outcome: "ASSIGNED", method: "HINT_MATCH", status: "READY" });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("writes NO row for an unresolved Topic and reports UNRESOLVED (mapper-eligible)", async () => {
    const unit = { ...groundedUnit, groundingNotesJson: keywordUnit, topics: [...groundedUnit.topics, { id: "t3", nameEn: "The Lost Kite (Reading)", order: 3 }] };
    const { service, upsert } = buildService({ id: "t3", nameEn: "The Lost Kite (Reading)", order: 3, groundingAssignment: null, unit });
    const outcome = await service.assignGroundingForTopic("t3");
    expect(outcome.outcome).toBe("UNRESOLVED");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("consumes matching READY TopicSourceEvidence when Unit grounding alone is unresolved, preserving physical pages", async () => {
    const unit = { ...groundedUnit, groundingNotesJson: keywordUnit, topics: [{ id: "t2", nameEn: "Volcanoes", order: 2 }, { id: "t3", nameEn: "The Lost Kite (Reading)", order: 3 }] };
    const evidence = { id: "e1", topicId: "t3", unitId: "u1", sourceFingerprint: "fp", status: "READY", sourcePageStart: 10, sourcePageEnd: 11, evidenceJson: [{ type: "concept", label: "Lost Kite", sourcePages: [10] }] };
    const { service, upsert } = buildService({ id: "t3", nameEn: "The Lost Kite (Reading)", order: 3, groundingAssignment: null, topicSourceEvidence: [evidence], unit });
    expect(await service.assignGroundingForTopic("t3")).toEqual({ outcome: "ASSIGNED", method: "KEYWORD_OVERLAP", status: "READY" });
    expect(upsert.mock.calls[0][0].create.matchedConceptNames).toContain("Lost Kite");
    expect(unit.groundingNotesJson).toBe(keywordUnit);
    expect(evidence.evidenceJson).toEqual([{ type: "concept", label: "Lost Kite", sourcePages: [10] }]);
  });

  it("ignores non-READY, cross-Topic, cross-Unit, and stale-fingerprint evidence", async () => {
    const unit = { ...groundedUnit, groundingNotesJson: keywordUnit, topics: [{ id: "t2", nameEn: "Volcanoes", order: 2 }, { id: "t3", nameEn: "The Lost Kite (Reading)", order: 3 }] };
    const rows = [
      { topicId: "t3", unitId: "u1", sourceFingerprint: "fp", status: "NOT_FOUND", evidenceJson: [{ type: "concept", label: "Lost Kite", sourcePages: [1] }] },
      { topicId: "other", unitId: "u1", sourceFingerprint: "fp", status: "READY", evidenceJson: [{ type: "concept", label: "Lost Kite", sourcePages: [1] }] },
      { topicId: "t3", unitId: "other", sourceFingerprint: "fp", status: "READY", evidenceJson: [{ type: "concept", label: "Lost Kite", sourcePages: [1] }] },
      { topicId: "t3", unitId: "u1", sourceFingerprint: "stale", status: "READY", evidenceJson: [{ type: "concept", label: "Lost Kite", sourcePages: [1] }] },
    ];
    const { service, upsert } = buildService({ id: "t3", nameEn: "The Lost Kite (Reading)", order: 3, groundingAssignment: null, topicSourceEvidence: rows, unit });
    expect((await service.assignGroundingForTopic("t3")).outcome).toBe("UNRESOLVED");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reuses an existing valid assignment even when new READY evidence is present", async () => {
    const existing = { method: "HINT_MATCH", status: "READY", unitGroundingVersion: 1, unitSourceFingerprint: "fp", assignmentVersion: TOPIC_GROUNDING_ASSIGNMENT_VERSION };
    const evidence = { topicId: "t1", unitId: "u1", sourceFingerprint: "fp", status: "READY", evidenceJson: [{ type: "concept", label: "New Evidence", sourcePages: [4] }] };
    const { service, upsert, prisma } = buildService({ id: "t1", nameEn: "Parts of a Plant", order: 1, groundingAssignment: existing, topicSourceEvidence: [evidence], unit: groundedUnit });
    expect(await service.assignGroundingForTopic("t1")).toEqual({ outcome: "UNCHANGED", method: "HINT_MATCH", status: "READY" });
    expect(upsert).not.toHaveBeenCalled();
    expect(prisma.client.topicGroundingAssignment.findMany).not.toHaveBeenCalled();
  });

  it("reports NOT_GROUNDED (and writes nothing) when the Unit has no completed grounding", async () => {
    const unit = { ...groundedUnit, groundingNotesJson: null, groundingVersion: null, groundingSourceFingerprint: null };
    const { service, upsert } = buildService({ id: "t1", nameEn: "Parts of a Plant", order: 1, groundingAssignment: null, unit });
    expect((await service.assignGroundingForTopic("t1")).outcome).toBe("NOT_GROUNDED");
    expect(upsert).not.toHaveBeenCalled();
  });

  // --- Regression coverage for the algorithm-identity split (production bug fix) ---

  // A Topic the deterministic pass genuinely cannot resolve (mirrors "The
  // Lost Kite (Reading)" from the UNRESOLVED test above) with a previously
  // persisted, still-valid AI_MAPPER row.
  const unresolvableUnit = {
    id: "u2",
    groundingNotesJson: keywordUnit,
    groundingVersion: 1,
    groundingSourceFingerprint: "fp",
    topics: [
      { id: "t1", nameEn: "Roots and Stem", order: 1 },
      { id: "t2", nameEn: "Volcanoes", order: 2 },
      { id: "t3", nameEn: "The Lost Kite (Reading)", order: 3 },
    ],
  };

  it("a deterministic-only DETERMINISTIC_ASSIGNMENT_VERSION bump does NOT invalidate/recompute an existing valid AI_MAPPER row (the production bug: unrelated bumps must never force a stochastic re-sample)", async () => {
    const existingMapperRow = {
      method: "AI_MAPPER",
      status: "READY",
      unitGroundingVersion: 1,
      unitSourceFingerprint: "fp",
      assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION - 1, // stale on the deterministic axis only
      mapperPromptVersion: MAPPER_PROMPT_VERSION, // current on the mapper axis
    };
    const { service, upsert } = buildService({
      id: "t3",
      nameEn: "The Lost Kite (Reading)",
      order: 3,
      groundingAssignment: existingMapperRow,
      unit: unresolvableUnit,
    });
    const outcome = await service.assignGroundingForTopic("t3");
    expect(outcome).toEqual({ outcome: "UNCHANGED", method: "AI_MAPPER", status: "READY" });
    // Steps 1-5 are re-run in-memory (free, DB-free) to check for an
    // opportunistic upgrade — they still decline here, so nothing is written
    // and the existing validated AI_MAPPER row is left completely untouched.
    expect(upsert).not.toHaveBeenCalled();
  });

  it("a mapperPromptVersion bump DOES correctly invalidate an existing AI_MAPPER row (this fix must not regress the validation-bug fix that legitimately needed it)", async () => {
    const existingMapperRow = {
      method: "AI_MAPPER",
      status: "READY",
      unitGroundingVersion: 1,
      unitSourceFingerprint: "fp",
      assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION,
      mapperPromptVersion: MAPPER_PROMPT_VERSION - 1, // stale on the mapper axis
    };
    const { service, upsert } = buildService({
      id: "t3",
      nameEn: "The Lost Kite (Reading)",
      order: 3,
      groundingAssignment: existingMapperRow,
      unit: unresolvableUnit,
    });
    const outcome = await service.assignGroundingForTopic("t3");
    // Deterministic Steps 1-5 still can't resolve it, so it correctly falls
    // through to UNRESOLVED — eligible for the (corrected) mapper to re-run.
    expect(outcome.outcome).toBe("UNRESOLVED");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("a Unit factual-identity change (re-grounding) invalidates an AI_MAPPER row unconditionally, regardless of mapperPromptVersion", async () => {
    const existingMapperRow = {
      method: "AI_MAPPER",
      status: "READY",
      unitGroundingVersion: 1,
      unitSourceFingerprint: "fp",
      assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION,
      mapperPromptVersion: MAPPER_PROMPT_VERSION,
    };
    const regroundedUnit = { ...unresolvableUnit, groundingVersion: 2, groundingSourceFingerprint: "fp-new" };
    const { service, upsert } = buildService({
      id: "t3",
      nameEn: "The Lost Kite (Reading)",
      order: 3,
      groundingAssignment: existingMapperRow,
      unit: regroundedUnit,
    });
    const outcome = await service.assignGroundingForTopic("t3");
    expect(outcome.outcome).toBe("UNRESOLVED");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("a Unit factual-identity change also still invalidates a deterministic-method row (existing behavior, must not regress)", async () => {
    const existingDetRow = {
      method: "HINT_MATCH",
      status: "READY",
      unitGroundingVersion: 1,
      unitSourceFingerprint: "fp",
      assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION,
      mapperPromptVersion: null,
    };
    const regroundedUnit = { ...groundedUnit, groundingVersion: 2, groundingSourceFingerprint: "fp-new" };
    const { service, upsert } = buildService({ id: "t1", nameEn: "Parts of a Plant", order: 1, groundingAssignment: existingDetRow, unit: regroundedUnit });
    const outcome = await service.assignGroundingForTopic("t1");
    expect(outcome).toEqual({ outcome: "ASSIGNED", method: "HINT_MATCH", status: "READY" });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("a deterministic-only version bump still DOES cause a deterministic-method row to be recomputed (existing behavior, must not regress)", async () => {
    const existingDetRow = {
      method: "HINT_MATCH",
      status: "READY",
      unitGroundingVersion: 1,
      unitSourceFingerprint: "fp",
      assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION - 1,
      mapperPromptVersion: null,
    };
    const { service, upsert } = buildService({ id: "t1", nameEn: "Parts of a Plant", order: 1, groundingAssignment: existingDetRow, unit: groundedUnit });
    const outcome = await service.assignGroundingForTopic("t1");
    expect(outcome).toEqual({ outcome: "ASSIGNED", method: "HINT_MATCH", status: "READY" });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("DECISION: an existing AI_MAPPER row is opportunistically (and for free) upgraded to a deterministic result when an IMPROVED deterministic pass can now resolve the Topic on its own — the mapper is never re-invoked for this, only the pure/DB-free deterministic steps", async () => {
    // A previously mapper-resolved Topic whose title now matches the newer
    // REVIEW_FULL_UNIT structural pattern (Step 4) — simulating "deterministic
    // logic improved after this row was mapper-derived".
    const existingMapperRow = {
      method: "AI_MAPPER",
      status: "READY",
      unitGroundingVersion: 1,
      unitSourceFingerprint: "fp",
      assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION - 1,
      mapperPromptVersion: MAPPER_PROMPT_VERSION,
    };
    const reviewUnit = {
      id: "u3",
      groundingNotesJson: isolatedGapUnit,
      groundingVersion: 1,
      groundingSourceFingerprint: "fp",
      topics: [
        { id: "t1", nameEn: "Addition Facts", order: 1 },
        { id: "t2", nameEn: "Taking Away", order: 2 },
        { id: "t3", nameEn: "Unit 3 Review", order: 3 },
      ],
    };
    const { service, upsert } = buildService({ id: "t3", nameEn: "Unit 3 Review", order: 3, groundingAssignment: existingMapperRow, unit: reviewUnit });
    const outcome = await service.assignGroundingForTopic("t3");
    expect(outcome).toEqual({ outcome: "ASSIGNED", method: "REVIEW_FULL_UNIT", status: "READY" });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create.method).toBe("REVIEW_FULL_UNIT");
  });
});
