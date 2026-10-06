import {
  canServeTopicSteps,
  classifyContentProvenance,
  enforcementForUnit,
  evaluateTopicGroundingGate,
  isRetired,
  questionServabilityByTopic,
  topicStepsProvenance,
  type ContentProvenanceState,
  type GateTopic,
  type GateUnit,
  type PoolQuestion,
  type ProvenanceEnforcement,
  type TopicStepsProvenanceFields,
} from "./topic-content-provenance.util";

/**
 * Read-only Unit content-readiness classification for the Wave B preparation
 * planner (2026-10-03, planner historical-MISMATCH fix).
 *
 * WHY: the first planner counted every stored MISMATCH Question as an
 * integrity issue, so a STRICT Unit whose only Topic serves exactly 8 CURRENT
 * Questions was reported INVALID_STATE just because the 8 Questions generated
 * under its earlier (narrow) assignment are still stored. Those rows are
 * never served (MISMATCH is refused in every mode) and are intentionally kept
 * as history. Readiness is therefore decided by what the student runtime
 * would actually serve — the SAME production functions (gate,
 * canServeTopicSteps, questionServabilityByTopic) — and stored rows the
 * runtime excludes are reported as HISTORICAL_NON_SERVABLE, never as issues.
 *
 * Real readiness/provenance failures stay INVALID_STATE: a non-BLOCKED
 * unavailable assignment (STALE / EMPTY / MISSING), a grounding identity that
 * is not canonical for the Unit's range, a MISMATCH lesson (a Topic has one
 * active lesson), a CURRENT lesson with no steps, a mixed or non-CURRENT
 * servable pool, a STRICT Topic that would need a lazy lesson or a Question
 * top-up, and student activity on READY content. TRANSITION Units keep the
 * original semantics: any stored MISMATCH Question blocks preparation, because
 * the preparation path refuses such Topics.
 *
 * Pure — never a query, never a provider call, never a write.
 */

/** Runtime pool target: QuestionDraftGeneratorService DEFAULT_POOL_TARGET / enforce-content-provenance POOL_TARGET. */
export const READINESS_POOL_TARGET = 8;

export type UnitReadinessClass = "ALREADY_STRICT" | "ALREADY_READY_FOR_STRICT" | "NEEDS_PREPARATION" | "INVALID_STATE";

export type ReadinessQuestion = PoolQuestion & { attempts?: number };

export interface ReadinessTopic extends TopicStepsProvenanceFields {
  id: string;
  teachingStepsJson: unknown;
  groundingAssignment?: GateTopic["groundingAssignment"];
  topicSourceEvidence?: GateTopic["topicSourceEvidence"];
  questions: ReadinessQuestion[];
  /** Student activity on this Topic (sessions, quiz results, attempts, lesson progress). */
  activity?: number;
}

export interface ReadinessUnit extends GateUnit {
  topics: ReadinessTopic[];
}

type StateCounts = Partial<Record<ContentProvenanceState, number>>;

export interface TopicReadiness {
  topicId: string;
  gate: "READY" | "MISSING" | "STALE" | "BLOCKED" | "EMPTY";
  steps: ContentProvenanceState | "NONE" | null;
  stepsServable: boolean;
  stored: StateCounts;
  servable: StateCounts;
  historicalNonServable: StateCounts;
  lazyLessonRequired: boolean;
  topUpRequired: boolean;
}

export interface UnitReadiness {
  unitId: string;
  mode: ProvenanceEnforcement;
  class: UnitReadinessClass;
  issues: string[];
  ready: number;
  blocked: number;
  stepsCurrent: number;
  stepsLegacy: number;
  stepsMissing: number;
  stepsMismatch: number;
  qCurrent: number;
  qLegacy: number;
  qMismatch: number;
  readyUnder8: number;
  historicalNonServable: { legacyQuestions: number; mismatchQuestions: number; retiredQuestions: number };
  activity: number;
  readyTopicIds: string[];
  blockedTopicIds: string[];
  topics: TopicReadiness[];
}

function hasTeachingSteps(steps: unknown): boolean {
  if (Array.isArray(steps)) return steps.length > 0;
  if (steps && typeof steps === "object" && Array.isArray((steps as { steps?: unknown }).steps)) return (steps as { steps: unknown[] }).steps.length > 0;
  return false;
}

const bump = (m: StateCounts, s: ContentProvenanceState) => { m[s] = (m[s] ?? 0) + 1; };

/**
 * `expectedSourceFingerprint`: the canonical grounding fingerprint for the
 * Unit's live source file + page range (computed by the caller); omitted =
 * not checked.
 */
