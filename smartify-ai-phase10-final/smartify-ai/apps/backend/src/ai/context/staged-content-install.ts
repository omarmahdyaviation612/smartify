import { createHash } from "crypto";
import { Prisma } from "@smartify/database";
import { STAGED_POOL_TARGET, StagedRepairError, stageReplacement, validateStaged, type StageDeps, type StagedRepairPlan, type StagedReplacement } from "./staged-assignment-repair";
import {
  canServeTopicSteps,
  classifyContentProvenance,
  evaluateTopicGroundingGate,
  isActiveCurrentQuestion,
  isRetired,
  questionServabilityByTopic,
  QUESTION_PROVENANCE_SELECT,
  topicStepsProvenance,
  UNIT_GATE_SELECT,
  type TopicGroundingGate,
} from "./topic-content-provenance.util";
import { checkGroundingConsistency } from "./grounding-consistency-validator";
import { checkArithmeticConsistency } from "../../question-bank/question-draft-generator/arithmetic-consistency";
import { parseBilingualObjectives } from "../../interactive-lesson/lesson-draft-generator/lesson-objectives.util";
import { AUTO_LESSON_GENERATION_PROMPT_VERSION } from "../../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service";
import type { AutoLessonGenerationMetadata } from "../../interactive-lesson/lesson-draft-generator/lesson-publish.service";

/**
 * CONTENT-ONLY STAGED INSTALL (2026-10-04): a Topic whose assignment is
 * already READY / current / non-empty, but which has NO CURRENT content yet
 * (in a TRANSITION Unit it still serves LEGACY), gets one CURRENT lesson and
 * exactly 8 CURRENT Questions — staged off the serving path in the existing
 * draft tables, then installed in ONE serializable transaction.
 *
 * Why not normal regeneration: regenerate-topic-content publishes Questions
 * one transaction at a time, and a Topic stops serving LEGACY as soon as it
 * has one CURRENT Question, so it commits 1..7-CURRENT served pools. Why not
 * the staged assignment repair: that flips the assignment too. Here the
 * TopicGroundingAssignment is read, hashed and compare-checked, never written.
 *
 * Reuses the staged-repair primitives unchanged: stageReplacement (bounded
 * staged lesson + Question generation against an explicit gate, pending
 * drafts only), validateStaged (draft-level checks), and the production
 * installers (installAutoDraftIntoTopic / installAutoQuestionDraft). The
 * "candidate" those primitives expect is simply the Topic's CURRENT gate.
 *
 * Identity: --stage prints a hash over the assignment row, the gate
 * provenance, the Unit grounding identity, the live lesson baseline and the
 * full staged draft contents; --commit must present that exact hash, so only
 * reviewed content can be installed, and only onto an unchanged Topic.
 * LEGACY rows are never deleted or retired: after the install they are
 * excluded by the existing provenance precedence (a Topic with CURRENT
 * Questions does not serve its LEGACY ones).
 */

type ReadyGate = Extract<TopicGroundingGate, { state: "READY" }>;
const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x ?? null)).digest("hex");
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Everything the planner and the install read for one Topic. */
export const CONTENT_TOPIC_SELECT = {
  id: true,
  unitId: true,
  nameEn: true,
  teachingStepsJson: true,
  groundingSourceFingerprintUsed: true,
  groundingAssignmentFingerprintUsed: true,
  groundingAssignment: true,
  topicSourceEvidence: true,
  unit: { select: UNIT_GATE_SELECT },
  questions: { select: { id: true, topicId: true, isPlaceholder: true, ...QUESTION_PROVENANCE_SELECT } },
} as const;

export interface ContentPlan {
  topicId: string;
  unitId: string;
  unitMode: "STRICT" | "TRANSITION";
  gate: ReadyGate;
  assignmentHash: string;
  assignment: { method: string; status: string; updatedAt: string };
  unitIdentity: { groundingSourceFingerprint: string; groundingVersion: number };
  stepsBaseline: { hash: string; sourceFingerprintUsed: string | null; assignmentFingerprintUsed: string | null };
  content: { steps: string; current: number; legacy: number; mismatch: number; retired: number; servable: Record<string, number> };
}

