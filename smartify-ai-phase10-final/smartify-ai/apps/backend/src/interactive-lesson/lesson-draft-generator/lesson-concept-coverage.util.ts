import type { TeachingStep } from "../interactive-lesson.types";
import type { GroundingSlice } from "../unit-grounding/unit-grounding.types";

/**
 * Lesson completeness (2026-10-10). Production report: lessons covered only
 * part of the textbook material for a Topic. Root cause: the planner was asked
 * for "roughly 6-8 steps" (typically ONE EXPLAIN + ONE EXAMPLE) regardless of
 * how many textbook concepts the Topic's grounding slice holds, and the only
 * grounding check (checkGroundingConsistency) required just ONE concept to be
 * mentioned anywhere. A Topic with 6 concepts could therefore be published
 * teaching 1-2 of them, and — cached in Topic.teachingStepsJson — every
 * student got the same partial lesson.
 *
 * This module makes coverage deterministic: every grounding concept must be
 * claimed (by exact name, case/space-insensitive) in the `concepts` field of
 * at least one EXPLAIN or EXAMPLE step. Anything the model leaves out is
 * repaired in code by inserting a dedicated EXPLAIN step — no extra AI call,
 * no retry budget, and no way for a partial lesson to be published.
 */

const TEACHING_TYPES = new Set(["EXPLAIN", "EXAMPLE"]);
const STEPS_PER_INSERTED_CHECK = 3;

export function normalizeConceptName(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[\s_\-]+/g, " ").replace(/[.,;:!?'"()]/g, "").trim();
}

/**
 * Upper bound on steps for a grounded lesson: intro + review + complete,
 * one teaching step per concept, roughly one check per two concepts, plus
 * room for worked examples. Never below the historical limit of 10.
 */
export function maxStepsForConceptCount(conceptCount: number): number {
  return Math.min(30, Math.max(10, conceptCount * 2 + 6));
}

/** Grounding concept names (original spelling) not taught by any EXPLAIN/EXAMPLE step. */
export function findUncoveredConcepts(steps: TeachingStep[], slice: GroundingSlice | null | undefined): string[] {
  if (!slice || slice.concepts.length === 0) return [];
  const taught = new Set<string>();
  for (const step of steps) {
    if (!TEACHING_TYPES.has(step.type)) continue;
    for (const name of step.concepts ?? []) taught.add(normalizeConceptName(name));
    if (step.conceptKey) taught.add(normalizeConceptName(step.conceptKey));
  }
  return slice.concepts.map((c) => c.name).filter((name) => !taught.has(normalizeConceptName(name)));
}

/**
 * Keeps only concept names that exist in the slice, rewritten to the slice's
 * own spelling, so later lookups (runtime teaching prompt) are exact.
 */
function canonicalizeStepConcepts(steps: TeachingStep[], slice: GroundingSlice): TeachingStep[] {
  const byNorm = new Map(slice.concepts.map((c) => [normalizeConceptName(c.name), c.name]));
  return steps.map((step) => {
    if (!step.concepts) return step;
    const canonical = [...new Set(step.concepts.map((n) => byNorm.get(normalizeConceptName(n))).filter((n): n is string => !!n))];
    const { concepts: _drop, ...rest } = step;
    return canonical.length > 0 ? { ...rest, concepts: canonical } : (rest as TeachingStep);
  });
}

export interface CoverageRepairResult {
  steps: TeachingStep[];
  insertedConcepts: string[];
}

/**
 * Returns steps in which every grounding concept is taught. Missing concepts
 * each get an EXPLAIN step (plus a conceptual CHECK for every few inserted
 * concepts), placed before the first REVIEW step — or before COMPLETE when
 * there is no REVIEW — so the lesson still ends REVIEW/COMPLETE. Orders are
 * renumbered to match array positions; ids stay unique.
 */
export function ensureConceptCoverage(steps: TeachingStep[], slice: GroundingSlice | null | undefined): CoverageRepairResult {
  if (!slice || slice.concepts.length === 0) return { steps, insertedConcepts: [] };
  const canonical = canonicalizeStepConcepts(steps, slice);
  const missing = findUncoveredConcepts(canonical, slice);
  if (missing.length === 0) return { steps: renumber(canonical), insertedConcepts: [] };

  const usedIds = new Set(canonical.map((s) => s.id));
  const nextId = (base: string) => {
    let i = 1;
    while (usedIds.has(`${base}${i}`)) i++;
    const id = `${base}${i}`;
    usedIds.add(id);
    return id;
  };

  const inserted: TeachingStep[] = [];
  for (let i = 0; i < missing.length; i += STEPS_PER_INSERTED_CHECK) {
    const group = missing.slice(i, i + STEPS_PER_INSERTED_CHECK);
    for (const name of group) {
      inserted.push({
        id: nextId("cov"),
        type: "EXPLAIN",
        order: 0,
        objective: `Teach the textbook concept "${name}" completely: what it is, its key facts and vocabulary from the reference notes, and one simple child-friendly example.`,
        concepts: [name],
      });
    }
    inserted.push({
      id: nextId("covcheck"),
      type: "CHECK",
      order: 0,
      checkType: "conceptual",
      objective: `Ask one short conceptual question that checks the student understood ${group.map((n) => `"${n}"`).join(", ")}.`,
      concepts: group,
    });
  }

  let insertAt = canonical.findIndex((s) => s.type === "REVIEW");
  if (insertAt === -1) insertAt = canonical.findIndex((s) => s.type === "COMPLETE");
  if (insertAt === -1) insertAt = canonical.length;
  const merged = [...canonical.slice(0, insertAt), ...inserted, ...canonical.slice(insertAt)];
  return { steps: renumber(merged), insertedConcepts: missing };
}

function renumber(steps: TeachingStep[]): TeachingStep[] {
  return steps.map((s, i) => ({ ...s, order: i + 1 }));
}
