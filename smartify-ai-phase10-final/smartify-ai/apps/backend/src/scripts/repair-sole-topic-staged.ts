/**
 * ADMIN: sole-Topic assignment repair via STAGED REGENERATION + ATOMIC FLIP
 * (2026-10-03). See ai/context/staged-assignment-repair.ts for the invariant
 * and design.
 *
 * For each explicitly listed Topic (stops on the first failure):
 *   1. preflight + plan from live state (Wave B scope from --plan, sole-Topic
 *      Unit, READY identity-valid KEYWORD_OVERLAP/HINT_MATCH assignment that
 *      recomputes to a whole-Unit SINGLE_TOPIC_FALLBACK slice);
 *   2. --apply only: stage a replacement lesson + 8 Questions against the
 *      candidate slice into the non-student-visible draft tables (normal
 *      budget reservation / AIUsage / reconciliation);
 *   3. validate the complete staged replacement;
 *   4. ONE serializable transaction: CAS the assignment, install lesson +
 *      Questions, verify the post-state, commit;
 *   5. re-verify the committed state.
 * A STRICT Unit stays STRICT throughout. A TRANSITION Unit is left for the
 * normal STRICT readiness dry-run + enforce-content-provenance step.
 *
 * Leftover staged rows from an earlier failed run of the same repair are
 * always discovered and reported. Pending QuestionDrafts provably stamped with
 * THIS candidate (and individually valid) are reused only with the explicit
 * --reuse-staged flag; ambiguous leftovers stop the run. A pending LessonDraft
 * is never reused (LessonDraft stores no provenance), so the lesson is staged
 * afresh. Grounding consistency for completion batches is judged on the final
 * candidate pool (reused + new).
 *
 * DRY RUN (default): zero provider calls, zero writes.
 *
 * Usage:
 *   node dist/scripts/repair-sole-topic-staged.js --plan=<wave-b.plan.json> --topicIds=<id>[,<id>] [--apply] [--reuse-staged]
 */
import * as fs from "fs";
import { discoverStagedLeftovers, flipStagedReplacement, planStagedRepair, stageReplacement, validateStaged, STAGED_POOL_TARGET, StagedRepairError, type FlipResult, type RepairTopic, type StageDeps, type StagedLeftovers, type StagedRepairPlan } from "../ai/context/staged-assignment-repair";
import { canServeTopicSteps, classifyContentProvenance, evaluateTopicGroundingGate, questionServabilityByTopic } from "../ai/context/topic-content-provenance.util";

export const MAX_TOPICS_PER_RUN = 25;
const ID = /^[a-z0-9]{20,40}$/;

export function parseArgs(argv: string[]): { plan: string; topicIds: string[]; apply: boolean; reuseStaged: boolean } {
  for (const a of argv) if (!/^--(plan|topicIds)=.+$/.test(a) && a !== "--apply" && a !== "--reuse-staged") throw new Error(`unexpected argument: ${a}`);
  for (const f of ["--apply", "--reuse-staged"]) if (argv.filter((a) => a === f).length > 1) throw new Error(`${f} given more than once`);
  const one = (n: string) => { const v = argv.filter((a) => a.startsWith(`--${n}=`)); if (v.length !== 1) throw new Error(`--${n} must be given exactly once`); return v[0].slice(n.length + 3); };
  const topicIds = one("topicIds").split(",");
  if (topicIds.some((x) => !ID.test(x))) throw new Error("malformed --topicIds entry");
  if (new Set(topicIds).size !== topicIds.length) throw new Error("duplicate --topicIds entry");
  if (topicIds.length > MAX_TOPICS_PER_RUN) throw new Error(`at most ${MAX_TOPICS_PER_RUN} Topics per run`);
  return { plan: one("plan"), topicIds, apply: argv.includes("--apply"), reuseStaged: argv.includes("--reuse-staged") };
}

/** The Wave B scope: Unit ids of the reviewed plan file. */
export function scopeFromPlan(plan: { books: Array<{ expectedUnits: Array<{ unitId: string }> }> }): Set<string> {
  return new Set(plan.books.flatMap((b) => b.expectedUnits.map((u) => u.unitId)));
}

export interface RepairDeps extends StageDeps {
  loadTopic(topicId: string): Promise<RepairTopic | null>;
  loadLessonDraft(id: string): Promise<any>;
  /** Pending, unpublished staged rows: QuestionDrafts of the Topic and LessonDrafts targeting the Unit. */
  loadPendingStaged(topicId: string, unitId: string): Promise<{ questionDrafts: any[]; lessonDrafts: any[] }>;
  flip(plan: StagedRepairPlan, staged: Awaited<ReturnType<typeof stageReplacement>>): Promise<FlipResult>;
}