/** The byte-level identity of the assignment row (every column; dates as ISO strings). */
export const assignmentRowHash = (row: unknown) => sha(row);

/** Pure: refuses unless the assignment is READY/current/non-empty and the Topic has no CURRENT content. */
export function planContentStaging(topic: any): ContentPlan {
  if (!topic) throw new StagedRepairError("NOT_FOUND", "Topic not found");
  if (!topic.unit || topic.unit.id !== topic.unitId) throw new StagedRepairError("UNIT", `${topic.id}: Topic/Unit relation mismatch`);
  if (!topic.groundingAssignment) throw new StagedRepairError("GATE", `${topic.id}: no assignment`);
  const gate = evaluateTopicGroundingGate(topic);
  if (gate.state !== "READY") throw new StagedRepairError("GATE", `${topic.id}: gate is not READY_CURRENT_NON_EMPTY (${gate.reason})`);
  const qs = topic.questions.filter((q: any) => !q.isPlaceholder);
  const cls = (x: any) => classifyContentProvenance(x, gate.provenance);
  const steps = Array.isArray(topic.teachingStepsJson) && topic.teachingStepsJson.length ? cls(topicStepsProvenance(topic)) : "NONE";
  const current = qs.filter((q: any) => isActiveCurrentQuestion(q, gate.provenance)).length;
  if (steps === "CURRENT" || current > 0) {
    throw new StagedRepairError("CURRENT_CONTENT_EXISTS", `${topic.id}: Topic already has CURRENT content (steps ${steps}, ${current} active CURRENT Questions) — use the CURRENT replacement tools instead`);
  }
  const servable = questionServabilityByTopic([topic], topic.questions);
  const a = topic.groundingAssignment;
  return {
    topicId: topic.id,
    unitId: topic.unit.id,
    unitMode: topic.unit.contentProvenanceEnforcedAt ? "STRICT" : "TRANSITION",
    gate,
    assignmentHash: assignmentRowHash(a),
    assignment: { method: a.method, status: a.status, updatedAt: new Date(a.updatedAt).toISOString() },
    unitIdentity: { groundingSourceFingerprint: topic.unit.groundingSourceFingerprint, groundingVersion: topic.unit.groundingVersion },
    stepsBaseline: { hash: sha(topic.teachingStepsJson ?? null), sourceFingerprintUsed: topic.groundingSourceFingerprintUsed ?? null, assignmentFingerprintUsed: topic.groundingAssignmentFingerprintUsed ?? null },
    content: {
      steps,
      current,
      legacy: qs.filter((q: any) => !isRetired(q) && cls(q) === "LEGACY").length,
      mismatch: qs.filter((q: any) => !isRetired(q) && cls(q) === "MISMATCH").length,
      retired: qs.filter((q: any) => isRetired(q)).length,
      servable: qs.filter(servable).reduce((m: Record<string, number>, q: any) => ((m[cls(q)] = (m[cls(q)] || 0) + 1), m), {}),
    },
  };
}

/** Adapter: the staged-repair primitives' "candidate" is this Topic's CURRENT, unchanged gate. */
export function asStagedPlan(plan: ContentPlan): StagedRepairPlan {
  return {
    topicId: plan.topicId,
    unitId: plan.unitId,
    unitMode: plan.unitMode,
    baseline: null as any,
    candidate: { assignment: null as any, gate: plan.gate },
    oldAssignmentFingerprint: plan.gate.provenance.groundingAssignmentFingerprint,
    candidateAssignmentFingerprint: plan.gate.provenance.groundingAssignmentFingerprint,
    oldSlice: null as any,
    candidateSlice: null as any,
    content: null as any,
  };
}

