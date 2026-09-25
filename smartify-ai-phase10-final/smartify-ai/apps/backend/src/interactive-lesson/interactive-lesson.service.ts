import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AIProviderFactory } from "../ai/ai-provider.factory";
import { AIContextBuilderService, LessonTeachingContext } from "../ai/context/ai-context-builder.service";
import { AIUsageService } from "../ai/usage/ai-usage.service";
import { TutorQuestionPacksService } from "../tutor-question-packs/tutor-question-packs.service";
import { TrialService } from "../trial/trial.service";
import { isStudentSubjectRowActive } from "../common/subject-entitlement.util";
import { LessonDraftGeneratorService } from "./lesson-draft-generator/lesson-draft-generator.service";
import { QuestionDraftGeneratorService } from "../question-bank/question-draft-generator/question-draft-generator.service";
import { describeExpectedAnswer, describeOperands, tryDeterministicValidate } from "./answer-validators/deterministic-validator";
import type { CheckExpression, StepResult, TeachingStep } from "./interactive-lesson.types";
import { decideStrategySwitch, getCurrentStrategy, isMathSubject, strategyGuidance } from "./teaching-strategy.util";

const MAX_HINTS_BEFORE_FORCED_RESOLUTION = 1;

// Consistent with TutorService.sendMessage's MAX_MESSAGE_CHARS — checked
// BEFORE any daily-limit/non-progress-budget consumption or provider call,
// same "reject an oversized prompt cheaply" placement (Phase 9.4A finding).
const MAX_MESSAGE_CHARS = 4000;

/**
 * Phase 9.4A found that respond() had no cap at all on repeated
 * non-progressing AI turns: every interruption on a non-CHECK step, and
 * every CHECK-step message that isn't a clean deterministic answer (i.e.
 * falls to AI classification), triggers a real billable call with no
 * server-side limit beyond the global IP throttle and the (now-configured)
 * USD budget. This is a coarse, session-scoped defense-in-depth cap on
 * exactly those two call shapes — genuine deterministic answer attempts
 * (tryDeterministicValidate) are never counted, so normal CHECK retries
 * and Teaching Strategy switching are completely unaffected.
 *
 * 20 was chosen to be generous enough that no realistic student's genuine
 * curiosity across one full lesson would ever hit it (a handful of
 * clarifying questions is normal; twenty is not), while bounding the
 * previously-unbounded spend vector to a small, fixed worst case per
 * session (~20 calls, a few cents at measured per-call rates) — a rate
 * SHAPE control, not the primary financial backstop, which remains the
 * global/per-user USD budget in AIUsageService.
 */
const NON_PROGRESS_TURN_LIMIT = 20;

@Injectable()
export class InteractiveLessonService {
  private readonly logger = new Logger(InteractiveLessonService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AIProviderFactory,
    private readonly contextBuilder: AIContextBuilderService,
    private readonly usageService: AIUsageService,
    private readonly questionPacks: TutorQuestionPacksService,
    private readonly trialService: TrialService,
    private readonly draftGenerator: LessonDraftGeneratorService,
    private readonly questionGenerator: QuestionDraftGeneratorService,
  ) {}

  private async getProfileOrThrow(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException("Complete onboarding before starting a lesson.");
    return profile;
  }

  private async getTopicOrThrow(topicId: string) {
    const topic = await this.prisma.client.topic.findUnique({
      where: { id: topicId },
      include: { unit: { include: { subject: { include: { grade: { include: { curriculum: true } } } } } } },
    });
    if (!topic || !topic.teachingStepsJson) {
      throw new NotFoundException("This lesson is not available as an interactive lesson yet.");
    }
    return topic;
  }

  private getSteps(topic: { teachingStepsJson: unknown }): TeachingStep[] {
    return topic.teachingStepsJson as unknown as TeachingStep[];
  }

  /**
   * Launch-speed lazy-generation path (2026-09-18): only called from
   * advance() (the actual "start/continue this lesson" action) — never
   * from getState() (read-only by design, per its own doc comment) or
   * respond() (a session already exists by then, so content already
   * exists too). A Topic seeded with only a title (teachingStepsJson:
   * null, no Lesson row yet) gets generated here, on this student's
   * first request for it, then cached permanently on the Topic row so
   * every later student/request is instant. No human-review gate for
   * this path — see LessonPublishService.autoPublishIntoTopic's doc
   * comment for the tradeoff this accepts.
   */
  private async ensureTopicHasSteps(topicId: string, profile: { userId: string; preferredLang?: string; age?: number }): Promise<any> {
    const existing = await this.prisma.client.topic.findUnique({
      where: { id: topicId },
      include: { unit: { include: { subject: { include: { grade: { include: { curriculum: true } } } } } } },
    });
    if (!existing) throw new NotFoundException("This lesson is not available as an interactive lesson yet.");
    if (existing.teachingStepsJson) return existing;

    const preparation = typeof (this.draftGenerator as any).prepareTopicGrounding === "function"
      ? await (this.draftGenerator as any).prepareTopicGrounding(topicId, profile.userId)
      : { status: "READY" as const };
    if (preparation.status !== "READY") {
      if (preparation.status === "CONFIGURATION_ERROR") throw new ServiceUnavailableException("This lesson is not available yet.");
      return { __preparation: true as const, status: "PREPARING" as const, retryAfterMs: preparation.retryAfterMs ?? 1500 };
    }

    await this.draftGenerator.ensureTopicHasLesson(
      topicId,
      { preferredLang: profile.preferredLang === "ar" ? "ar" : "en", studentAgeRange: String(profile.age ?? 7) },
      profile.userId,
    );

    // Same lazy trigger, same non-blocking philosophy: the topic now has a
    // real (non-placeholder) Lesson, so a question pool CAN be generated
    // for it. Deliberately NOT awaited — the student is waiting to start
    // THIS lesson, not for a practice pool they won't touch for several
    // more minutes; a second sequential AI round-trip here would roughly
    // double their time-to-first-step for no benefit they'd notice yet.
    // ensurePoolForTopic never throws (catches its own errors), so an
    // unhandled rejection here is not a concern.
    void this.questionGenerator.ensurePoolForTopic(topicId, profile.userId);

    const generated = await this.prisma.client.topic.findUnique({
      where: { id: topicId },
      include: { unit: { include: { subject: { include: { grade: { include: { curriculum: true } } } } } } },
    });
    if (!generated?.teachingStepsJson) throw new NotFoundException("This lesson is not available as an interactive lesson yet.");
    return generated;
  }

