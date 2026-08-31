import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { StudentOnboardingInput } from "@smartify/validation";

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates or updates the StudentProfile for the current user and sets
   * their selected subjects. This is the "profile + curriculum + grade +
   * subjects" step of onboarding — steps 2-4 of the spec, combined into
   * one call since the frontend wizard collects them across a few screens
   * but submits together once the student confirms their selections.
   */
  async saveProfile(userId: string, input: StudentOnboardingInput) {
    const curriculum = await this.prisma.client.curriculum.findUnique({
      where: { code: input.curriculumCode },
    });
    if (!curriculum) throw new BadRequestException("Unknown curriculum code.");

    const grade = await this.prisma.client.grade.findUnique({ where: { id: input.gradeId } });
    if (!grade || grade.curriculumId !== curriculum.id) {
      throw new BadRequestException("Grade does not belong to the selected curriculum.");
    }

    const subjects = await this.prisma.client.subject.findMany({
      where: { id: { in: input.subjectIds }, gradeId: grade.id },
    });
    if (subjects.length !== input.subjectIds.length) {
      throw new BadRequestException("One or more subjects are invalid for the selected grade.");
    }

    const profile = await this.prisma.client.studentProfile.upsert({
      where: { userId },
      update: {
        fullName: input.fullName,
        age: input.age,
        country: input.country,
        preferredLang: input.preferredLang,
        curriculumId: curriculum.id,
        gradeId: grade.id,
        weeklyStudyHours: input.weeklyStudyHours,
        goals: input.goals,
      },
      create: {
        userId,
        fullName: input.fullName,
        age: input.age,
        country: input.country,
        preferredLang: input.preferredLang,
        curriculumId: curriculum.id,
        gradeId: grade.id,
        weeklyStudyHours: input.weeklyStudyHours,
        goals: input.goals,
      },
    });

    // Replace subject selection wholesale — simplest correct behavior for
    // an onboarding step the student can revisit before finishing.
    await this.prisma.client.studentSubject.deleteMany({ where: { studentId: profile.id } });
    await this.prisma.client.studentSubject.createMany({
      data: subjects.map((s) => ({ studentId: profile.id, subjectId: s.id })),
    });

    return profile;
  }

  private async getProfileOrThrow(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException("Complete the profile step before continuing.");
    return profile;
  }

  /**
   * Diagnostic assessment — Phase 4 scope note: this is a rule-based
   * diagnostic built from the existing question bank (mixed difficulty,
   * spread across the student's selected subjects' topics), NOT an
   * AI-adaptive assessment. True per-answer adaptive difficulty requires
   * the AI Service Layer (Phase 6) and is deliberately not faked here —
   * see 04-phase4-decisions.md.
   */
  async getDiagnosticQuestions(userId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const studentSubjects = await this.prisma.client.studentSubject.findMany({
      where: { studentId: profile.id },
      include: { subject: { include: { units: { include: { topics: true } } } } },
    });

    const topicIds = studentSubjects.flatMap((ss) => ss.subject.units.flatMap((u) => u.topics.map((t) => t.id)));
    if (topicIds.length === 0) {
      throw new BadRequestException("No subjects selected yet — complete the subject step first.");
    }

    // A small, mixed-difficulty spread — enough to produce a meaningful
    // per-subject score without turning onboarding into a long exam.
    const questions = await this.prisma.client.question.findMany({
      where: { topicId: { in: topicIds } },
      take: 10,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        topicId: true,
        type: true,
        difficulty: true,
        promptEn: true,
        promptAr: true,
        optionsJson: true,
        isPlaceholder: true,
        topic: { select: { unit: { select: { subject: { select: { id: true, nameEn: true, nameAr: true } } } } } },
      },
    });

    // Correct answers are intentionally omitted from this response.
    return questions.map((q) => ({
      id: q.id,
      subjectId: q.topic.unit.subject.id,
      subjectNameEn: q.topic.unit.subject.nameEn,
      subjectNameAr: q.topic.unit.subject.nameAr,
      type: q.type,
      difficulty: q.difficulty,
      promptEn: q.promptEn,
      promptAr: q.promptAr,
      optionsJson: q.optionsJson,
      isPlaceholder: q.isPlaceholder,
    }));
  }

  async submitDiagnostic(userId: string, answers: Array<{ questionId: string; answer: unknown }>) {
    const profile = await this.getProfileOrThrow(userId);
    if (answers.length === 0) throw new BadRequestException("No answers submitted.");

    const questions = await this.prisma.client.question.findMany({
      where: { id: { in: answers.map((a) => a.questionId) } },
      include: { topic: { include: { unit: { include: { subject: true } } } } },
    });
    const questionById = new Map(questions.map((q) => [q.id, q]));

    const perSubject = new Map<string, { nameEn: string; nameAr: string; correct: number; total: number }>();
    const attemptRows: Array<{ studentId: string; questionId: string; answerJson: any; isCorrect: boolean; source: string }> = [];

    for (const a of answers) {
      const q = questionById.get(a.questionId);
      if (!q) continue;

      const isCorrect = JSON.stringify(q.correctAnswerJson) === JSON.stringify(a.answer);
      attemptRows.push({ studentId: profile.id, questionId: q.id, answerJson: a.answer, isCorrect, source: "diagnostic" });

      const subject = q.topic.unit.subject;
      const entry = perSubject.get(subject.id) ?? { nameEn: subject.nameEn, nameAr: subject.nameAr, correct: 0, total: 0 };
      entry.total += 1;
      if (isCorrect) entry.correct += 1;
      perSubject.set(subject.id, entry);
    }

    await this.prisma.client.questionAttempt.createMany({ data: attemptRows });

    const scoreJson = Object.fromEntries(
      Array.from(perSubject.entries()).map(([subjectId, s]) => [
        subjectId,
        { nameEn: s.nameEn, nameAr: s.nameAr, correct: s.correct, total: s.total, percent: Math.round((s.correct / s.total) * 100) },
      ]),
    );

    const assessment = await this.prisma.client.assessment.create({
      data: { studentId: profile.id, type: "diagnostic", scoreJson },
    });

    // Rule-based initial plan: recommend the lowest-scoring subject(s) first.
    // NOT an AI-generated plan — that upgrade lands with the AI Tutor (Phase 6).
    const weakestFirst = Object.entries(scoreJson).sort((a: any, b: any) => a[1].percent - b[1].percent);
    const planJson = {
      generatedBy: "rule_based_v1",
      recommendedFocus: weakestFirst.slice(0, 2).map(([, s]: any) => s.nameEn),
      note: "Initial rule-based plan from diagnostic scores. Will be replaced by AI-personalized planning in a later phase.",
    };
    await this.prisma.client.learningPlan.create({
      data: { studentId: profile.id, title: "Initial Learning Plan", planJson, isActive: true },
    });

    return { assessmentId: assessment.id, scoreJson, planJson };
  }

  async getSummary(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({
      where: { userId },
      include: {
        curriculum: true,
        grade: true,
        subjects: { include: { subject: true } },
        learningPlans: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1 },
        quizResults: true,
      },
    });
    if (!profile) throw new NotFoundException("No student profile yet.");

    const latestAssessment = await this.prisma.client.assessment.findFirst({
      where: { studentId: profile.id, type: "diagnostic" },
      orderBy: { createdAt: "desc" },
    });

    return {
      fullName: profile.fullName,
      curriculum: { nameEn: profile.curriculum.nameEn, nameAr: profile.curriculum.nameAr },
      grade: { nameEn: profile.grade.nameEn, nameAr: profile.grade.nameAr },
      subjects: profile.subjects.map((s) => ({ nameEn: s.subject.nameEn, nameAr: s.subject.nameAr })),
      diagnosticScore: latestAssessment?.scoreJson ?? null,
      learningPlan: profile.learningPlans[0]?.planJson ?? null,
    };
  }
}