function describe(plan: StagedRepairPlan, leftovers: StagedLeftovers, reuse: boolean) {
  const reused = reuse ? leftovers.reusableQuestionDraftIds.length : 0;
  return {
    topicId: plan.topicId,
    unitId: plan.unitId,
    unitMode: plan.unitMode,
    baselineAssignment: { method: plan.baseline.assignment.method, updatedAt: plan.baseline.assignment.updatedAt, assignmentVersion: plan.baseline.assignment.assignmentVersion, fingerprint: plan.oldAssignmentFingerprint },
    candidateAssignment: { method: plan.candidate.assignment.method, assignmentVersion: plan.baseline.assignment.assignmentVersion, fingerprint: plan.candidateAssignmentFingerprint },
    oldSlice: plan.oldSlice,
    candidateSlice: plan.candidateSlice,
    currentContent: plan.content,
    stagedLeftovers: {
      reusableQuestionDrafts: leftovers.reusableQuestionDraftIds,
      pendingLessonDrafts: leftovers.pendingLessonDraftIds,
      lessonReuse: leftovers.pendingLessonDraftIds.length ? "NOT_REUSED: LessonDraft stores no provenance, so membership in this candidate cannot be proven; the lesson is staged afresh (the old draft stays pending, never served)" : "NONE",
      ambiguous: leftovers.ambiguous,
      reuseRequested: reuse,
    },
    expectedProviderWork: { lessonGenerations: 1, maxLessonProviderCalls: 2, questionsReused: reused, questionsToStage: STAGED_POOL_TARGET - reused, maxQuestionProviderCalls: STAGED_POOL_TARGET - reused > 0 ? 4 : 0 },
    expectedAtomicWrites: [
      "TopicGroundingAssignment: compare-and-set to SINGLE_TOPIC_FALLBACK (same assignmentVersion)",
      "Topic: teachingSteps + generation metadata + provenance replaced by the staged lesson",
      "Lesson/LearningObjective: previous AI Lesson replaced by the staged lesson's (existing auto-publish behaviour)",
      "LessonDraft: staged draft marked published (previous draft's publish claim released)",
      `Question: ${STAGED_POOL_TARGET} new rows created from the staged drafts (candidate provenance)`,
      `QuestionDraft: ${STAGED_POOL_TARGET} staged drafts marked published`,
      "NOT written: any existing Question/QuestionDraft, the Unit, its grounding, its enforcement mode",
    ],
    expectedFinalAction: plan.unitMode === "STRICT" ? "Unit stays STRICT throughout; after commit the new content is CURRENT and served" : "after commit: STRICT readiness dry-run, then enforce-content-provenance --apply for this Unit",
    expectedPostCommit: { steps: "CURRENT", currentServableQuestions: STAGED_POOL_TARGET, oldCurrentQuestions: "MISMATCH (stored, never served)", legacyQuestions: "stored, never served" },
  };
}

/** Re-verifies the COMMITTED state from a fresh read (outside the transaction). */
export function verifyCommitted(topic: RepairTopic, plan: StagedRepairPlan): string[] {
  const errors: string[] = [];
  const gate = evaluateTopicGroundingGate(topic as any);
  if (gate.state !== "READY" || gate.provenance.groundingAssignmentFingerprint !== plan.candidateAssignmentFingerprint) errors.push("live assignment fingerprint is not the candidate");
  if (!canServeTopicSteps(topic as any)) errors.push("new steps not servable");
  if (gate.state === "READY") {
    const servable = questionServabilityByTopic([topic as any], topic.questions);
    const states = topic.questions.filter(servable).map((q) => classifyContentProvenance(q, gate.provenance));
    if (states.length !== STAGED_POOL_TARGET || states.some((s) => s !== "CURRENT")) errors.push(`servable pool ${JSON.stringify(states)}`);
  }
  if ((topic.unit.contentProvenanceEnforcedAt ? "STRICT" : "TRANSITION") !== plan.unitMode) errors.push("Unit enforcement mode changed");
  return errors;
}

