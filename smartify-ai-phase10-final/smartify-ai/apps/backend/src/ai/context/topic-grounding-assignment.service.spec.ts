import { computeDeterministicAssignment, TopicGroundingAssignmentService } from "./topic-grounding-assignment.service";
import {
  TOPIC_GROUNDING_ASSIGNMENT_VERSION,
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
    assignmentVersion: TOPIC_GROUNDING_ASSIGNMENT_VERSION,
    status: "READY",
    matchedConceptNames: ["Roots"],
    matchedHintTitles: null,
  };

  it("matches when all three axes agree", () => {
    expect(assignmentIdentityMatches(row, { groundingVersion: 2, groundingSourceFingerprint: "fp-abc" })).toBe(true);
  });

  it("invalidates when the Unit's groundingVersion changes", () => {
    expect(assignmentIdentityMatches(row, { groundingVersion: 3, groundingSourceFingerprint: "fp-abc" })).toBe(false);
  });

  it("invalidates when the Unit's sourceFingerprint changes", () => {
    expect(assignmentIdentityMatches(row, { groundingVersion: 2, groundingSourceFingerprint: "fp-different" })).toBe(false);
  });

  it("invalidates when the assignmentVersion changes (assignment-logic-only bump)", () => {
    expect(assignmentIdentityMatches({ ...row, assignmentVersion: TOPIC_GROUNDING_ASSIGNMENT_VERSION + 1 }, { groundingVersion: 2, groundingSourceFingerprint: "fp-abc" })).toBe(false);
  });

  it("never matches a Unit that was never successfully grounded", () => {
    expect(assignmentIdentityMatches(row, { groundingVersion: null, groundingSourceFingerprint: null })).toBe(false);
  });
});

describe("sliceFromAssignment / resolveAssignedGroundingSlice", () => {
  const row: PersistedTopicGroundingAssignment = {
    unitGroundingVersion: 1,
    unitSourceFingerprint: "fp",
    assignmentVersion: TOPIC_GROUNDING_ASSIGNMENT_VERSION,
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

  it("reports NOT_GROUNDED (and writes nothing) when the Unit has no completed grounding", async () => {
    const unit = { ...groundedUnit, groundingNotesJson: null, groundingVersion: null, groundingSourceFingerprint: null };
    const { service, upsert } = buildService({ id: "t1", nameEn: "Parts of a Plant", order: 1, groundingAssignment: null, unit });
    expect((await service.assignGroundingForTopic("t1")).outcome).toBe("NOT_GROUNDED");
    expect(upsert).not.toHaveBeenCalled();
  });
});
