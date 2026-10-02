import { createHash } from "crypto";
import { Prisma } from "@smartify/database";
import { planReassignment, type ReassignTopic } from "../../scripts/reassign-sole-topic-assignment";
import { DETERMINISTIC_ASSIGNMENT_VERSION } from "./topic-grounding-assignment.util";
import type { DeterministicAssignment } from "./topic-grounding-assignment.service";
import {
  canServeTopicSteps,
  classifyContentProvenance,
  evaluateTopicGroundingGate,
  questionServabilityByTopic,
  topicStepsProvenance,
  type TopicContentProvenance,
  type TopicGroundingGate,
} from "./topic-content-provenance.util";
import { validateQuestionDraft } from "../../question-bank/question-draft-generator/question-draft-validator";
import { installAutoQuestionDraft } from "../../question-bank/question-draft-generator/question-publish.service";
import { installAutoDraftIntoTopic, type AutoLessonGenerationMetadata } from "../../interactive-lesson/lesson-draft-generator/lesson-publish.service";
import { allObjectivesReviewed, parseBilingualObjectives } from "../../interactive-lesson/lesson-draft-generator/lesson-objectives.util";

/**
 * STAGED REGENERATION + ATOMIC ASSIGNMENT FLIP (2026-10-03).
 *
 * Replaces a Topic's assignment AND its downstream content without any
 * externally visible intermediate state. Students only ever see either
 *   (old live assignment + old CURRENT content)  — before the commit, or
 *   (new live assignment + new CURRENT content)  — after it.
 *
 * Staging: the replacement lesson and Questions are generated against the
 * CANDIDATE assignment's slice (computed in memory, never written) and held
 * ONLY in the existing draft tables — a `pending_review` LessonDraft and
 * `pending_review` QuestionDrafts. Nothing student-facing queries either table,
 * so staged content is never served or counted before the flip (and the old
 * CURRENT pool keeps the lazy top-up satisfied). No new schema.
 *
 * Flip: ONE serializable transaction re-checks every baseline assumption
 * (Unit grounding identity, sole-Topic Unit, live content unchanged, the
 * exact assignment row via compare-and-set), installs the staged lesson and
 * Questions with the same install code the normal auto-publish paths use, and
 * verifies the post-state (new CURRENT steps + exactly 8 CURRENT servable
 * Questions under the new assignment) before committing. Any failure rolls
 * back everything. Old Questions/drafts are never modified or deleted.
 */

export const STAGED_POOL_TARGET = 8;
// Same bound as the generators' own MAX_ATTEMPTS: at most two staged batches.
export const MAX_STAGED_QUESTION_BATCHES = 2;

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x ?? null)).digest("hex");

export class StagedRepairError extends Error {
  constructor(readonly code: string, message: string, readonly detail?: unknown) {
    super(`${code}: ${message}`);
    this.name = "StagedRepairError";
  }
}

export type RepairTopic = ReassignTopic & {
  teachingStepsJson: unknown;
  groundingSourceFingerprintUsed: string | null;
  groundingAssignmentFingerprintUsed: string | null;
  questions: Array<{ topicId: string; isPlaceholder?: boolean; groundingSourceFingerprint: string | null; groundingAssignmentFingerprint: string | null }>;
  unit: ReassignTopic["unit"] & { contentProvenanceEnforcedAt: Date | null };
};

type ReadyGate = Extract<TopicGroundingGate, { state: "READY" }>;

export interface StagedRepairPlan {
  topicId: string;
  unitId: string;
  unitMode: "STRICT" | "TRANSITION";
  baseline: {
    assignment: { method: string; updatedAt: Date; unitSourceFingerprint: string; unitGroundingVersion: number; assignmentVersion: number; status: string };
    unitFingerprint: string;
    unitGroundingVersion: number;
    stepsHash: string;
    stepsSourceFingerprintUsed: string | null;
    stepsAssignmentFingerprintUsed: string | null;
  };
  candidate: { assignment: DeterministicAssignment; gate: ReadyGate };
  oldAssignmentFingerprint: string;
  candidateAssignmentFingerprint: string;
  oldSlice: { concepts: number; facts: number; vocabulary: number };
  candidateSlice: { concepts: number; facts: number; vocabulary: number };
  content: { steps: string; currentQuestions: number; legacyQuestions: number; mismatchQuestions: number };
}