  /** Ownership check: a session belongs to exactly one StudentProfile — never trusts a client-supplied studentId. */
  private async getOwnSession(profile: { id: string }, topicId: string) {
    return this.prisma.client.lessonSession.findUnique({
      where: { studentId_topicId: { studentId: profile.id, topicId } },
    });
  }

  private stepResultsOf(session: { stepResultsJson: unknown }): StepResult[] {
    return (session.stepResultsJson as unknown as StepResult[]) ?? [];
  }

  private toPublicState(
    topic: { id: string; unit: { subjectId: string } },
    session: { id: string; status: string; currentStepIndex: number; conversationId: string },
    steps: TeachingStep[],
    content: string | null,
    completed: boolean,
    stepResults: StepResult[] = [],
  ) {
    const currentStep = steps[session.currentStepIndex];
    const currentResult = currentStep ? stepResults.find((r) => r.stepId === currentStep.id) : undefined;
    const isCheckPending = currentStep?.type === "CHECK";
    return {
      sessionId: session.id,
      conversationId: session.conversationId,
      // Launch-speed addition (2026-09-19): lets the frontend call
      // POST /quizzes/questions?type=lesson_check without a second
      // round-trip to look up which subject this topic belongs to.
      topicId: topic.id,
      subjectId: topic.unit.subjectId,
      status: session.status,
      currentStepIndex: session.currentStepIndex,
      totalSteps: steps.length,
      stepType: currentStep?.type ?? "COMPLETE",
      isCheckPending,
      // Whether the frontend should show "Continue" (non-check steps once
      // delivered, or a check step whose answer has already resolved
      // correct) vs. wait for the student to respond to a pending check.
      readyToContinue: completed ? false : !isCheckPending || currentResult?.correct === true,
      content,
      completed,
      // Never expose `prompt` (an internal generation instruction, not
      // student-facing) — only what the UI needs to render a visual slot.
      visual: currentStep?.visual ? { type: currentStep.visual.type, status: currentStep.visual.status, url: currentStep.visual.url } : null,
    };
  }

  /**
   * Reserves entitlement ONCE per lesson session (never per teaching
   * turn). Subject entitlement fix (2026-09-20): gated by StudentSubject
   * for THIS Subject — never account-wide Subscription.status — via the
   * same central expiresAt rule Practice/Quiz use (see
   * subject-entitlement.util.ts). A permanently-owned (expiresAt: null)
   * or currently-active time-limited (expiresAt > now, e.g. a referral
   * reward) grant reuses the exact same daily/extra question-pack paths
   * TutorService.sendMessage already uses. Otherwise this is the Free
   * Trial V1 (2026-09-20) path: exactly one lesson per one of the
   * student's own TWO chosen trial Subjects, on the exact Topic they're
   * opening (see TrialService.reserveLessonTrial) — never the older,
   * single-subject FreeTutorTrial mechanism, which stays exclusive to
   * free-form Tutor chat. Resuming an existing session never charges again.
   */
  private async reserveEntitlement(profile: { id: string }, subjectId: string, topicId: string) {
    const studentSubject = await this.prisma.client.studentSubject.findUnique({
      where: { studentId_subjectId: { studentId: profile.id, subjectId } },
    });
    const hasSubjectEntitlement = isStudentSubjectRowActive(studentSubject);
    const reservation = hasSubjectEntitlement
      ? await this.questionPacks.consumeForTutor(profile.id, subjectId)
      : await this.trialService.reserveLessonTrial(profile.id, subjectId, topicId);
    return { hasSubjectEntitlement, reservation };
  }

  private async releaseEntitlement(profile: { id: string }, subjectId: string, reservation: { source: "daily" | "extra" | "lesson-trial"; usageDate?: Date; consumptionId?: string }) {
    if (reservation.source === "daily") {
      await this.usageService.releaseDailySlot(profile.id, subjectId, reservation.usageDate).catch(() => undefined);
    } else if (reservation.source === "extra") {
      await this.questionPacks.refundExtraCredit(profile.id, subjectId, reservation.usageDate).catch(() => undefined);
    } else {
      await this.trialService.releaseLessonTrialReservation(reservation.consumptionId!).catch(() => undefined);
    }
  }

