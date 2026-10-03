import { createHash } from "crypto";
import { Prisma } from "@smartify/database";
import type { GroundingNotes, GroundingSlice } from "../../interactive-lesson/unit-grounding/unit-grounding.types";
import { DETERMINISTIC_ASSIGNMENT_VERSION, REVIEWED_METHOD } from "./topic-grounding-assignment.util";
import { classifyContentProvenance, evaluateTopicGroundingGate, isRetired, QUESTION_PROVENANCE_SELECT, topicStepsProvenance, UNIT_GATE_SELECT, type ContentProvenanceState } from "./topic-content-provenance.util";
import { groundingAnchorWords } from "./grounding-consistency-validator";

/**
 * REVIEWED assignment (2026-10-04): an admin-approved selection of EXACT
 * evidence already present in one Unit's current grounding, written for ONE
 * Topic by the guarded tool scripts/reassign-reviewed-topic-assignment.ts.
 *
 * What it is: the same persisted references every method stores
 * (`matchedConceptNames` = concept names / vocabulary terms / fact text,
 * `matchedHintTitles` = topicHints titles), chosen by a person instead of an
 * algorithm, resolved by the unchanged runtime slice resolver and fingerprinted
 * by the unchanged provenance code.
 * What it is not: authored content, a source-page override, or anything
 * Topic-specific in code. A reference that is not verbatim in the Unit's own
 * grounding is refused; nothing is fuzzy-matched.
 *
 * Uniqueness: the resolver matches a persisted name lowercase across the
 * concept, vocabulary and fact pools, so a reference must identify exactly
 * the items the reviewer saw. A reference whose name occurs more than once in
 * its pool is refused unless the manifest declares the exact count
 * (`{ "name": ..., "occurrences": n }`); a reference that would also resolve
 * into another pool or to a case variant is refused outright.
 *
 * Content safety: a direct flip is allowed only when the Topic has NO CURRENT
 * content (CASE A) — there is nothing to invalidate, and LEGACY content keeps
 * its normal TRANSITION servability. With CURRENT content (CASE B) the tool
 * refuses: that needs staged regeneration + an atomic assignment/content flip.
 * Zero provider calls: nothing here constructs or reaches an AI provider.
 */

export type ReviewedRef = string | { name: string; occurrences: number };
export interface ReviewedManifest { concepts?: ReviewedRef[]; vocabulary?: ReviewedRef[]; facts?: ReviewedRef[]; hints?: ReviewedRef[] }
type Kind = "concepts" | "vocabulary" | "facts" | "hints";
const KINDS: Kind[] = ["concepts", "vocabulary", "facts", "hints"];

export class ReviewedAssignmentError extends Error {
  constructor(readonly code: string, message: string, readonly detail?: unknown) {
    super(`${code}: ${message}`);
    this.name = "ReviewedAssignmentError";
  }
}

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x ?? null)).digest("hex");

/** Strict manifest parse: only the four known keys, arrays of exact non-empty strings or {name, occurrences>=2}. */
export function parseManifest(raw: unknown): ReviewedManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ReviewedAssignmentError("MANIFEST", "evidence manifest must be a JSON object");
  const out: ReviewedManifest = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KINDS.includes(key as Kind)) throw new ReviewedAssignmentError("MANIFEST", `unknown manifest key "${key}"`);
    if (!Array.isArray(value)) throw new ReviewedAssignmentError("MANIFEST", `"${key}" must be an array`);
    out[key as Kind] = value.map((r) => {
      if (typeof r === "string" && r.length > 0) return r;
      if (r && typeof r === "object" && !Array.isArray(r) && Object.keys(r).length === 2 && typeof (r as any).name === "string" && (r as any).name.length > 0 && Number.isInteger((r as any).occurrences) && (r as any).occurrences >= 2) return { name: (r as any).name, occurrences: (r as any).occurrences };
      throw new ReviewedAssignmentError("MANIFEST", `invalid "${key}" reference ${JSON.stringify(r)}`);
    });
  }
  if (KINDS.every((k) => !(out[k]?.length))) throw new ReviewedAssignmentError("MANIFEST", "evidence manifest selects nothing");
  return out;
}

export interface ResolvedReference { kind: Kind; name: string; occurrences: number; pages: number[][] }

