import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AIProviderFactory } from "../ai/ai-provider.factory";
import { AIContextBuilderService, LessonTeachingContext } from "../ai/context/ai-context-builder.service";
import { AIUsageService } from "../ai/usage/ai-usage.service";
import { TutorQuestionPacksService } from "../tutor-question-packs/tutor-question-packs.service";
import { TutorService } from "../tutor/tutor.service";
import { describeExpectedAnswer, describeOperands, tryDeterministicValidate } from "./answer-validators/deterministic-validator";
import type { CheckExpression, StepResult, TeachingStep } from "./interactive-lesson.types";

const MAX_HINTS_BEFORE_FORCED_RESOLUTION = 1;

@Injectable()
export class InteractiveLessonService {
  private readonly logger = new Logger(InteractiveLessonService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AIProviderFactory,
    private readonly contextBuilder: AIContextBuilderService,
    private readonly usageService: AIUsageService,
    private readonly questionPacks: TutorQuestionPacksService,
    private readonly tutorService: TutorService,
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
   * turn) using the exact same Free-Trial/subscription/question-pack
   * paths TutorService.sendMessage already uses — no parallel quota
   * mechanism. Resuming an existing session never charges again.
   */
  private async reserveEntitlement(profile: { id: string }, subjectId: string) {
    const subscription = await this.prisma.client.subscription.findUnique({ where: { studentId: profile.id } });
    const hasActiveSubscription = subscription?.status === "active";
    const reservation = hasActiveSubscription
      ? await this.questionPacks.consumeForTutor(profile.id, subjectId)
      : await this.tutorService.reserveFreeTrial(profile.id, subjectId);
    return { hasActiveSubscription, reservation };
  }