  /**
   * The ONE place that actually calls the AI provider for the lesson
   * engine, persists the turn as a real AIMessage (so the existing
   * /tutor/speech endpoint can verify and speak it unchanged), and logs a
   * "lesson_chat" AIUsage row with creditsUsed=0 (quota was already
   * reserved once at session start — see reserveEntitlement).
   */
  private async runLessonAI(params: {
    userId: string;
    profileId: string;
    subjectId: string;
    conversationId: string;
    systemPrompt: string;
    userTurnLabel: string;
    responseFormat?: "text" | "json_object";
    // For JSON-mode calls, the raw model output isn't what the student
    // actually sees/hears (evaluateCheck extracts just the "say" field) — the
    // persisted AIMessage must match that spoken/displayed text exactly, or
    // /tutor/speech's anti-injection check (text must match a real stored
    // reply) rejects the TTS request. Defaults to persisting the raw content.
    persistedContent?: (raw: string) => string;
  }): Promise<string> {
    await this.usageService.assertWithinBudget(params.userId);
    const { provider, providerKey, model } = await this.providerFactory.getActiveProvider();

    // Phase 9.4C: atomic USD reservation immediately before the provider
    // call — self-contained to this one AI call (reserve, call, then
    // reconcile-or-release below), independent of the outer per-session
    // entitlement reservation (reserveEntitlement/releaseEntitlement),
    // which is unrelated and unchanged.
    const estimatedUsd = await this.usageService.estimateMaxChatCostUsd({
      providerKey,
      inputText: params.systemPrompt + params.userTurnLabel,
    });
    const reserveResult = await this.usageService.reserveBudget(params.userId, estimatedUsd);
    if (!reserveResult.ok) {
      throw new ServiceUnavailableException(
        reserveResult.reason === "misconfigured"
          ? "The AI Tutor is temporarily unavailable. Please try again later."
          : "The AI Tutor is temporarily unavailable due to daily usage limits. Please try again later.",
      );
    }
    const budgetReservationId = reserveResult.reservationId;

    let result: Awaited<ReturnType<typeof provider.generate>>;
    try {
      result = await provider.generate({
        systemPrompt: params.systemPrompt,
        messages: [{ role: "user", content: params.userTurnLabel }],
        responseFormat: params.responseFormat,
      });
    } catch (err) {
      await this.usageService.releaseBudget(budgetReservationId).catch(() => undefined);
      throw err;
    }

    const usageRow = await this.usageService.buildUsageRow({
      userId: params.userId,
      studentId: params.profileId,
      subjectId: params.subjectId,
      providerKey,
      model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      feature: "lesson_chat",
      creditsUsed: 0,
    });

    // Reconciles regardless of whether the AIMessage/AIUsage transaction
    // below succeeds — real cost was already incurred at the provider
    // either way (same philosophy as TutorService.sendMessage).
    await this.usageService.reconcileBudget(budgetReservationId, usageRow.costUsd).catch(() => undefined);

    // Trimmed once, here, before anything else touches it — a plain-text
    // (non-CHECK) turn has no JSON envelope to extract a "say" field from,
    // so this is its only chance to strip the trailing whitespace the
    // model routinely emits; see parseDeliverCheckJson's comment for why
    // an untrimmed value breaks /tutor/speech's exact-match voice lookup.
    const rawContent = result.content.trim();
    const contentToPersist = params.persistedContent ? params.persistedContent(rawContent) : rawContent;

    try {
      await this.prisma.client.$transaction([
        this.prisma.client.aIMessage.create({ data: { conversationId: params.conversationId, role: "assistant", content: contentToPersist } }),
        this.prisma.client.aIConversation.update({ where: { id: params.conversationId }, data: { updatedAt: new Date() } }),
        this.prisma.client.aIUsage.create({ data: usageRow }),
      ]);
    } catch (txError) {
      this.usageService.logUntrackedUsage({ conversationId: params.conversationId, ...usageRow }, txError);
      this.logger.warn(`Lesson turn for conversation ${params.conversationId} generated but DB write failed; content still returned.`);
    }

    return rawContent;
  }