/** Validates every reference against ONE Unit's own grounding notes (never TopicSourceEvidence, never another Unit). */
export function validateReferences(notes: GroundingNotes, manifest: ReviewedManifest): { references: ResolvedReference[]; errors: string[] } {
  const pools: Record<Kind, Array<{ label: string; pages: number[] }>> = {
    concepts: notes.concepts.map((c) => ({ label: c.name, pages: c.sourcePages })),
    vocabulary: notes.vocabulary.map((v) => ({ label: v.term, pages: v.sourcePages })),
    facts: notes.facts.map((f) => ({ label: f.fact, pages: f.sourcePages })),
    hints: (notes.topicHints ?? []).map((h) => ({ label: h.topicTitle, pages: h.sourcePages ?? [] })),
  };
  const errors: string[] = [];
  const references: ResolvedReference[] = [];
  const seenFlat = new Set<string>();
  const seenHints = new Set<string>();
  for (const kind of KINDS) {
    for (const ref of manifest[kind] ?? []) {
      const name = typeof ref === "string" ? ref : ref.name;
      const declared = typeof ref === "string" ? 1 : ref.occurrences;
      const key = name.toLowerCase();
      const seen = kind === "hints" ? seenHints : seenFlat;
      if (seen.has(key)) { errors.push(`DUPLICATE_REFERENCE ${kind} "${name}"`); continue; }
      seen.add(key);
      const exact = pools[kind].filter((x) => x.label === name);
      if (exact.length === 0) { errors.push(`NOT_FOUND ${kind} "${name}" is not verbatim in this Unit's current grounding`); continue; }
      if (pools[kind].some((x) => x.label !== name && x.label.toLowerCase() === key)) errors.push(`AMBIGUOUS_CASE ${kind} "${name}" also matches a case variant`);
      if (kind !== "hints") {
        const other = (["concepts", "vocabulary", "facts"] as Kind[]).filter((k) => k !== kind && pools[k].some((x) => x.label.toLowerCase() === key));
        if (other.length) errors.push(`AMBIGUOUS_POOL ${kind} "${name}" would also resolve into ${other.join(",")}`);
      }
      if (exact.length !== declared) errors.push(`AMBIGUOUS_DUPLICATE ${kind} "${name}" occurs ${exact.length}x in the grounding (declared ${declared})`);
      references.push({ kind, name, occurrences: exact.length, pages: exact.map((x) => x.pages) });
    }
  }
  return { references, errors };
}

/** Everything the planner reads for one Topic (Prisma select below). */
export const REVIEWED_TOPIC_SELECT = {
  id: true,
  nameEn: true,
  unitId: true,
  teachingStepsJson: true,
  groundingSourceFingerprintUsed: true,
  groundingAssignmentFingerprintUsed: true,
  groundingAssignment: true,
  topicSourceEvidence: true,
  unit: { select: UNIT_GATE_SELECT },
  questions: { select: { id: true, topicId: true, isPlaceholder: true, ...QUESTION_PROVENANCE_SELECT, _count: { select: { attempts: true } } } },
  lessons: { select: { _count: { select: { progress: true } } } },
  _count: { select: { lessonSessions: true, quizResults: true } },
} as const;

export interface ReviewedPlan {
  topicId: string;
  topicName: string;
  unitId: string;
  enforcement: "STRICT" | "TRANSITION";
  expectedRowHash: string;
  old: { method: string; status: string; matchedConceptNames: unknown; matchedHintTitles: unknown; fingerprint: string | null; anchors: string[]; slice: SliceSummary | null };
  candidate: { row: Record<string, unknown>; fingerprint: string; anchors: string[]; slice: SliceSummary };
  references: ResolvedReference[];
  content: { stepsBefore: ContentProvenanceState | "NONE" | "NO_GATE"; stepsAfter: ContentProvenanceState | "NONE"; questionsBefore: Record<string, number>; questionsAfter: Record<string, number> };
}
interface SliceSummary { concepts: Array<[string, number[]]>; facts: Array<[string, number[]]>; vocabulary: Array<[string, number[]]>; pages: number[] }

function summarize(slice: GroundingSlice): SliceSummary {
  const items = [...slice.concepts.map((c) => c.sourcePages), ...slice.facts.map((f) => f.sourcePages), ...slice.vocabulary.map((v) => v.sourcePages)];
  return {
    concepts: slice.concepts.map((c) => [c.name, c.sourcePages]),
    facts: slice.facts.map((f) => [f.fact, f.sourcePages]),
    vocabulary: slice.vocabulary.map((v) => [v.term, v.sourcePages]),
    pages: [...new Set(items.flat())].sort((a, b) => a - b),
  };
}

