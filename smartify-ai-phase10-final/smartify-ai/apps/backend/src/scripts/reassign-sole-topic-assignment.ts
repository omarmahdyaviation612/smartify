/**
 * Explicit-allowlist, deterministic REASSIGNMENT of sole-Topic Units to the
 * whole-Unit (SINGLE_TOPIC_FALLBACK) grounding slice (2026-10-03).
 *
 * selectRelevantGrounding now evaluates the sole-Topic rule before hint and
 * keyword matching, but an existing identity-valid assignment row is never
 * recomputed on its own (assignGroundingForTopic returns UNCHANGED). This is
 * the deliberate, scoped path that applies the new rule to named Topics only:
 *
 *   - refuses unless the Topic is the ONLY Topic of its Unit, its current
 *     assignment is READY, identity-valid for the Unit's current grounding,
 *     on the current DETERMINISTIC_ASSIGNMENT_VERSION, and was produced by
 *     the narrowing methods KEYWORD_OVERLAP or HINT_MATCH;
 *   - recomputes with the same pure computeDeterministicAssignment the
 *     preparation path uses, and requires the result to be
 *     SINGLE_TOPIC_FALLBACK resolving the WHOLE Unit (every concept, fact and
 *     vocabulary item) through the runtime resolver;
 *   - never calls an AI provider, never changes the assignment version, never
 *     touches any other Topic;
 *   - DRY RUN by default; --apply writes with a compare-and-set on the exact
 *     row read (method + updatedAt + fingerprint), stopping on the first refusal.
 *
 * Reassignment changes the Topic's assignment fingerprint, so content stamped
 * under the old assignment becomes MISMATCH (never served). Content must be
 * regenerated for the new assignment — see regenerate-topic-content.
 *
 * Usage: node dist/scripts/reassign-sole-topic-assignment.js --topicIds=<id>[,<id>] [--apply]
 */
import { computeDeterministicAssignment, mergeReadyTopicEvidence, type DeterministicAssignment } from "../ai/context/topic-grounding-assignment.service";
import { DETERMINISTIC_ASSIGNMENT_VERSION, resolveAssignedGroundingSlice } from "../ai/context/topic-grounding-assignment.util";
import { evaluateTopicGroundingGate } from "../ai/context/topic-content-provenance.util";
import type { GroundingNotes } from "../interactive-lesson/unit-grounding/unit-grounding.types";

export const MAX_TOPICS_PER_RUN = 25;
const ID = /^[a-z0-9]{20,40}$/;
const NARROWING_METHODS = new Set(["KEYWORD_OVERLAP", "HINT_MATCH"]);

export function parseArgs(argv: string[]): { topicIds: string[]; apply: boolean } {
  for (const a of argv) if (!/^--topicIds=.+$/.test(a) && a !== "--apply") throw new Error(`unexpected argument: ${a}`);
  if (argv.filter((a) => a === "--apply").length > 1) throw new Error("--apply given more than once");
  const lists = argv.filter((a) => a.startsWith("--topicIds="));
  if (lists.length !== 1) throw new Error("--topicIds must be given exactly once");
  const topicIds = lists[0].slice("--topicIds=".length).split(",");
  if (topicIds.some((x) => !ID.test(x))) throw new Error("malformed --topicIds entry");
  if (new Set(topicIds).size !== topicIds.length) throw new Error("duplicate --topicIds entry");
  if (topicIds.length > MAX_TOPICS_PER_RUN) throw new Error(`at most ${MAX_TOPICS_PER_RUN} Topics per run`);
  return { topicIds, apply: argv.includes("--apply") };
}

export interface ReassignTopic {
  id: string;
  nameEn: string;
  order: number;
  groundingAssignment: any | null;
  topicSourceEvidence: any[];
  unit: { id: string; groundingVersion: number | null; groundingSourceFingerprint: string | null; groundingNotesJson: unknown; sourcePageStart: number | null; sourcePageEnd: number | null; topics: Array<{ id: string; nameEn: string; order: number }> };
}

const counts = (s: { concepts: unknown[]; facts: unknown[]; vocabulary: unknown[] }) => ({ concepts: s.concepts.length, facts: s.facts.length, vocabulary: s.vocabulary.length });

export interface ReassignPlan {
  topicId: string;
  oldMethod: string;
  newMethod: string;
  oldSlice: { concepts: number; facts: number; vocabulary: number };
  newSlice: { concepts: number; facts: number; vocabulary: number };
  unitTotals: { concepts: number; facts: number; vocabulary: number };
  oldAssignmentFingerprint: string;
  newAssignmentFingerprint: string;
  assignmentVersion: number;
  next: DeterministicAssignment;
}

