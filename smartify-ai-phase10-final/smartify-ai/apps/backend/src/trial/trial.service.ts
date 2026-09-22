import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

function parseSubjectIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Free Trial V1 (2026-09-20) — exactly two student-chosen Subjects, one
 * free Interactive Lesson each. Deliberately separate from StudentSubject
 * (paid/onboarding entitlement) and from the older FreeTutorTrial (a
 * single-subject, two-QUESTION free-form Tutor-chat trial that
 * InteractiveLessonService used to reuse for Lesson entitlement too —
 * this replaces that reuse; TutorService.sendMessage's own free-tutor
 * trial is untouched and unrelated).
 */
@Injectable()
export class TrialService {
  constructor(private readonly prisma: PrismaService) {}

  private async getProfileOrThrow(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException("Complete onboarding before selecting free trial subjects.");
    return profile;
  }

  /**
   * One-shot: a student may select their two free-trial Subjects exactly
   * once. LessonTrial.studentId's unique constraint enforces this at the
   * DB level — a second call always fails — which is also what makes a
   * selected Subject "never replaceable" true even before any lesson is
   * consumed, per spec.
   */
  async selectSubjects(userId: string, subjectIds: string[]) {
    const profile = await this.getProfileOrThrow(userId);

    const existing = await this.prisma.client.lessonTrial.findUnique({ where: { studentId: profile.id } });
    if (existing) {
      throw new ForbiddenException("Your free trial subjects are already set and cannot be changed.");
    }

    const unique = [...new Set(subjectIds ?? [])];
    if (unique.length !== 2) {
      throw new BadRequestException("Choose exactly two different subjects.");
    }

    const subjects = await this.prisma.client.subject.findMany({
      where: { id: { in: unique }, gradeId: profile.gradeId, isActive: true },
    });
    if (subjects.length !== 2) {
      throw new BadRequestException("One or more selected subjects are not available for your grade.");
    }

    try {
      await this.prisma.client.lessonTrial.create({ data: { studentId: profile.id, subjectIds: unique } });
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new ForbiddenException("Your free trial subjects are already set and cannot be changed.");
      }
      throw err;
    }

    return this.getState(userId);
  }

  /** Read-only trial state for the student dashboard: selection + per-subject used/unused. */
  async getState(userId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const trial = await this.prisma.client.lessonTrial.findUnique({
      where: { studentId: profile.id },
      include: { consumptions: true },
    });
    if (!trial) {
      return { selected: false as const, subjects: [] as Array<{ subjectId: string; nameEn: string; nameAr: string; used: boolean; topicId: string | null }> };
    }

    const subjectIds = parseSubjectIds(trial.subjectIds);
    const subjectRows = subjectIds.length > 0 ? await this.prisma.client.subject.findMany({ where: { id: { in: subjectIds } } }) : [];
    const subjectById = new Map(subjectRows.map((s) => [s.id, s]));
    const consumptionBySubjectId = new Map(trial.consumptions.map((c) => [c.subjectId, c]));

    return {
      selected: true as const,
      subjects: subjectIds.map((id) => {
        const subject = subjectById.get(id);
        const consumption = consumptionBySubjectId.get(id);
        return {
          subjectId: id,
          nameEn: subject?.nameEn ?? "(unknown subject)",
          nameAr: subject?.nameAr ?? "",
          used: !!consumption,
          topicId: consumption?.topicId ?? null,
        };
      }),
    };
  }

  /**
   * Reserves the one free lesson for `subjectId` in `topicId`. Called only
   * from InteractiveLessonService.reserveEntitlement when the student has
   * no active subscription — never a parallel/duplicate quota mechanism.
   * Concurrency-safe purely via LessonTrialConsumption's DB unique
   * constraint (see that model's own doc comment) — no read-then-write
   * race window: two simultaneous reservation attempts for the same
   * Subject both reach the INSERT, and only one can ever succeed.
   */
  async reserveLessonTrial(studentId: string, subjectId: string, topicId: string): Promise<{ source: "lesson-trial"; consumptionId: string }> {
    const trial = await this.prisma.client.lessonTrial.findUnique({ where: { studentId } });
    if (!trial) {
      throw new ForbiddenException("Select your two free trial subjects before starting a free lesson.");
    }
    const subjectIds = parseSubjectIds(trial.subjectIds);
    if (!subjectIds.includes(subjectId)) {
      throw new ForbiddenException("This subject is not one of your selected free trial subjects.");
    }
    try {
      const consumption = await this.prisma.client.lessonTrialConsumption.create({
        data: { trialId: trial.id, studentId, subjectId, topicId },
      });
      return { source: "lesson-trial", consumptionId: consumption.id };
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new ForbiddenException("Your free trial lesson for this subject has already been used. Purchase this subject to continue.");
      }
      throw err;
    }
  }

  /** Rollback for a reservation whose session creation failed — mirrors TutorService.releaseFreeTrial's best-effort shape. */
  async releaseLessonTrialReservation(consumptionId: string): Promise<void> {
    await this.prisma.client.lessonTrialConsumption.delete({ where: { id: consumptionId } }).catch(() => undefined);
  }

  /**
   * Read-only bypass checks reused by PracticeService/QuizzesService
   * instead of a parallel gating mechanism — never StudentSubject rows.
   * Fail-CLOSED by design: any unexpected error (including a test
   * harness whose mocked Prisma client never defines these models) is
   * treated as "no trial access", never as an accidental bypass.
   */
  async isSubjectTrialBrowsable(studentId: string, subjectId: string): Promise<boolean> {
    try {
      const trial = await this.prisma.client.lessonTrial.findUnique({ where: { studentId } });
      if (!trial) return false;
      return parseSubjectIds(trial.subjectIds).includes(subjectId);
    } catch {
      return false;
    }
  }

  /** True only for the exact (subjectId, topicId) the student's one free lesson in that Subject was actually used on. */
  async isTopicTrialAccessible(studentId: string, subjectId: string, topicId: string): Promise<boolean> {
    try {
      const trial = await this.prisma.client.lessonTrial.findUnique({ where: { studentId }, include: { consumptions: true } });
      if (!trial) return false;
      return trial.consumptions.some((c: { subjectId: string; topicId: string }) => c.subjectId === subjectId && c.topicId === topicId);
    } catch {
      return false;
    }
  }
}