/** The CAS identity of the live assignment row: any change between dry-run and apply refuses the apply. */
export function assignmentRowHash(a: any): string {
  return sha({ id: a.id, topicId: a.topicId, method: a.method, status: a.status, confidence: a.confidence, matchedConceptNames: a.matchedConceptNames, matchedHintTitles: a.matchedHintTitles ?? null, unitGroundingVersion: a.unitGroundingVersion, unitSourceFingerprint: a.unitSourceFingerprint, assignmentVersion: a.assignmentVersion, mapperPromptVersion: a.mapperPromptVersion ?? null, updatedAt: new Date(a.updatedAt).toISOString() });
}

function contentState(topic: any, provenance: { groundingSourceFingerprint: string; groundingAssignmentFingerprint: string } | null) {
  const hasSteps = Array.isArray(topic.teachingStepsJson) && topic.teachingStepsJson.length > 0;
  const steps: ContentProvenanceState | "NONE" | "NO_GATE" = !hasSteps ? "NONE" : provenance ? classifyContentProvenance(topicStepsProvenance(topic), provenance) : "NO_GATE";
  const questions: Record<string, number> = { CURRENT: 0, MISMATCH: 0, LEGACY: 0, retired: 0 };
  for (const q of topic.questions.filter((x: any) => !x.isPlaceholder)) {
    if (isRetired(q)) questions.retired++;
    else questions[provenance ? classifyContentProvenance(q, provenance) : (q.groundingAssignmentFingerprint ? "MISMATCH" : "LEGACY")]++;
  }
  return { steps, questions };
}

/** Pure: every precondition, the candidate row, its resolved slice and fingerprint. Throws ReviewedAssignmentError on any refusal. */
export function planReviewedAssignment(topic: any, manifest: ReviewedManifest): ReviewedPlan {
  if (!topic) throw new ReviewedAssignmentError("TOPIC", "Topic not found");
  const unit = topic.unit;
  if (!unit || unit.id !== topic.unitId) throw new ReviewedAssignmentError("UNIT", `${topic.id}: Topic/Unit relation mismatch`);
  if (unit.groundingVersion === null || !unit.groundingSourceFingerprint || !unit.groundingNotesJson) throw new ReviewedAssignmentError("NOT_GROUNDED", `${topic.id}: Unit ${unit.id} has no current grounding`);
  const old = topic.groundingAssignment;
  if (!old) throw new ReviewedAssignmentError("NO_ASSIGNMENT_ROW", `${topic.id}: no assignment row to compare-and-set`);
  const activity = topic._count.lessonSessions + topic._count.quizResults + topic.lessons.reduce((s: number, l: any) => s + l._count.progress, 0) + topic.questions.reduce((s: number, q: any) => s + q._count.attempts, 0);
  if (activity !== 0) throw new ReviewedAssignmentError("ACTIVITY", `${topic.id}: Topic has ${activity} student activity row(s)`);

  const notes = unit.groundingNotesJson as GroundingNotes;
  const { references, errors } = validateReferences(notes, manifest);
  if (errors.length) throw new ReviewedAssignmentError("EVIDENCE", `${topic.id}: ${errors.length} invalid reference(s)`, errors);

  const flat = references.filter((r) => r.kind !== "hints").map((r) => r.name);
  const hints = references.filter((r) => r.kind === "hints").map((r) => r.name);
  const row = {
    topicId: topic.id,
    unitGroundingVersion: unit.groundingVersion,
    unitSourceFingerprint: unit.groundingSourceFingerprint,
    assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION,
    method: REVIEWED_METHOD,
    confidence: "HIGH",
    status: "READY",
    matchedConceptNames: flat,
    matchedHintTitles: hints.length ? hints : null,
    mapperModel: null,
    mapperPromptVersion: null,
    reason: `[REVIEWED] admin-reviewed exact evidence (manifest ${sha({ flat, hints }).slice(0, 12)}).`,
  };
  const candidateGate = evaluateTopicGroundingGate({ ...topic, groundingAssignment: row });
  if (candidateGate.state !== "READY") throw new ReviewedAssignmentError("CANDIDATE_NOT_READY", `${topic.id}: reviewed candidate resolves ${candidateGate.reason}`);

  const oldGate = evaluateTopicGroundingGate(topic);
  const before = contentState(topic, oldGate.state === "READY" ? oldGate.provenance : null);
  if (before.steps === "CURRENT" || before.questions.CURRENT > 0) {
    throw new ReviewedAssignmentError("CURRENT_CONTENT_REQUIRES_STAGED_FLIP", `${topic.id}: Topic has CURRENT content (steps ${before.steps}, ${before.questions.CURRENT} CURRENT Questions); a direct reviewed flip would invalidate it — use staged regeneration + atomic flip`);
  }
  const after = contentState(topic, candidateGate.provenance);
  if (after.steps === "CURRENT" || after.questions.CURRENT > 0) throw new ReviewedAssignmentError("INVARIANT", `${topic.id}: existing content would classify CURRENT under the candidate`);

  return {
    topicId: topic.id,
    topicName: topic.nameEn,
    unitId: unit.id,
    enforcement: unit.contentProvenanceEnforcedAt ? "STRICT" : "TRANSITION",
    expectedRowHash: assignmentRowHash(old),
    old: {
      method: old.method, status: old.status, matchedConceptNames: old.matchedConceptNames, matchedHintTitles: old.matchedHintTitles,
      fingerprint: oldGate.state === "READY" ? oldGate.provenance.groundingAssignmentFingerprint : null,
      anchors: oldGate.state === "READY" ? [...new Set(groundingAnchorWords(oldGate.slice))] : [],
      slice: oldGate.state === "READY" ? summarize(oldGate.slice) : null,
    },
    candidate: { row, fingerprint: candidateGate.provenance.groundingAssignmentFingerprint, anchors: [...new Set(groundingAnchorWords(candidateGate.slice))], slice: summarize(candidateGate.slice) },
    references,
    content: { stepsBefore: before.steps, stepsAfter: after.steps === "NO_GATE" ? "NONE" : after.steps, questionsBefore: before.questions, questionsAfter: after.questions },
  };
}