/** Pure: refuses (throws) unless the Topic is a narrowed sole-Topic assignment that recomputes to a whole-Unit slice. */
export function planReassignment(topic: ReassignTopic): ReassignPlan {
  const u = topic.unit, a = topic.groundingAssignment;
  if (u.topics.length !== 1 || u.topics[0].id !== topic.id) throw new Error(`${topic.id}: Unit ${u.id} has ${u.topics.length} Topics — not a sole-Topic Unit`);
  if (!a || a.status !== "READY") throw new Error(`${topic.id}: assignment is not READY`);
  if (!NARROWING_METHODS.has(a.method)) throw new Error(`${topic.id}: assignment method ${a.method} is not a narrowing deterministic method`);
  if (a.assignmentVersion !== DETERMINISTIC_ASSIGNMENT_VERSION) throw new Error(`${topic.id}: assignment version ${a.assignmentVersion} is not current`);
  const oldGate = evaluateTopicGroundingGate(topic as any);
  if (oldGate.state !== "READY") throw new Error(`${topic.id}: current assignment is not READY_CURRENT_NON_EMPTY (${oldGate.reason})`);
  const notes = mergeReadyTopicEvidence(u.groundingNotesJson as GroundingNotes, (topic.topicSourceEvidence ?? []).filter((e) => e.status === "READY"), topic.id, u.id, u.groundingSourceFingerprint!, u.sourcePageStart, u.sourcePageEnd);
  const next = computeDeterministicAssignment(notes, { id: topic.id, nameEn: topic.nameEn, order: topic.order }, u.topics.map((t) => ({ id: t.id, nameEn: t.nameEn, order: t.order })));
  if (!next || next.method !== "SINGLE_TOPIC_FALLBACK") throw new Error(`${topic.id}: recomputation did not yield SINGLE_TOPIC_FALLBACK (${next?.method ?? "none"})`);
  const candidateRow = { ...a, method: next.method, matchedConceptNames: next.matchedConceptNames, matchedHintTitles: next.matchedHintTitles, mapperPromptVersion: null, assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION };
  const resolved = resolveAssignedGroundingSlice(candidateRow, { id: u.id, groundingVersion: u.groundingVersion, groundingSourceFingerprint: u.groundingSourceFingerprint, groundingNotesJson: u.groundingNotesJson as GroundingNotes }, topic.topicSourceEvidence);
  if (resolved.state !== "READY") throw new Error(`${topic.id}: new assignment would not resolve READY (${resolved.state})`);
  const raw = u.groundingNotesJson as GroundingNotes;
  const unitTotals = counts({ concepts: raw.concepts ?? [], facts: raw.facts ?? [], vocabulary: raw.vocabulary ?? [] });
  const newSlice = counts(resolved.slice);
  if (JSON.stringify(newSlice) !== JSON.stringify(unitTotals)) throw new Error(`${topic.id}: new slice ${JSON.stringify(newSlice)} does not cover the whole Unit ${JSON.stringify(unitTotals)}`);
  const newGate = evaluateTopicGroundingGate({ ...topic, groundingAssignment: candidateRow } as any);
  if (newGate.state !== "READY") throw new Error(`${topic.id}: new gate not READY`);
  return {
    topicId: topic.id, oldMethod: a.method, newMethod: next.method, oldSlice: counts(oldGate.slice), newSlice, unitTotals,
    oldAssignmentFingerprint: oldGate.provenance.groundingAssignmentFingerprint, newAssignmentFingerprint: newGate.provenance.groundingAssignmentFingerprint,
    assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION, next,
  };
}

export interface ReassignDeps {
  loadTopic(id: string): Promise<ReassignTopic | null>;
  /** Compare-and-set write; returns the number of rows updated (must be 1). */
  writeAssignment(topicId: string, expected: { method: string; updatedAt: Date; unitSourceFingerprint: string }, next: DeterministicAssignment): Promise<number>;
}

export async function runReassignment(args: { topicIds: string[]; apply: boolean }, deps: ReassignDeps) {
  const results: Array<Omit<ReassignPlan, "next"> & { applied: boolean }> = [];
  for (const id of args.topicIds) {
    const topic = await deps.loadTopic(id);
    if (!topic) throw new Error(`Topic ${id} not found`);
    const plan = planReassignment(topic);
    const { next, ...report } = plan;
    if (args.apply) {
      const a = topic.groundingAssignment;
      const n = await deps.writeAssignment(id, { method: a.method, updatedAt: a.updatedAt, unitSourceFingerprint: a.unitSourceFingerprint }, next);
      if (n !== 1) throw new Error(`${id}: assignment changed concurrently; nothing written`);
    }
    results.push({ ...report, applied: args.apply });
  }
  return { mode: args.apply ? "APPLY" : "DRY_RUN", results };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await import("dotenv/config");
  const { prisma } = await import("@smartify/database");
  try {
    const out = await runReassignment(args, {
      loadTopic: async (id) =>
        (await prisma.topic.findUnique({
          where: { id },
          select: {
            id: true, nameEn: true, order: true, groundingAssignment: true, topicSourceEvidence: true,
            unit: { select: { id: true, groundingVersion: true, groundingSourceFingerprint: true, groundingNotesJson: true, sourcePageStart: true, sourcePageEnd: true, topics: { select: { id: true, nameEn: true, order: true }, orderBy: { order: "asc" } } } },
          },
        })) as any,
      writeAssignment: async (topicId, expected, next) =>
        (await prisma.topicGroundingAssignment.updateMany({
          where: { topicId, method: expected.method as any, updatedAt: expected.updatedAt, unitSourceFingerprint: expected.unitSourceFingerprint },
          data: {
            method: next.method as any, confidence: next.confidence as any, status: "READY", assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION,
            matchedConceptNames: next.matchedConceptNames as any, matchedHintTitles: (next.matchedHintTitles ?? null) as any, mapperModel: null, mapperPromptVersion: null, reason: next.reason,
          },
        })).count,
    });
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("REASSIGNMENT FAILED:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