  /**
   * "advance": deliver the current step's content (first call after
   * start), or move forward to the next step if the current one is
   * already resolved. This is the ONLY method that ever changes
   * currentStepIndex — check evaluation (respond()) never advances by
   * itself, keeping "an interruption never advances the step" and "a
   * correct answer alone doesn't silently skip ahead" both true by
   * construction rather than by convention.
   */
  async advance(userId: string, topicId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const topic = await this.ensureTopicHasSteps(topicId, { userId, preferredLang: (profile as any).preferredLang, age: (profile as any).age });
    if ((topic as any).__preparation) return topic;
    const steps = this.getSteps(topic);
    let session = await this.getOwnSession(profile, topicId);

    if (!session) {
      const { reservation } = await this.reserveEntitlement(profile, topic.unit.subjectId, topicId);
      try {
        const conversation = await this.prisma.client.aIConversation.create({
          data: { studentId: profile.id, subjectId: topic.unit.subjectId, topicId, title: topic.nameEn },
        });
        session = await this.prisma.client.lessonSession.create({
          data: { studentId: profile.id, topicId, conversationId: conversation.id, status: "IN_PROGRESS", currentStepIndex: 0, stepResultsJson: [] },
        });
      } catch (err) {
        await this.releaseEntitlement(profile, topic.unit.subjectId, reservation);
        throw err;
      }
    }

    if (session.status === "COMPLETED") {
      return this.toPublicState(topic, session, steps, null, true);
    }

    const stepResults = this.stepResultsOf(session);
    const currentStep = steps[session.currentStepIndex];
    const currentResult = stepResults.find((r) => r.stepId === currentStep?.id);

    // A pending, unresolved CHECK cannot be skipped by "advance" — the
    // student must actually respond to it first. Re-serve its own
    // content idempotently rather than erroring, since a resumed page
    // load calls advance() the same way a fresh one does.
    const blockedOnCheck = currentStep?.type === "CHECK" && (!currentResult || currentResult.correct !== true);

    if (blockedOnCheck) {
      const lastMessage = await this.prisma.client.aIMessage.findFirst({
        where: { conversationId: session.conversationId, role: "assistant" },
        orderBy: { createdAt: "desc" },
      });
      return this.toPublicState(topic, session, steps, lastMessage?.content ?? null, false, stepResults);
    }

    if (currentResult?.delivered) {
      return this.moveToNextStep(profile, topic, session, steps, stepResults);
    }

    // First time this step is being shown (fresh start, or a resumed
    // session whose current step was never actually delivered yet).
    return this.deliverStep(profile, topic, session, steps, currentStep, stepResults);
  }

  private async moveToNextStep(profile: { id: string }, topic: any, session: any, steps: TeachingStep[], stepResults: StepResult[]) {
    const nextIndex = session.currentStepIndex + 1;
    if (nextIndex >= steps.length) {
      const completedSession = await this.prisma.client.lessonSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      await this.syncStudentProgress(profile.id, topic, "completed");
      return this.toPublicState(topic, completedSession, steps, null, true);
    }
    const updatedSession = await this.prisma.client.lessonSession.update({
      where: { id: session.id },
      data: { currentStepIndex: nextIndex },
    });
    return this.deliverStep(profile, topic, updatedSession, steps, steps[nextIndex], stepResults);
  }

  private async deliverStep(profile: { id: string }, topic: any, session: any, steps: TeachingStep[], step: TeachingStep, stepResults: StepResult[]) {
    const isCheckStep = step.type === "CHECK";
    // Phase 8 V1: the teaching representation (objects/number-line/etc.)
    // applies to the actual teaching content — EXPLAIN/EXAMPLE/CHECK —
    // not to framing steps (INTRO/REVIEW/COMPLETE), and only ever chosen
    // by deterministic code (teaching-strategy.util.ts), never the model.
    // Production hotfix (2026-09-25): also gated on isMathSubject — the
    // strategy system (CONCRETE_OBJECTS/NUMBER_LINE) is a Math-specific
    // pedagogy pilot and must never apply to other subjects (a Science
    // lesson was previously taught via "take 2 steps on a number line").
    const appliesStrategy = isMathSubject(topic.unit.subject.nameEn) && (step.type === "EXPLAIN" || step.type === "EXAMPLE" || step.type === "CHECK");
    const currentStrategy = appliesStrategy ? getCurrentStrategy(stepResults) : undefined;
    const ctx: LessonTeachingContext = {
      studentFirstName: (profile as any).fullName?.split(" ")[0] ?? "there",
      age: (profile as any).age ?? 7,
      preferredLang: (profile as any).preferredLang === "ar" ? "ar" : "en",
      subjectNameEn: topic.unit.subject.nameEn,
      lessonTitleEn: topic.nameEn,
      currentStep: { type: step.type, objective: step.objective, conceptKey: step.conceptKey, checkType: step.checkType },
      mode: "deliver",
      teachingStrategy: currentStrategy,
      teachingStrategyGuidance: currentStrategy ? strategyGuidance(currentStrategy) : undefined,
    };
    const systemPrompt = this.contextBuilder.buildLessonTeachingPrompt(ctx);
    // Deterministic backstop, not just a prompt instruction: real traffic
    // showed the model inventing an arithmetic "expression" (e.g. "if you
    // have 3 apples and add 2 more") for a Science CHECK step about life
    // processes/plant needs, despite the prompt already telling it to set
    // expression:null for non-computable questions — the instruction alone
    // isn't reliably followed. Restricting deterministic grading to actual
    // Mathematics topics means a non-math subject's CHECK always falls back
    // to full AI-based conceptual grading (already fully supported), never
    // a bogus numeric answer key. Found 2026-09-19, user-confirmed ("بيدخل
    // ال math في ال science").
    const allowExpression = isMathSubject(topic.unit.subject.nameEn);
    const raw = await this.runLessonAI({
      userId: (profile as any).userId,
      profileId: profile.id,
      subjectId: topic.unit.subjectId,
      conversationId: session.conversationId,
      systemPrompt,
      userTurnLabel: `Teach the "${step.type}" step now.`,
      responseFormat: isCheckStep ? "json_object" : undefined,
      persistedContent: isCheckStep ? (rawJson) => this.parseDeliverCheckJson(rawJson, allowExpression).say : undefined,
    });

    const { say: content, expression } = isCheckStep ? this.parseDeliverCheckJson(raw, allowExpression) : { say: raw, expression: undefined as CheckExpression | undefined };

    const updatedResults = this.upsertStepResult(stepResults, {
      stepId: step.id,
      delivered: true,
      attempts: 0,
      correct: step.type === "CHECK" ? false : null,
      hintGiven: false,
      expression,
      strategy: currentStrategy,
    });
    await this.prisma.client.lessonSession.update({ where: { id: session.id }, data: { stepResultsJson: updatedResults as any } });

    if (step.type === "COMPLETE") {
      const completedSession = await this.prisma.client.lessonSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      await this.syncStudentProgress(profile.id, topic, "completed");
      return this.toPublicState(topic, completedSession, steps, content, true, updatedResults);
    }

    await this.syncStudentProgress(profile.id, topic, "in_progress");
    return this.toPublicState(topic, session, steps, content, false, updatedResults);
  }