/** Provider work: one staged lesson + bounded staged Question batches (pending drafts only). */
export async function stageContent(plan: ContentPlan, deps: StageDeps): Promise<StagedReplacement> {
  return stageReplacement(asStagedPlan(plan), deps);
}

/** Lesson metadata the production installer stamps — fully determined by the unchanged gate and the deployed prompt version. */
export function lessonMetadataFor(plan: ContentPlan): AutoLessonGenerationMetadata {
  return { generationSource: "TEXTBOOK_GROUNDED", groundingVersionUsed: plan.unitIdentity.groundingVersion, generationPromptVersion: AUTO_LESSON_GENERATION_PROMPT_VERSION, provenance: plan.gate.provenance };
}

const draftIdentity = (d: any) => ({ id: d.id, topicId: d.topicId, type: d.type, difficulty: d.difficulty, promptEn: d.promptEn, promptAr: d.promptAr, optionsJson: d.optionsJson, correctAnswerJson: d.correctAnswerJson, explanationEn: d.explanationEn, explanationAr: d.explanationAr, groundingSourceFingerprint: d.groundingSourceFingerprint, groundingAssignmentFingerprint: d.groundingAssignmentFingerprint });

/** The staged identity --stage prints and --commit must present. */
export function stagedIdentity(plan: ContentPlan, lessonDraft: any, questionDrafts: any[]): string {
  return sha({
    topicId: plan.topicId,
    assignmentHash: plan.assignmentHash,
    provenance: plan.gate.provenance,
    unitIdentity: plan.unitIdentity,
    stepsBaseline: plan.stepsBaseline,
    lessonMetadata: lessonMetadataFor(plan),
    lesson: lessonDraft ? { id: lessonDraft.id, targetUnitId: lessonDraft.targetUnitId, teachingStepsJson: lessonDraft.teachingStepsJson, learningObjectivesJson: lessonDraft.learningObjectivesJson } : null,
    questions: [...questionDrafts].sort((a, b) => (a.id < b.id ? -1 : 1)).map(draftIdentity),
  });
}

/** Complete pre-commit validation (used before AND inside the install transaction). Empty = valid. */
export function validateStagedContent(plan: ContentPlan, lessonDraft: any, questionDrafts: any[]): string[] {
  const errors = validateStaged(asStagedPlan(plan), lessonDraft, questionDrafts);
  const slice = plan.gate.slice;
  if (lessonDraft && Array.isArray(lessonDraft.teachingStepsJson)) {
    const objectives = lessonDraft.teachingStepsJson.map((s: any) => s?.objective).filter((o: unknown) => typeof o === "string");
    for (const e of checkGroundingConsistency(objectives, slice)) errors.push(`lesson grounding: ${e}`);
  }
  const prompts = new Set<string>();
  for (const d of questionDrafts) {
    const key = norm(d.promptEn);
    if (prompts.has(key)) errors.push(`${d.id}: duplicate staged prompt`);
    prompts.add(key);
    const ar = checkArithmeticConsistency(d);
    if (ar.status === "INVALID") errors.push(`${d.id}: arithmetic INVALID: ${ar.findings.map((f) => f.code).join(",")}`);
  }
  const pool = questionDrafts.flatMap((d) => [d.promptEn, d.explanationEn].filter((t: unknown): t is string => typeof t === "string" && t.length > 0));
  for (const e of checkGroundingConsistency(pool, slice, { wordForms: true })) errors.push(`final pool grounding: ${e}`);
  return errors;
}

export interface ContentInstallers {
  installLesson(tx: any, draft: any, topicId: string, objectives: Array<{ objectiveEn: string; objectiveAr?: string | null }>, metadata: AutoLessonGenerationMetadata): Promise<{ lesson: { id: string } }>;
  installQuestion(tx: any, draft: any): Promise<{ id: string }>;
}