  private async releaseEntitlement(profile: { id: string }, subjectId: string, reservation: { source: "daily" | "extra" | "free-trial" }) {
    if (reservation.source === "daily") {
      await this.usageService.releaseDailySlot(profile.id, subjectId).catch(() => undefined);
    } else if (reservation.source === "extra") {
      await this.questionPacks.refundExtraCredit(profile.id, subjectId).catch(() => undefined);
    } else {
      await this.tutorService.releaseFreeTrial(profile.id, subjectId).catch(() => undefined);
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

    const result = await provider.generate({
      systemPrompt: params.systemPrompt,
      messages: [{ role: "user", content: params.userTurnLabel }],
      responseFormat: params.responseFormat,
    });

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

    const contentToPersist = params.persistedContent ? params.persistedContent(result.content) : result.content;

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

    return result.content;
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
    const topic = await this.getTopicOrThrow(topicId);
    const steps = this.getSteps(topic);
    let session = await this.getOwnSession(profile, topicId);

    if (!session) {
      const { reservation } = await this.reserveEntitlement(profile, topic.unit.subjectId);
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
      return this.toPublicState(session, steps, null, true);
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
      return this.toPublicState(session, steps, lastMessage?.content ?? null, false, stepResults);
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
      return this.toPublicState(completedSession, steps, null, true);
    }
    const updatedSession = await this.prisma.client.lessonSession.update({
      where: { id: session.id },
      data: { currentStepIndex: nextIndex },
    });
    return this.deliverStep(profile, topic, updatedSession, steps, steps[nextIndex], stepResults);
  }

  private async deliverStep(profile: { id: string }, topic: any, session: any, steps: TeachingStep[], step: TeachingStep, stepResults: StepResult[]) {
    const isCheckStep = step.type === "CHECK";
    const ctx: LessonTeachingContext = {
      studentFirstName: (profile as any).fullName?.split(" ")[0] ?? "there",
      age: (profile as any).age ?? 7,
      preferredLang: (profile as any).preferredLang === "ar" ? "ar" : "en",
      subjectNameEn: topic.unit.subject.nameEn,
      lessonTitleEn: topic.nameEn,
      currentStep: { type: step.type, objective: step.objective, conceptKey: step.conceptKey, checkType: step.checkType },
      mode: "deliver",
    };
    const systemPrompt = this.contextBuilder.buildLessonTeachingPrompt(ctx);
    const raw = await this.runLessonAI({
      userId: (profile as any).userId,
      profileId: profile.id,
      subjectId: topic.unit.subjectId,
      conversationId: session.conversationId,
      systemPrompt,
      userTurnLabel: `Teach the "${step.type}" step now.`,
      responseFormat: isCheckStep ? "json_object" : undefined,
      persistedContent: isCheckStep ? (rawJson) => this.parseDeliverCheckJson(rawJson).say : undefined,
    });

    const { say: content, expression } = isCheckStep ? this.parseDeliverCheckJson(raw) : { say: raw, expression: undefined as CheckExpression | undefined };

    const updatedResults = this.upsertStepResult(stepResults, { stepId: step.id, delivered: true, attempts: 0, correct: step.type === "CHECK" ? false : null, hintGiven: false, expression });
    await this.prisma.client.lessonSession.update({ where: { id: session.id }, data: { stepResultsJson: updatedResults as any } });

    if (step.type === "COMPLETE") {
      const completedSession = await this.prisma.client.lessonSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      await this.syncStudentProgress(profile.id, topic, "completed");
      return this.toPublicState(completedSession, steps, content, true, updatedResults);
    }

    await this.syncStudentProgress(profile.id, topic, "in_progress");
    return this.toPublicState(session, steps, content, false, updatedResults);
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
  private parseDeliverCheckJson(raw: string): { say: string; expression: CheckExpression | undefined } {
    try {
      const parsed = JSON.parse(raw);
      const say = typeof parsed?.say === "string" && parsed.say.trim() ? parsed.say : raw;
      return { say, expression: this.normalizeExpression(parsed?.expression) };
    } catch {
      return { say: raw, expression: undefined };
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
    if (!message?.trim()) throw new BadRequestException("A message is required.");
    const profile = await this.getProfileOrThrow(userId);
    const topic = await this.getTopicOrThrow(topicId);
    const steps = this.getSteps(topic);
    const session = await this.getOwnSession(profile, topicId);
    if (!session) throw new NotFoundException("Start the lesson before responding.");
    if (session.status === "COMPLETED") return this.toPublicState(session, steps, null, true);

    const stepResults = this.stepResultsOf(session);
    const currentStep = steps[session.currentStepIndex];
    if (!currentStep) throw new NotFoundException("Lesson step not found.");

    if (currentStep.type !== "CHECK") {
      const content = await this.runInterruption(profile, topic, session, currentStep, message.trim());
      return this.toPublicState(session, steps, content, false, stepResults);
    }

    return this.evaluateCheck(profile, topic, session, steps, currentStep, stepResults, message.trim());
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
      const updatedResults = this.upsertStepResult(stepResults, { stepId: step.id, delivered: true, attempts, correct, hintGiven, expression });
      await this.prisma.client.lessonSession.update({ where: { id: session.id }, data: { stepResultsJson: updatedResults as any } });
      return this.toPublicState(session, steps, say, false, updatedResults);
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
      persistedContent: (rawJson) => {
        try {
          const say = JSON.parse(rawJson)?.say;
          return typeof say === "string" && say.trim() ? say : rawJson;
        } catch {
          return rawJson;
        }
      },
    });

    let parsed: { intent: "answer" | "question"; isCorrect: boolean | null; say: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Fail safe: never crash the lesson over a malformed model response —
      // treat it as an unresolved question so nothing incorrectly advances.
      parsed = { intent: "question", isCorrect: null, say: raw };
    }

    const { attempts, correct, hintGiven } = this.resolveCheckOutcome(prior, parsed.intent === "answer", parsed.isCorrect === true, hintAlreadyGiven);
    const updatedResults = this.upsertStepResult(stepResults, { stepId: step.id, delivered: true, attempts, correct, hintGiven, expression });
    await this.prisma.client.lessonSession.update({ where: { id: session.id }, data: { stepResultsJson: updatedResults as any } });

    return this.toPublicState(session, steps, parsed.say, false, updatedResults);
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

  /** Read-only state for resuming — e.g. on page reload, without generating any new AI content. */
  async getState(userId: string, topicId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const topic = await this.getTopicOrThrow(topicId);
    const steps = this.getSteps(topic);
    const session = await this.getOwnSession(profile, topicId);
    if (!session) return { started: false };
    const stepResults = this.stepResultsOf(session);
    const lastMessage = await this.prisma.client.aIMessage.findFirst({
      where: { conversationId: session.conversationId, role: "assistant" },
      orderBy: { createdAt: "desc" },
    });
    return { started: true, ...this.toPublicState(session, steps, lastMessage?.content ?? null, session.status === "COMPLETED", stepResults), stepResults };
  }
}