  private upsertStepResult(existing: StepResult[], next: StepResult): StepResult[] {
    const withoutCurrent = existing.filter((r) => r.stepId !== next.stepId);
    return [...withoutCurrent, next];
  }

  /**
   * Parses a CHECK step's delivery JSON ({"say", "expression"}). Fails safe
   * in every direction: a malformed/non-JSON response is treated as plain
   * "say" text with no expression, and a malformed "expression" (wrong
   * shape, missing operands, unknown op) is dropped to null rather than
   * trusted — an absent/invalid expression simply means this check falls
   * back to full AI-based grading later, never a crash or a guess.
   */
  private parseDeliverCheckJson(raw: string, allowExpression: boolean): { say: string; expression: CheckExpression | undefined } {
    try {
      const parsed = JSON.parse(raw);
      // Trimmed here, not just checked for truthiness — /tutor/speech's
      // anti-injection check (TutorSpeechService.synthesize) trims its own
      // input before matching against the persisted AIMessage.content, so
      // an untrimmed "say" value (the model routinely emits a trailing
      // space before its closing quote) would persist one string but be
      // compared against a different (trimmed) one, breaking voice
      // playback for that turn — found 2026-09-19 via a real "Voice
      // playback unavailable" report. This is the single source both the
      // persisted DB row (via the persistedContent callback above, which
      // calls this same function) and the value returned to the frontend
      // read from, so trimming once here keeps them identical.
      const say = typeof parsed?.say === "string" && parsed.say.trim() ? parsed.say.trim() : raw;
      return { say, expression: allowExpression ? this.normalizeExpression(parsed?.expression) : undefined };
    } catch {
      return { say: raw, expression: undefined };
    }
  }

  /** Same trimming rationale as parseDeliverCheckJson — see its comment. */
  private parseEvaluateCheckJson(raw: string): { intent: "answer" | "question"; isCorrect: boolean | null; say: string } {
    try {
      const parsed = JSON.parse(raw);
      const say = typeof parsed?.say === "string" && parsed.say.trim() ? parsed.say.trim() : raw;
      return { intent: parsed?.intent === "answer" ? "answer" : "question", isCorrect: parsed?.isCorrect === true ? true : parsed?.isCorrect === false ? false : null, say };
    } catch {
      return { intent: "question", isCorrect: null, say: raw };
    }
  }

  private normalizeExpression(candidate: any): CheckExpression | undefined {
    if (!candidate || typeof candidate !== "object") return undefined;
    const operands = candidate.operands;
    if (!Array.isArray(operands) || operands.length !== 2 || !operands.every((n: unknown) => typeof n === "number" && Number.isFinite(n))) {
      return undefined;
    }
    if (candidate.op === "add" || candidate.op === "subtract" || candidate.op === "equals") {
      return { op: candidate.op, operands: [operands[0], operands[1]] };
    }
    if (candidate.op === "compare" && (candidate.comparator === "greater" || candidate.comparator === "less")) {
      return { op: "compare", operands: [operands[0], operands[1]], comparator: candidate.comparator };
    }
    return undefined;
  }

  /**
   * The single place "no infinite retry" is decided, shared by both the
   * deterministic-validator path and the AI-classification fallback path so
   * the two can never drift on this rule. `isAnswerAttempt` false (a genuine
   * clarifying question, not an answer) leaves everything unchanged.
   */
  private resolveCheckOutcome(
    prior: StepResult | undefined,
    isAnswerAttempt: boolean,
    isCorrectNow: boolean,
    hintAlreadyGiven: boolean,
  ): { attempts: number; correct: boolean | null; hintGiven: boolean } {
    const attempts = (prior?.attempts ?? 0) + (isAnswerAttempt ? 1 : 0);
    let correct = prior?.correct === true ? true : null;
    let hintGiven = hintAlreadyGiven;

    if (isAnswerAttempt) {
      if (isCorrectNow) {
        correct = true;
      } else if (hintAlreadyGiven || attempts > MAX_HINTS_BEFORE_FORCED_RESOLUTION) {
        // No infinite retry: after one hint, the check is resolved
        // regardless of further correctness, so the lesson can move on.
        correct = true;
      } else {
        correct = false;
        hintGiven = true;
      }
    }

    return { attempts, correct, hintGiven };
  }