export function classifyUnitContentReadiness(unit: ReadinessUnit, opts: { expectedSourceFingerprint?: string | null } = {}): UnitReadiness {
  const mode = enforcementForUnit(unit);
  const r: UnitReadiness = {
    unitId: unit.id, mode, class: "INVALID_STATE", issues: [],
    ready: 0, blocked: 0, stepsCurrent: 0, stepsLegacy: 0, stepsMissing: 0, stepsMismatch: 0, qCurrent: 0, qLegacy: 0, qMismatch: 0, readyUnder8: 0,
    historicalNonServable: { legacyQuestions: 0, mismatchQuestions: 0, retiredQuestions: 0 }, activity: 0, readyTopicIds: [], blockedTopicIds: [], topics: [],
  };
  if (opts.expectedSourceFingerprint !== undefined && unit.groundingSourceFingerprint !== opts.expectedSourceFingerprint) {
    r.issues.push("GROUNDING_IDENTITY_MISMATCH: grounding fingerprint not canonical for range");
  }
  const { topics: _topics, ...gateUnit } = unit;
  for (const t of unit.topics) {
    const topic = { ...t, unit: gateUnit };
    const gate = evaluateTopicGroundingGate(topic);
    if (gate.state !== "READY") {
      if (gate.reason !== "BLOCKED") r.issues.push(`${t.id}: ASSIGNMENT_${gate.reason}`);
      r.blocked++;
      r.blockedTopicIds.push(t.id);
      r.topics.push({ topicId: t.id, gate: gate.reason, steps: null, stepsServable: false, stored: {}, servable: {}, historicalNonServable: {}, lazyLessonRequired: false, topUpRequired: false });
      continue;
    }
    r.ready++;
    r.readyTopicIds.push(t.id);
    r.activity += t.activity ?? 0;

    const steps = t.teachingStepsJson ? classifyContentProvenance(topicStepsProvenance(t), gate.provenance) : "NONE";
    const stepsServable = canServeTopicSteps(topic);
    if (steps === "CURRENT") r.stepsCurrent++;
    else if (steps === "LEGACY") r.stepsLegacy++;
    else if (steps === "NONE") r.stepsMissing++;
    else { r.stepsMismatch++; r.issues.push(`${t.id}: ACTIVE_LESSON_PROVENANCE_MISMATCH`); }
    if (steps === "CURRENT" && !hasTeachingSteps(t.teachingStepsJson)) r.issues.push(`${t.id}: CURRENT_LESSON_EMPTY`);

    // The runtime pool is every stored non-placeholder Question of the Topic.
    const pool = t.questions.filter((q) => !q.isPlaceholder);
    const isServable = questionServabilityByTopic([topic], pool);
    const stored: StateCounts = {};
    const servable: StateCounts = {};
    const historical: StateCounts = {};
    for (const q of pool) {
      // A retired Question is history only: it never counts toward any stored/servable pool.
      if (isRetired(q)) { r.historicalNonServable.retiredQuestions++; continue; }
      const s = classifyContentProvenance(q, gate.provenance);
      bump(stored, s);
      bump(isServable(q) ? servable : historical, s);
    }
    r.qCurrent += stored.CURRENT ?? 0;
    r.qLegacy += stored.LEGACY ?? 0;
    r.qMismatch += stored.MISMATCH ?? 0;
    r.historicalNonServable.legacyQuestions += historical.LEGACY ?? 0;
    r.historicalNonServable.mismatchQuestions += historical.MISMATCH ?? 0;
    const currentServable = servable.CURRENT ?? 0;
    const servableTotal = Object.values(servable).reduce((a, b) => a + (b ?? 0), 0);
    if (currentServable < READINESS_POOL_TARGET) r.readyUnder8++;

    if (Object.keys(servable).length > 1) r.issues.push(`${t.id}: MIXED_SERVABLE_POOL`);
    if (servable.MISMATCH) r.issues.push(`${t.id}: MISMATCH_SERVABLE`);
    if (mode === "STRICT") {
      if (!stepsServable) r.issues.push(`${t.id}: STRICT_LESSON_NOT_SERVABLE`);
      if (currentServable < READINESS_POOL_TARGET) r.issues.push(`${t.id}: STRICT_POOL_UNDER_TARGET ${currentServable}/${READINESS_POOL_TARGET}`);
      if (servableTotal !== currentServable) r.issues.push(`${t.id}: STRICT_NON_CURRENT_SERVABLE`);
    } else if (stored.MISMATCH) {
      r.issues.push(`${t.id}: TRANSITION_QUESTION_MISMATCH`);
    }
    r.topics.push({
      topicId: t.id, gate: "READY", steps, stepsServable, stored, servable, historicalNonServable: historical,
      lazyLessonRequired: !stepsServable, topUpRequired: servableTotal < READINESS_POOL_TARGET,
    });
  }
  if (r.activity) r.issues.push(`STUDENT_ACTIVITY_ON_READY_CONTENT: ${r.activity}`);
  r.class = r.issues.length
    ? "INVALID_STATE"
    : mode === "STRICT"
      ? "ALREADY_STRICT"
      : r.ready > 0 && r.readyUnder8 === 0 && r.stepsCurrent === r.ready
        ? "ALREADY_READY_FOR_STRICT"
        : "NEEDS_PREPARATION";
  return r;
}
