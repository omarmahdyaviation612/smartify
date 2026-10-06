/**
 * 2026-10-03 sole-Topic precedence — deterministic assignment + the scoped
 * reassignment tool. See grounding-selector.util.spec.ts for the selector-level
 * cases 1-3.
 */
import { normalizeTitle, selectRelevantGrounding } from "./grounding-selector.util";
import { computeDeterministicAssignment, stepsOneToThree } from "./topic-grounding-assignment.service";
import { DETERMINISTIC_ASSIGNMENT_VERSION, resolveAssignedGroundingSlice } from "./topic-grounding-assignment.util";
import { evaluateTopicGroundingGate } from "./topic-content-provenance.util";
import { parseArgs, planReassignment, runReassignment, MAX_TOPICS_PER_RUN } from "../../scripts/reassign-sole-topic-assignment";
import type { GroundingNotes, GroundingSlice } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

// Wave B "Planet Earth" shape: a sole Topic whose title overlaps ONE concept;
// a fact (p.9) and a vocabulary term (p.8) sit on pages no concept cites.
const NOTES: GroundingNotes = {
  unitTitle: "Planet Earth", gradeLevel: "Year 1", subject: "Science",
  learningObjectives: ["Identify bodies of water.", "Identify rocks."],
  concepts: [
    { name: "Types of Water Bodies", description: "Oceans, lakes and rivers differ.", sourcePages: [1, 2], importance: "core" },
    { name: "Types of Rocks", description: "There are many kinds of rocks.", sourcePages: [5], importance: "core" },
    { name: "Components of Earth", description: "Earth is made up of soil, rocks and water.", sourcePages: [7], importance: "core" },
  ],
  facts: [
    { fact: "Most of the planet is covered in water.", sourcePages: [1], importance: "core" },
    { fact: "Soil holds water for plants.", sourcePages: [9], importance: "core" },
  ],
  vocabulary: [
    { term: "ocean", meaning: "A very large area of salt water.", sourcePages: [1] },
    { term: "geologist", meaning: "A scientist who studies rocks.", sourcePages: [8] },
  ],
  skills: [],
  topicHints: [
    { topicTitle: "Water Bodies", relevantConcepts: ["Types of Water Bodies"], sourcePages: [1, 2] },
    { topicTitle: "Earth's Composition", relevantConcepts: ["Components of Earth"], sourcePages: [7] },
  ],
  scopeNotes: [],
};
const FP = "fp-unit-current";
const unitOf = (topics: Array<{ id: string; nameEn: string; order: number }>) => ({ id: "unit-1", groundingVersion: 1, groundingSourceFingerprint: FP, groundingNotesJson: NOTES, sourcePageStart: 1, sourcePageEnd: 9, contentProvenanceEnforcedAt: null, topics });
const rowFrom = (a: { method: string; matchedConceptNames: string[]; matchedHintTitles: string[] | null }, extra: Record<string, unknown> = {}) => ({
  unitGroundingVersion: 1, unitSourceFingerprint: FP, assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION, mapperPromptVersion: null, status: "READY", confidence: "HIGH",
  method: a.method, matchedConceptNames: a.matchedConceptNames, matchedHintTitles: a.matchedHintTitles, updatedAt: new Date("2026-10-02T14:00:00Z"), ...extra,
});
const resolve = (row: any) => resolveAssignedGroundingSlice(row, { id: "unit-1", groundingVersion: 1, groundingSourceFingerprint: FP, groundingNotesJson: NOTES }, []);