  /**
   * Narrates an ALREADY-decided deterministic verdict — the model is only
   * asked to phrase the reaction in character; it never re-judges
   * correctness here, so a contradictory model output can affect wording but
   * can never change what gets persisted as `correct`.
   */
  private async narrateCheckResult(
    profile: { id: string },
    topic: any,
    session: any,
    step: TeachingStep,
    message: string,
    prior: StepResult | undefined,
    hintAlreadyGiven: boolean,
    deterministicCorrect: boolean,
    expression: CheckExpression,
  ): Promise<{ attempts: number; correct: boolean | null; hintGiven: boolean; say: string }> {
    const { attempts, correct, hintGiven } = this.resolveCheckOutcome(prior, true, deterministicCorrect, hintAlreadyGiven);
    const checkOutcome: "correct" | "hint" | "reveal" = deterministicCorrect ? "correct" : correct === true ? "reveal" : "hint";

    const ctx: LessonTeachingContext = {
      studentFirstName: (profile as any).fullName?.split(" ")[0] ?? "there",
      age: (profile as any).age ?? 7,
      preferredLang: (profile as any).preferredLang === "ar" ? "ar" : "en",
      subjectNameEn: topic.unit.subject.nameEn,
      lessonTitleEn: topic.nameEn,
      currentStep: { type: step.type, objective: step.objective, conceptKey: step.conceptKey, checkType: step.checkType },
      mode: "narrate_check_result",
      checkOutcome,
      correctAnswerText: checkOutcome === "reveal" ? describeExpectedAnswer(expression) : undefined,
      questionNumbersText: describeOperands(expression),
      studentMessage: message,
    };
    const systemPrompt = this.contextBuilder.buildLessonTeachingPrompt(ctx);
    const say = await this.runLessonAI({
      userId: (profile as any).userId,
      profileId: profile.id,
      subjectId: topic.unit.subjectId,
      conversationId: session.conversationId,
      systemPrompt,
      userTurnLabel: message,
    });

    return { attempts, correct, hintGiven, say };
  }

  /**
   * "respond": the student typed/said something while a step is showing.
   * If the current step is a CHECK, this is evaluated as an answer
   * attempt (or a genuine interruption question, detected by the model
   * itself). If the current step is NOT a check, there is nothing to
   * evaluate — it is always treated as an interruption. Neither path ever
   * changes currentStepIndex; only advance() does that.
   */
  async respond(userId: string, topicId: string, message: string) {
    const trimmed = message?.trim();
    if (!trimmed) throw new BadRequestException("A message is required.");
    if (trimmed.length > MAX_MESSAGE_CHARS) {
      throw new BadRequestException(`Message is too long (max ${MAX_MESSAGE_CHARS} characters).`);
    }
    const profile = await this.getProfileOrThrow(userId);
    const topic = await this.getTopicOrThrow(topicId);
    const steps = this.getSteps(topic);
    const session = await this.getOwnSession(profile, topicId);
    if (!session) throw new NotFoundException("Start the lesson before responding.");
    if (session.status === "COMPLETED") return this.toPublicState(topic, session, steps, null, true);

    const stepResults = this.stepResultsOf(session);
    const currentStep = steps[session.currentStepIndex];
    if (!currentStep) throw new NotFoundException("Lesson step not found.");

    if (currentStep.type !== "CHECK") {
      if (!(await this.consumeNonProgressBudget(session))) {
        return this.toPublicState(topic, session, steps, this.nonProgressLimitMessage(profile), false, stepResults);
      }
      const content = await this.runInterruption(profile, topic, session, currentStep, trimmed);
      return this.toPublicState(topic, session, steps, content, false, stepResults);
    }

    return this.evaluateCheck(profile, topic, session, steps, currentStep, stepResults, trimmed);
  }

  /**
   * Session-scoped, server-authoritative non-progress-turn budget — see
   * NON_PROGRESS_TURN_LIMIT above. Reads then increments (not a single
   * atomic statement like reserveDailySlot): this guards call SHAPE across
   * one student's own sequential lesson session, not concurrent access to
   * a shared, money-equivalent resource, so the stricter atomic pattern
   * used for the daily quota isn't needed here — a narrow race would at
   * worst allow one or two extra calls before saturating, never an
   * unbounded amount.
   */
  private async consumeNonProgressBudget(session: { id: string; nonProgressTurns: number }): Promise<boolean> {
    if (session.nonProgressTurns >= NON_PROGRESS_TURN_LIMIT) return false;
    await this.prisma.client.lessonSession.update({
      where: { id: session.id },
      data: { nonProgressTurns: { increment: 1 } },
    });
    return true;
  }

  private nonProgressLimitMessage(profile: { preferredLang?: string }): string {
    return profile.preferredLang === "ar"
      ? "سألت أسئلة كتير في الدرس ده — خلّينا نكمل خطوات الدرس دلوقتي، وتقدر تسأل المزيد في الدرس الجاي."
      : "You've asked quite a few questions in this lesson — let's continue with the lesson steps for now. You can ask more next time.";
  }

