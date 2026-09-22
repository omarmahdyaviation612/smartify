import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TopicAccuracyService } from "../analytics/topic-accuracy.service";
import { QuestionDraftGeneratorService } from "../question-bank/question-draft-generator/question-draft-generator.service";
import { Difficulty } from "@smartify/shared-types";
import { pickDifficultyWeights } from "./difficulty-weights";
import { TrialService } from "../trial/trial.service";
import { hasSubjectEntitlementInList } from "../common/subject-entitlement.util";

@Injectable()
export class PracticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly topicAccuracy: TopicAccuracyService,
    private readonly questionGenerator: QuestionDraftGeneratorService,
    // Defaulted (not required) so every existing direct `new
    // PracticeService(...)` test construction keeps working unchanged —
    // TrialService's own bypass checks fail closed on any error (see its
    // own doc comment), so a real instance backed by a test's bare-bones
    // mocked Prisma client is always safe to construct here.
    private readonly trialService: TrialService = new TrialService(prisma),
  ) {}

  private async getProfileOrThrow(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({
      where: { userId },
      include: { subjects: true },
    });
    if (!profile) throw new NotFoundException("Complete onboarding before practicing.");
    return profile;
  }

  private hasOwnedAccess(profile: { subjects: Array<{ subjectId: string; expiresAt?: Date | null }> }, subjectId: string): boolean {
    return hasSubjectEntitlementInList(profile.subjects, subjectId);
  }

  /**
   * Free Trial V1 (2026-09-20): a non-owned Subject/Topic combination is
   * still allowed through when it's the EXACT Topic the student's one
   * free trial lesson in that Subject was used on — never a whole-subject
   * bypass. `browseOnly` additionally allows a non-owned trial Subject
   * with no Topic pinned yet, for the topic-listing endpoint only (so a
   * student can pick which Topic to try).
   */
  private async assertSubjectAccessible(
    profile: { id: string; subjects: Array<{ subjectId: string; expiresAt?: Date | null }> },
    subjectId: string,
    opts: { topicId?: string; browseOnly?: boolean } = {},
  ) {
    if (this.hasOwnedAccess(profile, subjectId)) return;
    if (opts.browseOnly && (await this.trialService.isSubjectTrialBrowsable(profile.id, subjectId))) return;
    if (opts.topicId && (await this.trialService.isTopicTrialAccessible(profile.id, subjectId, opts.topicId))) return;
    throw new ForbiddenException("This subject is not part of your selected subjects.");
  }

  /** Topics for a subject, annotated with the student's real accuracy so the UI can highlight weak spots. */
  async getTopicsForSubject(userId: string, subjectId: string) {
    const profile = await this.getProfileOrThrow(userId);
    await this.assertSubjectAccessible(profile, subjectId, { browseOnly: true });

    const topics = await this.prisma.client.topic.findMany({
      where: { unit: { subjectId } },
      orderBy: { order: "asc" },
    });
    const accuracy = await this.topicAccuracy.getPerTopicAccuracy(profile.id, [subjectId]);
    const accuracyByTopic = new Map(accuracy.map((a) => [a.topicId, a.percent]));

    return topics.map((t) => ({
      id: t.id,
      nameEn: t.nameEn,
      nameAr: t.nameAr,
      accuracyPercent: accuracyByTopic.get(t.id) ?? null,
    }));
  }

  // Rule-based adaptive difficulty selection lives in ./difficulty-weights.ts
  // (extracted as a pure function so it's independently unit-testable —
  // see difficulty-weights.spec.ts). See 07-phase7-decisions.md for why
  // this is a rule-based lookup rather than an AI call.

  async getAdaptiveQuestions(userId: string, subjectId: string, topicId: string | undefined, count = 8) {
    const profile = await this.getProfileOrThrow(userId);
    // A trial student must always pin a specific topicId (the exact one
    // their free lesson was on) — an undifferentiated "any topic in this
    // subject" request (topicId undefined) is never trial-bypassable.
    await this.assertSubjectAccessible(profile, subjectId, { topicId });

    const topicWhere = topicId ? { id: topicId, unit: { subjectId } } : { unit: { subjectId } };
    const topics = await this.prisma.client.topic.findMany({ where: topicWhere });
    if (topics.length === 0) throw new BadRequestException("No topics found for this selection.");

    // Launch-speed lazy-generation path (2026-09-19): only for a single
    // requested topic — an undifferentiated "any topic in this subject"
    // request could span dozens of topics, and generating a pool for all
    // of them synchronously here would make the request itself the
    // bottleneck. ensurePoolForTopic is a no-op once a pool exists, and
    // never throws, so this is safe to await unconditionally.
    if (topicId) await this.questionGenerator.ensurePoolForTopic(topicId, userId);

    const topicIds = topics.map((t) => t.id);
    const avgAccuracy =
      topicId != null
        ? await this.topicAccuracy.getTopicAccuracy(profile.id, topicId)
        : (await this.topicAccuracy.getPerTopicAccuracy(profile.id, [subjectId]))
            .filter((a) => topicIds.includes(a.topicId))
            .reduce<number | null>((acc, t, _i, arr) => (acc ?? 0) + t.percent / arr.length, null);

    const weights = pickDifficultyWeights(avgAccuracy);
    // Phase 10E: isPlaceholder: false is load-bearing, not cosmetic — same
    // rationale as the diagnostic's own filter (Phase 10D.1) and Quiz's
    // (this phase) — seed/demo placeholder content must never reach a real
    // student assessment flow.
    const allQuestions = await this.prisma.client.question.findMany({
      where: { topicId: { in: topicIds }, isPlaceholder: false },
      select: {
        id: true,
        topicId: true,
        type: true,
        difficulty: true,
        promptEn: true,
        promptAr: true,
        optionsJson: true,
        isPlaceholder: true,
      },
    });

    // Weighted random sample without replacement, honoring difficulty weights loosely.
    const byDifficulty: Record<string, typeof allQuestions> = { EASY: [], MEDIUM: [], HARD: [] };
    for (const q of allQuestions) byDifficulty[q.difficulty].push(q);

    const selected: typeof allQuestions = [];
    const difficulties = Object.keys(weights) as Difficulty[];
    while (selected.length < count && allQuestions.length > selected.length) {
      const roll = Math.random();
      let cumulative = 0;
      let chosenDifficulty: Difficulty = difficulties[0];
      for (const d of difficulties) {
        cumulative += weights[d];
        if (roll <= cumulative) {
          chosenDifficulty = d;
          break;
        }
      }
      const pool = byDifficulty[chosenDifficulty].filter((q) => !selected.includes(q));
      const fallbackPool = pool.length > 0 ? pool : allQuestions.filter((q) => !selected.includes(q));
      if (fallbackPool.length === 0) break;
      selected.push(fallbackPool[Math.floor(Math.random() * fallbackPool.length)]);
    }

    return { averageAccuracy: avgAccuracy, questions: selected };
  }

  async submitPractice(userId: string, answers: Array<{ questionId: string; answer: unknown }>) {
    const profile = await this.getProfileOrThrow(userId);
    if (answers.length === 0) throw new BadRequestException("No answers submitted.");

    // Question.topic.unit.subjectId is the ONE real source of truth for a
    // Question's Subject — never a client-supplied field (submitPractice
    // has no subjectId in its request shape at all). Selected in the same
    // findMany that already loads the questions, so this stays one query,
    // not one-per-question.
    const questions = await this.prisma.client.question.findMany({
      where: { id: { in: answers.map((a) => a.questionId) } },
      include: { topic: { select: { unit: { select: { subjectId: true } } } } },
    });
    const questionById = new Map(questions.map((q) => [q.id, q]));

    // Scope validation BEFORE any write. A student may legitimately submit
    // across several of their own owned subjects in one request — this
    // checks SET membership, never a single-subject restriction. An
    // unresolved questionId is not a scope violation here (see the loop
    // below) — it's silently skipped, exactly as before this task. A
    // trial student may additionally submit answers for the exact Topic
    // their free lesson was on (Free Trial V1, 2026-09-20).
    for (const a of answers) {
      const q = questionById.get(a.questionId);
      if (!q) continue;
      const subjectId = q.topic.unit.subjectId;
      if (this.hasOwnedAccess(profile, subjectId)) continue;
      if (await this.trialService.isTopicTrialAccessible(profile.id, subjectId, q.topicId)) continue;
      throw new ForbiddenException("One or more submitted questions are not part of your selected subjects.");
    }

    const feedback: Array<{ questionId: string; isCorrect: boolean; correctAnswer: unknown; explanationEn: string | null; explanationAr: string | null }> = [];
    const attemptRows: Array<{ studentId: string; questionId: string; answerJson: any; isCorrect: boolean; source: string }> = [];

    for (const a of answers) {
      const q = questionById.get(a.questionId);
      if (!q) continue;
      const isCorrect = JSON.stringify(q.correctAnswerJson) === JSON.stringify(a.answer);
      attemptRows.push({ studentId: profile.id, questionId: q.id, answerJson: a.answer, isCorrect, source: "practice" });
      feedback.push({ questionId: q.id, isCorrect, correctAnswer: q.correctAnswerJson, explanationEn: q.explanationEn, explanationAr: q.explanationAr });
    }

    await this.prisma.client.questionAttempt.createMany({ data: attemptRows });

    const correctCount = feedback.filter((f) => f.isCorrect).length;
    return { correctCount, total: feedback.length, feedback };
  }
}