/** Pure: everything the repair needs, decided from live state. Throws on any ineligibility. */
export function planStagedRepair(topic: RepairTopic, scopeUnitIds: ReadonlySet<string>): StagedRepairPlan {
  if (!scopeUnitIds.has(topic.unit.id)) throw new StagedRepairError("OUT_OF_SCOPE", `${topic.id}: Unit ${topic.unit.id} is outside this repair's scope`);
  const reassign = planReassignment(topic); // sole-Topic, READY, identity-valid, narrowing method, current version, whole-Unit result
  const a = topic.groundingAssignment;
  const oldGate = evaluateTopicGroundingGate(topic as any);
  const candidateRow = { ...a, method: reassign.next.method, matchedConceptNames: reassign.next.matchedConceptNames, matchedHintTitles: reassign.next.matchedHintTitles, mapperPromptVersion: null, assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION };
  const gate = evaluateTopicGroundingGate({ ...topic, groundingAssignment: candidateRow } as any);
  if (oldGate.state !== "READY" || gate.state !== "READY") throw new StagedRepairError("GATE", `${topic.id}: old or candidate gate not READY`);
  const qs = topic.questions.filter((q) => !q.isPlaceholder);
  const cls = (x: any) => classifyContentProvenance(x, oldGate.provenance);
  return {
    topicId: topic.id,
    unitId: topic.unit.id,
    unitMode: topic.unit.contentProvenanceEnforcedAt ? "STRICT" : "TRANSITION",
    baseline: {
      assignment: { method: a.method, updatedAt: a.updatedAt, unitSourceFingerprint: a.unitSourceFingerprint, unitGroundingVersion: a.unitGroundingVersion, assignmentVersion: a.assignmentVersion, status: a.status },
      unitFingerprint: topic.unit.groundingSourceFingerprint!,
      unitGroundingVersion: topic.unit.groundingVersion!,
      stepsHash: sha(topic.teachingStepsJson),
      stepsSourceFingerprintUsed: topic.groundingSourceFingerprintUsed,
      stepsAssignmentFingerprintUsed: topic.groundingAssignmentFingerprintUsed,
    },
    candidate: { assignment: reassign.next, gate },
    oldAssignmentFingerprint: reassign.oldAssignmentFingerprint,
    candidateAssignmentFingerprint: gate.provenance.groundingAssignmentFingerprint,
    oldSlice: reassign.oldSlice,
    candidateSlice: reassign.newSlice,
    content: {
      steps: topic.teachingStepsJson ? cls(topicStepsProvenance(topic)) : "NONE",
      currentQuestions: qs.filter((q) => cls(q) === "CURRENT").length,
      legacyQuestions: qs.filter((q) => cls(q) === "LEGACY").length,
      mismatchQuestions: qs.filter((q) => cls(q) === "MISMATCH").length,
    },
  };
}

/** A staged replacement: rows in the non-student-visible draft tables only. */
export interface StagedReplacement {
  lessonDraftId: string;
  lessonMetadata: AutoLessonGenerationMetadata;
  questionDraftIds: string[];
  questionBatches: number;
  batchErrors: string[];
}

export interface StageDeps {
  /** Generates + persists a pending_review LessonDraft against `gate` (normal accounting). */
  generateLesson(topicId: string, gate: ReadyGate): Promise<{ draftId: string; objectivesEn: string[]; metadata: AutoLessonGenerationMetadata }>;
  /**
   * Generates + persists at most `count` pending_review QuestionDrafts against `gate` (normal validation/accounting).
   * `acceptedPoolPrompts`: prompts of the Questions already accepted into THIS staged pool — grounding
   * consistency is judged on the final candidate pool (see generateAutoQuestionBatch's `staged`).
   */
  generateQuestions(topicId: string, count: number, gate: ReadyGate, lessonObjectives: string[], acceptedPoolPrompts: string[]): Promise<string[]>;
  /** Re-reads staged drafts by id. */
  loadQuestionDrafts(ids: string[]): Promise<any[]>;
}

const stagedForCandidate = (d: any, topicId: string, prov: TopicContentProvenance) =>
  d.topicId === topicId && d.status === "pending_review" && !d.publishedQuestionId && d.groundingSourceFingerprint === prov.groundingSourceFingerprint && d.groundingAssignmentFingerprint === prov.groundingAssignmentFingerprint;