  private async runInterruption(profile: { id: string }, topic: any, session: any, step: TeachingStep, message: string) {
    const ctx: LessonTeachingContext = {
      studentFirstName: (profile as any).fullName?.split(" ")[0] ?? "there",
      age: (profile as any).age ?? 7,
      preferredLang: (profile as any).preferredLang === "ar" ? "ar" : "en",
      subjectNameEn: topic.unit.subject.nameEn,
      lessonTitleEn: topic.nameEn,
      currentStep: { type: step.type, objective: step.objective, conceptKey: step.conceptKey },
      mode: "interrupt",
      studentMessage: message,
    };
    const systemPrompt = this.contextBuilder.buildLessonTeachingPrompt(ctx);
    return this.runLessonAI({
      userId: (profile as any).userId,
      profileId: profile.id,
      subjectId: topic.unit.subjectId,
      conversationId: session.conversationId,
      systemPrompt,
      userTurnLabel: message,
    });
  }

  private async evaluateCheck(
    profile: { id: string },
    topic: any,
    session: any,
    steps: TeachingStep[],
    step: TeachingStep,
    stepResults: StepResult[],
    message: string,
  ) {
    const prior = stepResults.find((r) => r.stepId === step.id);
    const hintAlreadyGiven = prior?.hintGiven ?? false;
    const expression = prior?.expression;
    // Phase 8 V1: strategy switching only ever applies to conceptual
    // (non-deterministic) checks — deterministic arithmetic checks below
    // are explicitly unaffected, per "deterministic validation remains
    // authoritative" and stay on whatever strategy is already current.
    // Production hotfix (2026-09-25): gated on isMathSubject, same as
    // deliverStep — undefined here means "the strategy system does not
    // apply to this subject at all", which also makes any stale
    // `strategy` value persisted on an OLDER session (e.g. a leftover
    // "NUMBER_LINE" from before this fix) inert: it's simply never read
    // back into currentStrategy for a non-Math subject, and gets
    // overwritten with undefined on this step's next write below — no
    // manual DB cleanup needed.
    const isMath = isMathSubject(topic.unit.subject.nameEn);
    const currentStrategy = isMath ? getCurrentStrategy(stepResults) : undefined;

    // Deterministic-first: when this check's question was captured as a
    // gradable expression at delivery time AND the student's reply parses
    // cleanly into the answer shape that expression expects, correctness is
    // decided here in code — the model only narrates it afterwards and can
    // never override it. Anything else (no expression, or a reply that
    // doesn't parse as a clean answer — e.g. a genuine clarifying question)
    // falls back to the original full AI-classification behavior below.
    const deterministic = expression ? tryDeterministicValidate(expression, message) : null;
    if (deterministic && expression) {
      const { attempts, correct, hintGiven, say } = await this.narrateCheckResult(
        profile,
        topic,
        session,
        step,
        message,
        prior,
        hintAlreadyGiven,
        deterministic.correct,
        expression,
      );
      const updatedResults = this.upsertStepResult(stepResults, {
        stepId: step.id,
        delivered: true,
        attempts,
        correct,
        hintGiven,
        expression,
        strategy: currentStrategy,
        strategyHistory: prior?.strategyHistory,
      });
      await this.prisma.client.lessonSession.update({ where: { id: session.id }, data: { stepResultsJson: updatedResults as any } });
      return this.toPublicState(topic, session, steps, say, false, updatedResults);
    }

    // Reaches here only when the message did NOT parse as a clean
    // deterministic answer — a genuine ambiguous/conceptual answer, a real
    // clarifying question, or repeated non-progress chatter. All three are
    // indistinguishable before the model classifies them, so the same
    // session-scoped budget applies here too (never to the deterministic
    // branch above, which is exempt — normal CHECK retries are unaffected).
    if (!(await this.consumeNonProgressBudget(session))) {
      return this.toPublicState(topic, session, steps, this.nonProgressLimitMessage(profile as any), false, stepResults);
    }

    const ctx: LessonTeachingContext = {
      studentFirstName: (profile as any).fullName?.split(" ")[0] ?? "there",
      age: (profile as any).age ?? 7,
      preferredLang: (profile as any).preferredLang === "ar" ? "ar" : "en",
      subjectNameEn: topic.unit.subject.nameEn,
      lessonTitleEn: topic.nameEn,
      currentStep: { type: step.type, objective: step.objective, conceptKey: step.conceptKey, checkType: step.checkType },
      mode: "evaluate_check",
      hintAlreadyGivenThisStep: hintAlreadyGiven,
      studentMessage: message,
      teachingStrategy: currentStrategy,
      teachingStrategyGuidance: currentStrategy ? strategyGuidance(currentStrategy) : undefined,
    };
    const systemPrompt = this.contextBuilder.buildLessonTeachingPrompt(ctx);
    const raw = await this.runLessonAI({
      userId: (profile as any).userId,
      profileId: profile.id,
      subjectId: topic.unit.subjectId,
      conversationId: session.conversationId,
      systemPrompt,
      userTurnLabel: message,
      responseFormat: "json_object",
      persistedContent: (rawJson) => this.parseEvaluateCheckJson(rawJson).say,
    });

    // Fail safe built into parseEvaluateCheckJson itself: a malformed model
    // response never crashes the lesson — it's treated as an unresolved
    // question so nothing incorrectly advances.
    const parsed = this.parseEvaluateCheckJson(raw);

    const isAnswerAttempt = parsed.intent === "answer";
    const isCorrectNow = parsed.isCorrect === true;

    // Phase 8 V1: only a conceptual CHECK's genuinely-wrong answer attempts
    // can trigger a strategy switch — never a question, never a correct
    // answer, never a deterministic (arithmetic) check. Production hotfix
    // (2026-09-25): also never for a non-Math subject — `isMath` gates
    // this before `currentStrategy` (only ever defined when isMath is
    // true) is passed in.
    const switchDecision =
      isMath && currentStrategy && step.checkType === "conceptual" && isAnswerAttempt && !isCorrectNow
        ? decideStrategySwitch({
            stepId: step.id,
            attemptsSoFar: (prior?.attempts ?? 0) + 1,
            isMeaningfulWrongAttempt: true,
            currentStrategy,
            alreadySwitchedAtThisStep: (prior?.strategyHistory?.length ?? 0) > 0,
          })
        : null;

    // A switch replaces the normal "give up after one hint" resolution
    // with one more genuine attempt under the new strategy — switching IS
    // the second chance here, so this attempt must not be force-resolved.
    const { attempts, correct, hintGiven } = switchDecision
      ? { attempts: (prior?.attempts ?? 0) + 1, correct: false, hintGiven: true }
      : this.resolveCheckOutcome(prior, isAnswerAttempt, isCorrectNow, hintAlreadyGiven);

    const updatedResults = this.upsertStepResult(stepResults, {
      stepId: step.id,
      delivered: true,
      attempts,
      correct,
      hintGiven,
      expression,
      // Production hotfix (2026-09-25): for a non-Math subject this
      // actively overwrites any stale persisted strategy/strategyHistory
      // (e.g. a resumed session with a leftover "NUMBER_LINE" from before
      // this fix) with undefined on this step's next write, rather than
      // just leaving it unread — self-heals with no manual DB cleanup.
      strategy: isMath ? switchDecision?.strategy ?? prior?.strategy ?? currentStrategy : undefined,
      strategyHistory: isMath ? (switchDecision ? [...(prior?.strategyHistory ?? []), switchDecision.record] : prior?.strategyHistory) : undefined,
    });
    await this.prisma.client.lessonSession.update({ where: { id: session.id }, data: { stepResultsJson: updatedResults as any } });

    return this.toPublicState(topic, session, steps, parsed.say, false, updatedResults);
  }