export async function runStagedRepair(args: { topicIds: string[]; apply: boolean; reuseStaged?: boolean }, scope: ReadonlySet<string>, deps: RepairDeps) {
  const results: any[] = [];
  for (const id of args.topicIds) {
    const result: any = { topicId: id };
    results.push(result);
    try {
      const topic = await deps.loadTopic(id);
      if (!topic) throw new StagedRepairError("NOT_FOUND", `Topic ${id} not found`);
      const plan = planStagedRepair(topic, scope);
      const pending = await deps.loadPendingStaged(plan.topicId, plan.unitId);
      const leftovers = discoverStagedLeftovers(plan, pending.questionDrafts, pending.lessonDrafts);
      Object.assign(result, describe(plan, leftovers, !!args.reuseStaged));
      if (leftovers.ambiguous.length) throw new StagedRepairError("STAGED_LEFTOVERS_AMBIGUOUS", `${id}: leftover staged rows are ambiguous; nothing reused or deleted`, leftovers.ambiguous);
      if (leftovers.reusableQuestionDraftIds.length && !args.reuseStaged) throw new StagedRepairError("STAGED_LEFTOVERS_PRESENT", `${id}: ${leftovers.reusableQuestionDraftIds.length} reusable staged drafts exist; pass --reuse-staged to reuse them`);
      if (!args.apply) { result.status = "PLANNED"; continue; }
      const staged = await stageReplacement(plan, deps, { reuseQuestionDraftIds: args.reuseStaged ? leftovers.reusableQuestionDraftIds : [] });
      result.staged = { lessonDraftId: staged.lessonDraftId, questionDraftIds: staged.questionDraftIds, questionBatches: staged.questionBatches, batchErrors: staged.batchErrors };
      const errors = validateStaged(plan, await deps.loadLessonDraft(staged.lessonDraftId), await deps.loadQuestionDrafts(staged.questionDraftIds));
      if (errors.length) throw new StagedRepairError("STAGED_INVALID", `${id}: staged replacement invalid`, errors);
      result.flip = await deps.flip(plan, staged);
      const committed = await deps.loadTopic(id);
      const post = committed ? verifyCommitted(committed, plan) : ["Topic vanished"];
      if (post.length) throw new StagedRepairError("POST_COMMIT_VERIFY", `${id}: committed state failed verification`, post);
      result.status = "COMPLETED";
    } catch (err) {
      result.status = "FAILED";
      result.error = err instanceof StagedRepairError ? { code: err.code, message: err.message, detail: err.detail } : { code: "EXCEPTION", message: err instanceof Error ? err.message : String(err) };
      return { mode: args.apply ? "APPLY" : "DRY_RUN", results, stoppedOnFailure: true };
    }
  }
  return { mode: args.apply ? "APPLY" : "DRY_RUN", results, stoppedOnFailure: false };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scope = scopeFromPlan(JSON.parse(fs.readFileSync(args.plan, "utf8")));
  await import("reflect-metadata");
  await import("dotenv/config");
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../app.module");
  const { PrismaService } = await import("../prisma/prisma.service");
  const { LessonDraftGeneratorService } = await import("../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service");
  const { QuestionDraftGeneratorService } = await import("../question-bank/question-draft-generator/question-draft-generator.service");
  const { CONTENT_AUTHORING_ACTOR_ID } = await import("../ai/content-authoring-actor.const");
  const { parseBilingualObjectives } = await import("../interactive-lesson/lesson-draft-generator/lesson-objectives.util");

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    const prisma = app.get(PrismaService).client;
    const lessonGen = app.get(LessonDraftGeneratorService);
    const questionGen = app.get(QuestionDraftGeneratorService);
    const out = await runStagedRepair(args, scope, {
      loadTopic: async (id) =>
        (await prisma.topic.findUnique({
          where: { id },
          select: {
            id: true, nameEn: true, order: true, teachingStepsJson: true, groundingSourceFingerprintUsed: true, groundingAssignmentFingerprintUsed: true, groundingAssignment: true, topicSourceEvidence: true,
            questions: { select: { topicId: true, isPlaceholder: true, groundingSourceFingerprint: true, groundingAssignmentFingerprint: true } },
            unit: { select: { id: true, groundingVersion: true, groundingSourceFingerprint: true, groundingNotesJson: true, sourcePageStart: true, sourcePageEnd: true, contentProvenanceEnforcedAt: true, topics: { select: { id: true, nameEn: true, order: true }, orderBy: { order: "asc" } } } },
          },
        })) as any,
      generateLesson: async (topicId, gate) => {
        const t = await prisma.topic.findUniqueOrThrow({ where: { id: topicId }, select: { id: true, nameEn: true, nameAr: true, unitId: true } });
        const r = await lessonGen.generateAutoDraft(t, { preferredLang: "en", studentAgeRange: "6-12" }, CONTENT_AUTHORING_ACTOR_ID, { gate });
        return {
          draftId: r.draft.id,
          objectivesEn: parseBilingualObjectives(r.draft.learningObjectivesJson).map((o) => o.objectiveEn),
          metadata: { generationSource: r.generationSource, groundingVersionUsed: r.groundingVersionUsed, generationPromptVersion: r.generationPromptVersion, provenance: r.provenance },
        };
      },
      generateQuestions: async (topicId, count, gate, lessonObjectives, acceptedPool) =>
        (await questionGen.generateAutoQuestionBatch(topicId, count, CONTENT_AUTHORING_ACTOR_ID, { gate, lessonObjectives, acceptedPool })).drafts.map((d: any) => d.id),
      loadPendingStaged: async (topicId, unitId) => ({
        questionDrafts: await prisma.questionDraft.findMany({ where: { topicId, status: "pending_review", publishedQuestionId: null } }),
        lessonDrafts: await prisma.lessonDraft.findMany({ where: { targetUnitId: unitId, status: "pending_review", publishedTopicId: null } }),
      }),
      loadQuestionDrafts: async (ids) => prisma.questionDraft.findMany({ where: { id: { in: ids } } }),
      loadLessonDraft: async (id) => prisma.lessonDraft.findUnique({ where: { id } }),
      flip: (plan, staged) => flipStagedReplacement(prisma as any, plan, staged),
    });
    console.log(JSON.stringify(out, null, 2));
    if (out.stoppedOnFailure) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
      console.error("STAGED REPAIR FAILED:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