describe("sole-Topic precedence — deterministic assignment", () => {
  const sole = (nameEn: string) => computeDeterministicAssignment(NOTES, { id: "t1", nameEn, order: 1 }, [{ id: "t1", nameEn, order: 1 }]);
  it.each([
    ["1: keyword overlap", "Planet Earth"],
    ["2: exact hint match", "Water Bodies"],
    ["3: zero overlap", "Chapter 8"],
  ])("%s on a sole Topic -> SINGLE_TOPIC_FALLBACK", (_n, title) => {
    expect(sole(title)!.method).toBe("SINGLE_TOPIC_FALLBACK");
  });

  it("4: the PERSISTED whole-Unit row resolves every concept, fact and vocabulary item at read time — including items on pages no concept cites", () => {
    const resolved = resolve(rowFrom(sole("Planet Earth")!));
    expect(resolved.state).toBe("READY");
    if (resolved.state !== "READY") return;
    expect(resolved.slice.concepts).toEqual(NOTES.concepts);
    expect(resolved.slice.facts).toEqual(NOTES.facts);
    expect(resolved.slice.vocabulary).toEqual(NOTES.vocabulary);
    expect(resolved.slice.learningObjectives).toEqual(NOTES.learningObjectives);
  });

  it("4b: whole-Unit names are a verbatim subset of the Unit's own concept names, vocabulary terms and fact texts — nothing invented", () => {
    const allowed = new Set([...NOTES.concepts.map((c) => c.name), ...NOTES.vocabulary.map((v) => v.term), ...NOTES.facts.map((f) => f.fact)]);
    expect(sole("Planet Earth")!.matchedConceptNames.every((n) => allowed.has(n))).toBe(true);
  });

  it("5: multi-Topic keyword selection is unchanged (narrow concept slice, concept names only)", () => {
    const sibs = [{ id: "t1", nameEn: "Rocks Around Us", order: 1 }, { id: "t2", nameEn: "Water Bodies", order: 2 }];
    const a = computeDeterministicAssignment(NOTES, sibs[0], sibs)!;
    expect(a).toMatchObject({ method: "KEYWORD_OVERLAP", matchedConceptNames: ["Types of Rocks"], matchedHintTitles: null });
  });

  it("6: multi-Topic hint selection is unchanged", () => {
    const sibs = [{ id: "t1", nameEn: "Rocks Around Us", order: 1 }, { id: "t2", nameEn: "Water Bodies", order: 2 }];
    const a = computeDeterministicAssignment(NOTES, sibs[1], sibs)!;
    expect(a).toMatchObject({ method: "HINT_MATCH", matchedConceptNames: ["Types of Water Bodies"], matchedHintTitles: ["Water Bodies"] });
  });

  it("5/6: for any Topic count other than 1 the selector is identical to the pre-change implementation", () => {
    // Frozen copy of the selector exactly as it was before this change.
    const STOP = new Set(["the", "a", "an", "of", "and", "in", "on", "to", "for", "with", "is", "are"]);
    const kw = (t: string) => new Set(normalizeTitle(t).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
    const before = (notes: GroundingNotes, title: string, count?: number): GroundingSlice | null => {
      const hint = notes.topicHints?.find((h) => normalizeTitle(h.topicTitle) === normalizeTitle(title));
      if (hint) {
        const rel = new Set(hint.relevantConcepts.map((c) => c.toLowerCase()));
        return { matchedViaHint: true, matchedVia: "HINT", matchedHintTitle: hint.topicTitle, learningObjectives: notes.learningObjectives, concepts: notes.concepts.filter((c) => rel.has(c.name.toLowerCase()) || hint.sourcePages.some((p) => c.sourcePages.includes(p))), facts: notes.facts.filter((f) => hint.sourcePages.some((p) => f.sourcePages.includes(p))), vocabulary: notes.vocabulary.filter((v) => hint.sourcePages.some((p) => v.sourcePages.includes(p))) } as GroundingSlice;
      }
      const tk = kw(title);
      const scored = notes.concepts.filter((c) => [...tk].some((w) => kw(c.name).has(w)));
      if (scored.length === 0) return count === 1 ? ({ matchedViaHint: false, matchedVia: "SINGLE_TOPIC_UNIT", learningObjectives: notes.learningObjectives, concepts: notes.concepts, facts: notes.facts, vocabulary: notes.vocabulary } as GroundingSlice) : null;
      const names = new Set(scored.map((c) => c.name.toLowerCase())), pages = new Set(scored.flatMap((c) => c.sourcePages));
      return { matchedViaHint: false, matchedVia: "KEYWORD", learningObjectives: notes.learningObjectives, concepts: scored, facts: notes.facts.filter((f) => f.sourcePages.some((p) => pages.has(p))), vocabulary: notes.vocabulary.filter((v) => v.sourcePages.some((p) => pages.has(p)) || names.has(v.term.toLowerCase())) } as GroundingSlice;
    };
    for (const title of ["Planet Earth", "Water Bodies", "earth's composition", "Rocks", "Chapter 8", "Ocean Life", "Types of Rocks and Water"]) {
      for (const count of [undefined, 2, 3, 7]) expect(selectRelevantGrounding(NOTES, title, count)).toEqual(before(NOTES, title, count));
    }
  });

  it("7: the deterministic assignment version is unchanged (no global invalidation)", () => {
    expect(DETERMINISTIC_ASSIGNMENT_VERSION).toBe(3);
  });

  it("8: selection is pure — no provider, no DB (synchronous return, no promise)", () => {
    const r: unknown = stepsOneToThree(NOTES, { id: "t1", nameEn: "Planet Earth", order: 1 }, 1);
    expect(r).not.toBeInstanceOf(Promise);
  });
});

describe("reassign-sole-topic-assignment (scoped, deterministic, CAS)", () => {
  const narrowRow = () => rowFrom({ method: "KEYWORD_OVERLAP", matchedConceptNames: ["Components of Earth"], matchedHintTitles: null });
  const topicWith = (over: Record<string, unknown> = {}, topics = [{ id: "t1", nameEn: "Planet Earth", order: 1 }]) => ({ id: "t1", nameEn: "Planet Earth", order: 1, groundingAssignment: narrowRow(), topicSourceEvidence: [], unit: unitOf(topics), ...over }) as any;

  it("parses an explicit bounded allowlist; dry-run by default", () => {
    expect(parseArgs(["--topicIds=cmucxctmo00452qd5mup33wd7"])).toEqual({ topicIds: ["cmucxctmo00452qd5mup33wd7"], apply: false });
    const many = Array.from({ length: MAX_TOPICS_PER_RUN + 1 }, (_, i) => `cmucxctmo00452qd5mup33${String(i).padStart(3, "0")}`).join(",");
    for (const bad of [[], ["--unitIds=cmucxctmm00432qd558da9d5n"], [`--topicIds=${many}`], ["--topicIds=x y"]]) expect(() => parseArgs(bad)).toThrow();
  });

  it("plans narrow -> SINGLE_TOPIC_FALLBACK covering the whole Unit; the assignment fingerprint changes; version unchanged", () => {
    const p = planReassignment(topicWith());
    expect(p).toMatchObject({ oldMethod: "KEYWORD_OVERLAP", newMethod: "SINGLE_TOPIC_FALLBACK", oldSlice: { concepts: 1 }, newSlice: { concepts: 3, facts: 2, vocabulary: 2 }, unitTotals: { concepts: 3, facts: 2, vocabulary: 2 }, assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION });
    expect(p.newAssignmentFingerprint).not.toBe(p.oldAssignmentFingerprint);
    const newRow = rowFrom(p.next);
    const gate = evaluateTopicGroundingGate({ groundingAssignment: newRow, topicSourceEvidence: [], unit: unitOf([]) } as any);
    expect(gate.state === "READY" && gate.provenance.groundingAssignmentFingerprint).toBe(p.newAssignmentFingerprint);
  });

  it.each([
    ["a multi-Topic Unit", () => topicWith({}, [{ id: "t1", nameEn: "Planet Earth", order: 1 }, { id: "t2", nameEn: "Rocks", order: 2 }])],
    ["a BLOCKED assignment", () => topicWith({ groundingAssignment: { ...narrowRow(), status: "BLOCKED" } })],
    ["an AI_MAPPER assignment", () => topicWith({ groundingAssignment: { ...narrowRow(), method: "AI_MAPPER", mapperPromptVersion: 1 } })],
    ["an already whole-Unit assignment", () => topicWith({ groundingAssignment: { ...narrowRow(), method: "SINGLE_TOPIC_FALLBACK" } })],
    ["a stale (old-fingerprint) assignment", () => topicWith({ groundingAssignment: { ...narrowRow(), unitSourceFingerprint: "fp-old" } })],
    ["an old assignment version", () => topicWith({ groundingAssignment: { ...narrowRow(), assignmentVersion: 2 } })],
  ])("refuses %s", (_n, make) => {
    expect(() => planReassignment(make())).toThrow();
  });

  it("dry run writes nothing; apply performs exactly one compare-and-set write per Topic and never a provider call", async () => {
    const deps = { loadTopic: jest.fn().mockResolvedValue(topicWith()), writeAssignment: jest.fn().mockResolvedValue(1) };
    const dry = await runReassignment({ topicIds: ["t1"], apply: false }, deps);
    expect(dry.results[0]).toMatchObject({ applied: false, newMethod: "SINGLE_TOPIC_FALLBACK" });
    expect(deps.writeAssignment).not.toHaveBeenCalled();
    await runReassignment({ topicIds: ["t1"], apply: true }, deps);
    expect(deps.writeAssignment).toHaveBeenCalledTimes(1);
    const [topicId, expected, next] = deps.writeAssignment.mock.calls[0];
    expect(topicId).toBe("t1");
    expect(expected).toEqual({ method: "KEYWORD_OVERLAP", updatedAt: narrowRow().updatedAt, unitSourceFingerprint: FP });
    expect(next.method).toBe("SINGLE_TOPIC_FALLBACK");
  });

  it("a concurrent change (CAS matched 0 rows) stops the run; later Topics are never loaded", async () => {
    const deps = { loadTopic: jest.fn().mockResolvedValue(topicWith()), writeAssignment: jest.fn().mockResolvedValue(0) };
    await expect(runReassignment({ topicIds: ["t1", "t2"], apply: true }, deps)).rejects.toThrow(/concurrently/);
    expect(deps.loadTopic).toHaveBeenCalledTimes(1);
  });
});