/** A staged draft that may count toward THIS plan's pool: same Topic, candidate provenance, unpublished, individually valid. */
const acceptableStaged = (d: any, plan: StagedRepairPlan) =>
  stagedForCandidate(d, plan.topicId, plan.candidate.gate.provenance) && validateQuestionDraft(d, { topicExists: true, topicIsPlaceholder: false, requireReviewedContent: true }).valid;

export interface StagedLeftovers {
  /** Pending staged QuestionDrafts provably belonging to THIS candidate (reusable). */
  reusableQuestionDraftIds: string[];
  /** Pending, unpublished LessonDrafts for this Unit. Never reusable: LessonDraft stores no provenance, so membership in this candidate cannot be proven. */
  pendingLessonDraftIds: string[];
  /** Anything that makes reuse unsafe — reported, never reused or deleted. */
  ambiguous: string[];
}

/**
 * Pure: classifies leftover staged rows from an earlier, failed staging run of
 * the SAME repair. Only pending, unpublished, individually valid QuestionDrafts
 * of this Topic stamped with exactly this plan's candidate provenance are
 * reusable. Any other pending draft for the Topic (another candidate, no
 * provenance, invalid), duplicates, or more than the target count make the
 * leftovers ambiguous.
 */
export function discoverStagedLeftovers(plan: StagedRepairPlan, pendingQuestionDrafts: any[], pendingLessonDrafts: any[]): StagedLeftovers {
  const ambiguous: string[] = [];
  const reusable: any[] = [];
  for (const d of pendingQuestionDrafts) {
    if (d.topicId !== plan.topicId || d.status !== "pending_review" || d.publishedQuestionId) continue;
    if (acceptableStaged(d, plan)) reusable.push(d);
    else ambiguous.push(`${d.id}: pending draft for this Topic that does not belong to this candidate or fails validation`);
  }
  const prompts = new Set<string>();
  for (const d of reusable) {
    if (prompts.has(d.promptEn)) ambiguous.push(`${d.id}: duplicate staged prompt`);
    prompts.add(d.promptEn);
  }
  if (reusable.length > STAGED_POOL_TARGET) ambiguous.push(`${reusable.length} reusable staged drafts exceed the target ${STAGED_POOL_TARGET}`);
  return {
    reusableQuestionDraftIds: reusable.map((d) => d.id).sort(),
    pendingLessonDraftIds: pendingLessonDrafts.filter((l) => l.targetUnitId === plan.unitId && l.status === "pending_review" && !l.publishedTopicId).map((l) => l.id).sort(),
    ambiguous,
  };
}

/** Provider work happens HERE, before any live write. Failures leave live state untouched (staged drafts stay non-servable). */
export async function stageReplacement(plan: StagedRepairPlan, deps: StageDeps, opts: { reuseQuestionDraftIds?: string[] } = {}): Promise<StagedReplacement> {
  const gate = plan.candidate.gate;
  // Reused staged Questions are re-validated here, never trusted blindly.
  const reuse = opts.reuseQuestionDraftIds ?? [];
  if (reuse.length > STAGED_POOL_TARGET) throw new StagedRepairError("STAGED_REUSE", `${plan.topicId}: ${reuse.length} reusable drafts exceed the target`);
  const reusedRows = reuse.length ? await deps.loadQuestionDrafts(reuse) : [];
  if (reusedRows.length !== reuse.length || !reusedRows.every((d) => acceptableStaged(d, plan))) {
    throw new StagedRepairError("STAGED_REUSE", `${plan.topicId}: a reused staged draft is not a valid pending draft of this candidate`);
  }
  const lesson = await deps.generateLesson(plan.topicId, gate);
  if (lesson.metadata.provenance?.groundingAssignmentFingerprint !== plan.candidateAssignmentFingerprint) {
    throw new StagedRepairError("STAGED_PROVENANCE", `${plan.topicId}: staged lesson not stamped with the candidate assignment`);
  }
  const ids: string[] = [...reuse];
  const batchErrors: string[] = [];
  let batches = 0;
  while (ids.length < STAGED_POOL_TARGET && batches < MAX_STAGED_QUESTION_BATCHES) {
    batches++;
    // The pool accepted so far — ONLY this plan's valid staged drafts (never live, LEGACY, MISMATCH or foreign rows).
    const accepted = (await deps.loadQuestionDrafts(ids)).filter((d) => acceptableStaged(d, plan));
    try {
      const created = await deps.generateQuestions(plan.topicId, STAGED_POOL_TARGET - ids.length, gate, lesson.objectivesEn, accepted.map((d) => d.promptEn));
      ids.push(...created);
    } catch (err) {
      batchErrors.push(err instanceof Error ? err.message : String(err));
    }
    // Re-read: only drafts genuinely persisted for this Topic with the candidate provenance count.
    const drafts = await deps.loadQuestionDrafts(ids);
    const valid = new Set(drafts.filter((d) => stagedForCandidate(d, plan.topicId, gate.provenance)).map((d) => d.id));
    for (let i = ids.length - 1; i >= 0; i--) if (!valid.has(ids[i])) ids.splice(i, 1);
  }
  if (ids.length < STAGED_POOL_TARGET) {
    throw new StagedRepairError("STAGED_INCOMPLETE", `${plan.topicId}: only ${ids.length}/${STAGED_POOL_TARGET} staged Questions after ${batches} bounded batch(es)`, { lessonDraftId: lesson.draftId, questionDraftIds: ids, batchErrors });
  }
  return { lessonDraftId: lesson.draftId, lessonMetadata: lesson.metadata, questionDraftIds: ids.slice(0, STAGED_POOL_TARGET), questionBatches: batches, batchErrors };
}