export interface ReviewedApplyResult { topicId: string; fingerprint: string; method: string; previousMethod: string }

/**
 * ONE serializable transaction: re-plan from the live rows, require the exact
 * dry-run row hash and candidate fingerprint, compare-and-set the assignment
 * row, re-read and require the runtime gate to equal the candidate. Any
 * mismatch throws and rolls everything back.
 */
export async function applyReviewedAssignment(
  prisma: { $transaction: (fn: (tx: any) => Promise<ReviewedApplyResult>, opts?: any) => Promise<ReviewedApplyResult> },
  topicId: string,
  manifest: ReviewedManifest,
  expect: { rowHash: string; fingerprint: string },
): Promise<ReviewedApplyResult> {
  return prisma.$transaction(
    async (tx) => {
      const topic = await tx.topic.findUnique({ where: { id: topicId }, select: REVIEWED_TOPIC_SELECT });
      const plan = planReviewedAssignment(topic, manifest);
      if (plan.expectedRowHash !== expect.rowHash) throw new ReviewedAssignmentError("CAS_ROW_CHANGED", `${topicId}: assignment row changed since the dry-run`);
      if (plan.candidate.fingerprint !== expect.fingerprint) throw new ReviewedAssignmentError("CAS_CANDIDATE_CHANGED", `${topicId}: candidate fingerprint differs from the dry-run`);
      const old = topic.groundingAssignment;
      const { topicId: _t, ...data } = plan.candidate.row as any;
      const cas = await tx.topicGroundingAssignment.updateMany({
        where: { topicId, method: old.method, status: old.status, updatedAt: old.updatedAt, unitGroundingVersion: old.unitGroundingVersion, unitSourceFingerprint: old.unitSourceFingerprint },
        data,
      });
      if (cas.count !== 1) throw new ReviewedAssignmentError("CAS_CONFLICT", `${topicId}: live assignment changed concurrently`);
      const after = await tx.topic.findUnique({ where: { id: topicId }, select: REVIEWED_TOPIC_SELECT });
      const gate = evaluateTopicGroundingGate(after);
      if (after.groundingAssignment.method !== REVIEWED_METHOD || gate.state !== "READY" || gate.provenance.groundingAssignmentFingerprint !== expect.fingerprint) {
        throw new ReviewedAssignmentError("POSTCONDITION", `${topicId}: post-write gate does not equal the reviewed candidate`);
      }
      return { topicId, fingerprint: gate.provenance.groundingAssignmentFingerprint, method: REVIEWED_METHOD, previousMethod: old.method };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 },
  );
}