  /** Best-effort — StudentProgress remains an optional aggregate signal; failures here never break the lesson itself. */
  private async syncStudentProgress(studentId: string, topic: any, status: "in_progress" | "completed") {
    try {
      const lesson = await this.prisma.client.lesson.findFirst({ where: { topicId: topic.id } });
      if (!lesson) return;
      await this.prisma.client.studentProgress.upsert({
        where: { studentId_lessonId: { studentId, lessonId: lesson.id } },
        create: { studentId, lessonId: lesson.id, status },
        update: { status },
      });
    } catch (err) {
      this.logger.warn(`StudentProgress sync skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Shared curriculum content (see controller doc) — no per-student ownership check needed, only that a visual with this id exists. */
  async getVisualAsset(assetId: string) {
    const asset = await this.prisma.client.lessonVisualAsset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException("Visual not found.");
    return asset;
  }

  /**
   * Read-only state for resuming — e.g. on page reload, without generating
   * any new AI content. This is the FIRST call the Lesson page makes on
   * every visit, including a title-only topic's very first one — launch-
   * speed lazy-generation bug found 2026-09-19: this used to reuse
   * getTopicOrThrow (throws for teachingStepsJson === null), which meant
   * a never-opened topic 404'd here before the "Start Lesson" button
   * (the thing that actually triggers generation, via advance()) ever had
   * a chance to render — the page showed a hard "not available" error
   * instead of a start button. A Topic that exists but hasn't been
   * generated yet is reported as simply "not started" (a session could
   * never exist for it anyway, since advance() is what both creates the
   * first session AND generates the content), not a 404 — only a
   * genuinely nonexistent Topic id still throws.
   */
  async getState(userId: string, topicId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const topic = await this.prisma.client.topic.findUnique({
      where: { id: topicId },
      include: { unit: { include: { subject: { include: { grade: { include: { curriculum: true } } } } } } },
    });
    if (!topic) throw new NotFoundException("This lesson is not available as an interactive lesson yet.");
    if (!topic.teachingStepsJson) {
      const preparation = typeof (this.draftGenerator as any).getTopicGroundingPreparationStatus === "function"
        ? await (this.draftGenerator as any).getTopicGroundingPreparationStatus(topicId)
        : { status: "READY" as const };
      return { started: false, preparation };
    }
    const steps = this.getSteps(topic);
    const session = await this.getOwnSession(profile, topicId);
    if (!session) return { started: false };
    const stepResults = this.stepResultsOf(session);
    const lastMessage = await this.prisma.client.aIMessage.findFirst({
      where: { conversationId: session.conversationId, role: "assistant" },
      orderBy: { createdAt: "desc" },
    });
    return { started: true, ...this.toPublicState(topic, session, steps, lastMessage?.content ?? null, session.status === "COMPLETED", stepResults), stepResults };
  }
}