/** Pure validation of the complete staged replacement — used before AND inside the flip transaction. */
export function validateStaged(plan: StagedRepairPlan, lessonDraft: any, questionDrafts: any[]): string[] {
  const errors: string[] = [];
  const prov = plan.candidate.gate.provenance;
  if (!lessonDraft) errors.push("staged LessonDraft missing");
  else {
    if (lessonDraft.status !== "pending_review" || lessonDraft.publishedTopicId) errors.push("staged LessonDraft is not an unpublished pending_review draft");
    if (lessonDraft.targetUnitId !== plan.unitId) errors.push("staged LessonDraft targets another Unit");
    if (!Array.isArray(lessonDraft.teachingStepsJson) || lessonDraft.teachingStepsJson.length === 0) errors.push("staged LessonDraft has no teaching steps");
    if (!allObjectivesReviewed(parseBilingualObjectives(lessonDraft.learningObjectivesJson))) errors.push("staged LessonDraft objectives are not fully bilingual");
  }
  if (questionDrafts.length !== STAGED_POOL_TARGET) errors.push(`expected exactly ${STAGED_POOL_TARGET} staged QuestionDrafts, found ${questionDrafts.length}`);
  for (const d of questionDrafts) {
    if (!stagedForCandidate(d, plan.topicId, prov)) errors.push(`${d.id}: not an unpublished staged draft with the candidate provenance`);
    const v = validateQuestionDraft(d, { topicExists: true, topicIsPlaceholder: false, requireReviewedContent: true });
    if (!v.valid) errors.push(`${d.id}: ${v.errors.join("; ")}`);
  }
  return errors;
}

export interface FlipResult {
  newAssignmentFingerprint: string;
  lessonId: string;
  questionIds: string[];
  currentServableQuestions: number;
}

/**
 * The single atomic flip. Serializable isolation: a concurrent write to any
 * row read here aborts the transaction instead of committing a mixed state.
 */