export interface ContentInstallResult {
  topicId: string;
  lessonId: string;
  questionIds: string[];
  currentServableQuestions: number;
  assignmentHashBefore: string;
  assignmentHashAfter: string;
  fingerprint: string;
}

/** Pure post-condition on a (transaction-local or fresh) read of the Topic. Empty = holds. */
export function verifyInstalled(topic: any, plan: ContentPlan, questionIds: string[]): string[] {
  const errors: string[] = [];
  if (!topic) return ["Topic vanished"];
  if (assignmentRowHash(topic.groundingAssignment) !== plan.assignmentHash) errors.push("assignment row changed");
  const gate = evaluateTopicGroundingGate(topic);
  if (gate.state !== "READY" || gate.provenance.groundingAssignmentFingerprint !== plan.gate.provenance.groundingAssignmentFingerprint || gate.provenance.groundingSourceFingerprint !== plan.gate.provenance.groundingSourceFingerprint) {
    errors.push("gate provenance changed");
    return errors;
  }
  if (classifyContentProvenance(topicStepsProvenance(topic), gate.provenance) !== "CURRENT" || !canServeTopicSteps(topic)) errors.push("lesson steps are not CURRENT and servable");
  const servable = questionServabilityByTopic([topic], topic.questions);
  const served = topic.questions.filter(servable);
  if (served.length !== STAGED_POOL_TARGET || served.some((q: any) => classifyContentProvenance(q, gate.provenance) !== "CURRENT")) {
    errors.push(`servable pool is ${served.length} (${JSON.stringify(served.map((q: any) => classifyContentProvenance(q, gate.provenance)))}), expected exactly ${STAGED_POOL_TARGET} CURRENT`);
  }
  if (JSON.stringify(served.map((q: any) => q.id).sort()) !== JSON.stringify([...questionIds].sort())) errors.push("servable pool is not exactly the installed Questions");
  if ((topic.unit.contentProvenanceEnforcedAt ? "STRICT" : "TRANSITION") !== plan.unitMode) errors.push("Unit enforcement mode changed");
  return errors;
}

/**
 * ONE serializable transaction: re-plan from live rows (gate READY, still no
 * CURRENT content), compare the assignment row / gate / Unit identity / live
 * lesson baseline with the staged plan, re-check the staged identity and
 * every validation, install the lesson and all 8 Questions, then require the
 * post-condition. Any failure rolls everything back.
 */
export async function installStagedContent(
  prisma: { $transaction: (fn: (tx: any) => Promise<ContentInstallResult>, opts?: any) => Promise<ContentInstallResult> },
  plan: ContentPlan,
  staged: { lessonDraftId: string; questionDraftIds: string[]; identity: string },
  installers: ContentInstallers,
): Promise<ContentInstallResult> {
  return prisma.$transaction(
    async (tx) => {
      const live = await tx.topic.findUnique({ where: { id: plan.topicId }, select: CONTENT_TOPIC_SELECT });
      const now = planContentStaging(live); // gate READY + still no CURRENT content
      if (now.assignmentHash !== plan.assignmentHash) throw new StagedRepairError("CAS_ASSIGNMENT", `${plan.topicId}: assignment row changed since staging`);
      if (now.gate.provenance.groundingAssignmentFingerprint !== plan.gate.provenance.groundingAssignmentFingerprint || now.gate.provenance.groundingSourceFingerprint !== plan.gate.provenance.groundingSourceFingerprint) {
        throw new StagedRepairError("CAS_PROVENANCE", `${plan.topicId}: grounding provenance changed since staging`);
      }
      if (JSON.stringify(now.unitIdentity) !== JSON.stringify(plan.unitIdentity)) throw new StagedRepairError("CAS_GROUNDING", `${plan.topicId}: Unit grounding identity changed since staging`);
      if (JSON.stringify(now.stepsBaseline) !== JSON.stringify(plan.stepsBaseline)) throw new StagedRepairError("CAS_LESSON", `${plan.topicId}: live lesson changed since staging`);
      if (now.unitMode !== plan.unitMode) throw new StagedRepairError("CAS_MODE", `${plan.topicId}: Unit enforcement mode changed since staging`);

      const lessonDraft = await tx.lessonDraft.findUnique({ where: { id: staged.lessonDraftId } });
      const questionDrafts = await tx.questionDraft.findMany({ where: { id: { in: staged.questionDraftIds } }, orderBy: { id: "asc" } });
      if (questionDrafts.length !== staged.questionDraftIds.length) throw new StagedRepairError("STAGED_MISSING", `${plan.topicId}: staged QuestionDrafts missing`);
      if (stagedIdentity(plan, lessonDraft, questionDrafts) !== staged.identity) throw new StagedRepairError("STAGED_IDENTITY", `${plan.topicId}: staged content or the Topic baseline it was staged against (assignment row, provenance, grounding identity, live lesson) does not match the reviewed identity`);
      const errors = validateStagedContent(plan, lessonDraft, questionDrafts);
      if (errors.length) throw new StagedRepairError("STAGED_INVALID", `${plan.topicId}: staged content invalid`, errors);

      const installed = await installers.installLesson(tx, lessonDraft, plan.topicId, parseBilingualObjectives(lessonDraft.learningObjectivesJson), lessonMetadataFor(plan));
      const questionIds: string[] = [];
      for (const d of questionDrafts) questionIds.push((await installers.installQuestion(tx, d)).id);

      const after = await tx.topic.findUnique({ where: { id: plan.topicId }, select: CONTENT_TOPIC_SELECT });
      const post = verifyInstalled(after, plan, questionIds);
      if (post.length) throw new StagedRepairError("POSTCONDITION", `${plan.topicId}: post-install state invalid`, post);
      return { topicId: plan.topicId, lessonId: installed.lesson.id, questionIds, currentServableQuestions: STAGED_POOL_TARGET, assignmentHashBefore: plan.assignmentHash, assignmentHashAfter: assignmentRowHash(after.groundingAssignment), fingerprint: plan.gate.provenance.groundingAssignmentFingerprint };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 },
  );
}

/**
 * SURGICAL QUESTION RE-STAGE (2026-10-04): keep an already-staged LessonDraft
 * and the good QuestionDrafts of an earlier --stage, reject explicitly listed
 * bad QuestionDrafts, and generate only the missing count so the staged pool is
 * exactly 8 again. Everything except the Question generation is reused:
 * stageReplacement (existing lesson + reuseQuestionDraftIds -> acceptedPool),
 * validateStaged / validateStagedContent (final 8 judged together),
 * stagedIdentity (fresh identity), and the unchanged installer for commit.
 *
 * Provenance of the kept lesson: a LessonDraft stores no provenance, so the
 * caller must present the PREVIOUS staged identity. It is recomputed from the
 * current plan over the kept lesson and the full original set (keep + reject);
 * a match proves the lesson and every draft were staged against exactly this
 * assignment row, gate, grounding identity, live-lesson baseline and deployed
 * prompt version, and that none of them has been edited since.
 */
export interface SurgicalSpec { topicId: string; lessonDraftId: string; keepQuestionDraftIds: string[]; rejectQuestionDraftIds: string[]; previousIdentity: string }