export async function flipStagedReplacement(prisma: { $transaction: (fn: (tx: any) => Promise<FlipResult>, opts?: any) => Promise<FlipResult> }, plan: StagedRepairPlan, staged: StagedReplacement): Promise<FlipResult> {
  const b = plan.baseline;
  const prov = plan.candidate.gate.provenance;
  return prisma.$transaction(
    async (tx) => {
      const unit = await tx.unit.findUnique({ where: { id: plan.unitId }, select: { id: true, groundingVersion: true, groundingSourceFingerprint: true, groundingNotesJson: true, contentProvenanceEnforcedAt: true, topics: { select: { id: true } } } });
      if (!unit || unit.groundingSourceFingerprint !== b.unitFingerprint || unit.groundingVersion !== b.unitGroundingVersion) throw new StagedRepairError("PRECONDITION_GROUNDING", `${plan.topicId}: Unit grounding identity changed since preflight`);
      if (unit.topics.length !== 1 || unit.topics[0].id !== plan.topicId) throw new StagedRepairError("PRECONDITION_NOT_SOLE", `${plan.topicId}: Topic is no longer the sole Topic of its Unit`);
      const live = await tx.topic.findUnique({ where: { id: plan.topicId }, select: { unitId: true, teachingStepsJson: true, groundingSourceFingerprintUsed: true, groundingAssignmentFingerprintUsed: true } });
      if (!live || live.unitId !== plan.unitId) throw new StagedRepairError("PRECONDITION_TOPIC", `${plan.topicId}: Topic/Unit identity changed`);
      if (sha(live.teachingStepsJson) !== b.stepsHash || live.groundingSourceFingerprintUsed !== b.stepsSourceFingerprintUsed || live.groundingAssignmentFingerprintUsed !== b.stepsAssignmentFingerprintUsed) {
        throw new StagedRepairError("PRECONDITION_CONTENT", `${plan.topicId}: live lesson changed since preflight`);
      }
      const next = plan.candidate.assignment;
      const cas = await tx.topicGroundingAssignment.updateMany({
        where: { topicId: plan.topicId, method: b.assignment.method, updatedAt: b.assignment.updatedAt, unitSourceFingerprint: b.assignment.unitSourceFingerprint, unitGroundingVersion: b.assignment.unitGroundingVersion, assignmentVersion: b.assignment.assignmentVersion, status: b.assignment.status },
        data: { method: next.method, confidence: next.confidence, status: "READY", assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION, matchedConceptNames: next.matchedConceptNames, matchedHintTitles: (next.matchedHintTitles ?? null) as any, mapperModel: null, mapperPromptVersion: null, reason: next.reason },
      });
      if (cas.count !== 1) throw new StagedRepairError("CAS_CONFLICT", `${plan.topicId}: live assignment changed since preflight`);

      const lessonDraft = await tx.lessonDraft.findUnique({ where: { id: staged.lessonDraftId } });
      const questionDrafts = await tx.questionDraft.findMany({ where: { id: { in: staged.questionDraftIds } }, orderBy: { id: "asc" } });
      const errors = validateStaged(plan, lessonDraft, questionDrafts);
      if (errors.length) throw new StagedRepairError("STAGED_INVALID", `${plan.topicId}: staged replacement invalid`, errors);

      const installed = await installAutoDraftIntoTopic(tx, lessonDraft, plan.topicId, parseBilingualObjectives(lessonDraft.learningObjectivesJson), { ...staged.lessonMetadata, provenance: prov });
      const questionIds: string[] = [];
      for (const d of questionDrafts) questionIds.push((await installAutoQuestionDraft(tx, d)).id);

      // Post-condition BEFORE commit: the runtime gate, evaluated on the
      // transaction's own view, must see the new state as fully CURRENT.
      const after = await tx.topic.findUnique({
        where: { id: plan.topicId },
        select: { id: true, teachingStepsJson: true, groundingSourceFingerprintUsed: true, groundingAssignmentFingerprintUsed: true, groundingAssignment: true, topicSourceEvidence: true, questions: { select: { topicId: true, isPlaceholder: true, groundingSourceFingerprint: true, groundingAssignmentFingerprint: true } } },
      });
      const gateAfter = evaluateTopicGroundingGate({ ...after, unit } as any);
      if (gateAfter.state !== "READY" || gateAfter.provenance.groundingAssignmentFingerprint !== plan.candidateAssignmentFingerprint || gateAfter.provenance.groundingSourceFingerprint !== prov.groundingSourceFingerprint) {
        throw new StagedRepairError("POSTCONDITION", `${plan.topicId}: post-commit gate does not equal the candidate`);
      }
      if (!canServeTopicSteps({ ...after, unit } as any)) throw new StagedRepairError("POSTCONDITION", `${plan.topicId}: new steps would not be servable`);
      const servable = questionServabilityByTopic([{ ...after, unit } as any], after.questions);
      const currentServable = after.questions.filter((q: any) => servable(q) && classifyContentProvenance(q, gateAfter.provenance) === "CURRENT").length;
      const anyNonCurrentServable = after.questions.some((q: any) => servable(q) && classifyContentProvenance(q, gateAfter.provenance) !== "CURRENT");
      if (currentServable !== STAGED_POOL_TARGET || anyNonCurrentServable) throw new StagedRepairError("POSTCONDITION", `${plan.topicId}: servable pool would be ${currentServable} CURRENT (non-CURRENT servable: ${anyNonCurrentServable})`);
      return { newAssignmentFingerprint: gateAfter.provenance.groundingAssignmentFingerprint, lessonId: installed.lesson.id, questionIds, currentServableQuestions: currentServable };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 },
  );
}