/** Pure preflight. Every check happens before any rejection or provider call. Throws StagedRepairError on refusal. */
export function planSurgicalRestage(
  topic: any,
  spec: SurgicalSpec,
  rows: { lessonDraft: any; drafts: any[]; pendingQuestionDraftIds: string[]; pendingLessonDraftIds: string[]; activity: number },
): { plan: ContentPlan; objectivesEn: string[] } {
  const plan = planContentStaging(topic); // gate READY + no CURRENT content
  const { keepQuestionDraftIds: keep, rejectQuestionDraftIds: reject } = spec;
  if (!keep.length || !reject.length) throw new StagedRepairError("SPEC", `${spec.topicId}: at least one keep and one reject draft are required`);
  if (keep.some((id) => reject.includes(id))) throw new StagedRepairError("SPEC", `${spec.topicId}: a draft is listed both to keep and to reject`);
  if (new Set([...keep, ...reject]).size !== keep.length + reject.length) throw new StagedRepairError("SPEC", `${spec.topicId}: duplicate draft ids`);
  if (keep.length + reject.length !== STAGED_POOL_TARGET) throw new StagedRepairError("SPEC", `${spec.topicId}: keep + reject must be the full original staged set of ${STAGED_POOL_TARGET}`);
  if (rows.activity !== 0) throw new StagedRepairError("ACTIVITY", `${spec.topicId}: Topic has ${rows.activity} student activity row(s)`);
  const original = [...keep, ...reject];
  const byId = new Map(rows.drafts.map((d) => [d.id, d]));
  const missing = original.filter((id) => !byId.has(id));
  if (missing.length) throw new StagedRepairError("DRAFT_MISSING", `${spec.topicId}: drafts not found`, missing);
  const originalDrafts = original.map((id) => byId.get(id));
  // The full original set must still be exactly the reviewed one (pending, unpublished, this provenance, individually valid, unedited).
  const errors = validateStaged(asStagedPlan(plan), rows.lessonDraft, originalDrafts);
  if (errors.length) throw new StagedRepairError("ORIGINAL_SET_INVALID", `${spec.topicId}: the original staged set is not intact`, errors);
  if (stagedIdentity(plan, rows.lessonDraft, originalDrafts) !== spec.previousIdentity) {
    throw new StagedRepairError("PREVIOUS_IDENTITY", `${spec.topicId}: the original staged set (lesson + ${STAGED_POOL_TARGET} drafts) or the Topic baseline changed since it was staged`);
  }
  const keptPrompts = keep.map((id) => norm(byId.get(id).promptEn));
  if (new Set(keptPrompts).size !== keptPrompts.length) throw new StagedRepairError("KEEP_DUPLICATE", `${spec.topicId}: kept drafts duplicate each other`);
  const extraQ = rows.pendingQuestionDraftIds.filter((id) => !original.includes(id));
  const extraL = rows.pendingLessonDraftIds.filter((id) => id !== spec.lessonDraftId);
  if (extraQ.length || extraL.length) throw new StagedRepairError("STAGED_LEFTOVERS_PRESENT", `${spec.topicId}: other pending drafts exist for this Topic/Unit; nothing is touched`, { questionDrafts: extraQ, lessonDrafts: extraL });
  return { plan, objectivesEn: parseBilingualObjectives(rows.lessonDraft.learningObjectivesJson).map((o) => o.objectiveEn) };
}

/**
 * Rejects the listed drafts (only after planSurgicalRestage passed), then stages the missing count with the
 * kept lesson and kept drafts as the accepted pool. Never touches serving content; a later failure leaves the
 * rejected drafts rejected (audit history), the kept drafts pending, and any partial new drafts non-servable.
 */
export async function surgicalRestage(
  plan: ContentPlan,
  spec: SurgicalSpec,
  objectivesEn: string[],
  deps: StageDeps & { rejectQuestionDraft(id: string, reason: string): Promise<unknown> },
): Promise<StagedReplacement> {
  for (const id of spec.rejectQuestionDraftIds) await deps.rejectQuestionDraft(id, `Surgical re-stage: rejected after manual review of staged identity ${spec.previousIdentity.slice(0, 16)}; replaced by a newly staged Question.`);
  return stageReplacement(asStagedPlan(plan), deps, {
    reuseQuestionDraftIds: spec.keepQuestionDraftIds,
    existingLesson: { draftId: spec.lessonDraftId, objectivesEn, metadata: lessonMetadataFor(plan) },
  });
}
