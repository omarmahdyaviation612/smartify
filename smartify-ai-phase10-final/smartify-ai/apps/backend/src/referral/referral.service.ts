import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";

function generateCode(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

const REWARD_DAYS = 30;

/**
 * Referral V1 (2026-09-20) — code/link -> signup attaches a referral once
 * -> referred student's FIRST successful paid activation earns the
 * referrer one reward -> the referrer applies it to one Subject of their
 * choice for 30 (stacked) days. No fake payment/Subscription row is ever
 * created — see Referral's own schema doc comment for the full audit
 * trail this relies on.
 */
@Injectable()
export class ReferralService {
  constructor(private readonly prisma: PrismaService) {}

  private async getProfileOrThrow(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException("Complete onboarding before using referrals.");
    return profile;
  }

  /** Lazily creates a unique code the first time it's read — every onboarded student is "eligible". */
  async getOrCreateCode(userId: string): Promise<string> {
    const profile = await this.getProfileOrThrow(userId);
    const existing = await this.prisma.client.referralCode.findUnique({ where: { studentId: profile.id } });
    if (existing) return existing.code;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const created = await this.prisma.client.referralCode.create({ data: { studentId: profile.id, code: generateCode() } });
        return created.code;
      } catch (err: any) {
        if (err?.code === "P2002") {
          // Either the generated code collided with someone else's (retry
          // with a fresh one) or a concurrent request already created
          // THIS student's row — check before assuming which.
          const raced = await this.prisma.client.referralCode.findUnique({ where: { studentId: profile.id } });
          if (raced) return raced.code;
          continue;
        }
        throw err;
      }
    }
    throw new ServiceUnavailableException("Could not generate a referral code. Please try again.");
  }

  /**
   * Attaches a referral to the CURRENT student, once. Referral.
   * referredStudentId's unique constraint is what makes this immutable —
   * any later call, with any code, always fails.
   */
  async attach(userId: string, code: string): Promise<{ attached: boolean }> {
    const profile = await this.getProfileOrThrow(userId);
    const trimmed = (code ?? "").trim().toUpperCase();
    if (!trimmed) throw new BadRequestException("A referral code is required.");

    const existing = await this.prisma.client.referral.findUnique({ where: { referredStudentId: profile.id } });
    if (existing) throw new ForbiddenException("A referral is already attached to your account.");

    const referrerCode = await this.prisma.client.referralCode.findUnique({ where: { code: trimmed } });
    if (!referrerCode) throw new BadRequestException("Unknown referral code.");
    if (referrerCode.studentId === profile.id) throw new BadRequestException("You cannot refer yourself.");

    try {
      await this.prisma.client.referral.create({
        data: { referrerStudentId: referrerCode.studentId, referredStudentId: profile.id, code: trimmed },
      });
    } catch (err: any) {
      if (err?.code === "P2002") throw new ForbiddenException("A referral is already attached to your account.");
      throw err;
    }
    return { attached: true };
  }

  /** Referrer's own view: their code, and every referral they've made with its reward state — never the referred student's identity. */
  async getMe(userId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const code = await this.getOrCreateCode(userId);
    const referrals = await this.prisma.client.referral.findMany({
      where: { referrerStudentId: profile.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, earnedAt: true, appliedAt: true, appliedSubjectId: true, appliedExpiresAt: true },
    });

    const appliedSubjectIds = [...new Set(referrals.map((r) => r.appliedSubjectId).filter((id): id is string => id != null))];
    const appliedSubjects = appliedSubjectIds.length > 0
      ? await this.prisma.client.subject.findMany({ where: { id: { in: appliedSubjectIds } }, select: { id: true, nameEn: true, nameAr: true } })
      : [];
    const appliedSubjectById = new Map(appliedSubjects.map((s) => [s.id, s]));

    return {
      code,
      referralsCreated: referrals.length,
      successfulReferrals: referrals.filter((r) => r.earnedAt != null).length,
      pendingRewards: referrals
        .filter((r) => r.earnedAt != null && r.appliedAt == null)
        .map((r) => ({ referralId: r.id, earnedAt: r.earnedAt })),
      appliedRewards: referrals
        .filter((r) => r.appliedAt != null)
        .map((r) => ({
          referralId: r.id,
          appliedAt: r.appliedAt,
          subjectId: r.appliedSubjectId,
          subjectNameEn: r.appliedSubjectId ? appliedSubjectById.get(r.appliedSubjectId)?.nameEn ?? null : null,
          subjectNameAr: r.appliedSubjectId ? appliedSubjectById.get(r.appliedSubjectId)?.nameAr ?? null : null,
          expiresAt: r.appliedExpiresAt,
        })),
    };
  }

  /** Subjects in the referrer's own grade a pending reward could usefully apply to — excludes anything already permanently owned. */
  async getEligibleRewardSubjects(userId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const subjects = await this.prisma.client.subject.findMany({ where: { gradeId: profile.gradeId, isActive: true }, orderBy: { nameEn: "asc" } });
    const owned = await this.prisma.client.studentSubject.findMany({ where: { studentId: profile.id } });
    const permanentlyOwned = new Set(owned.filter((o: { expiresAt: Date | null }) => o.expiresAt == null).map((o: { subjectId: string }) => o.subjectId));
    return subjects.filter((s) => !permanentlyOwned.has(s.id)).map((s) => ({ id: s.id, nameEn: s.nameEn, nameAr: s.nameAr }));
  }

  /**
   * The referrer applies ONE earned-but-unapplied reward to a Subject of
   * their choice. Stacks onto an existing time-limited grant (extends
   * from ITS OWN expiry) or starts fresh from now — "the simplest safe
   * rule" the spec asks for when no stacking behavior is already
   * defined. Never touches a permanently-owned (expiresAt: null) Subject
   * — nothing to extend, and re-granting it would be meaningless. The
   * conditional updateMany (appliedAt: null) is what makes a double-click
   * or a retried request unable to apply the same reward twice.
   */
  async applyReward(userId: string, referralId: string, subjectId: string) {
    const profile = await this.getProfileOrThrow(userId);

    const subject = await this.prisma.client.subject.findFirst({ where: { id: subjectId, gradeId: profile.gradeId, isActive: true } });
    if (!subject) throw new BadRequestException("This subject is not available for your grade.");

    const existingGrant = await this.prisma.client.studentSubject.findUnique({
      where: { studentId_subjectId: { studentId: profile.id, subjectId } },
    });
    if (existingGrant && existingGrant.expiresAt == null) {
      throw new BadRequestException("You already have full access to this subject.");
    }

    const now = new Date();
    const base = existingGrant?.expiresAt && existingGrant.expiresAt > now ? existingGrant.expiresAt : now;
    // Reward duration is a fixed number of elapsed 24-hour days, independent
    // of the server's local timezone or daylight-saving transitions.
    const newExpiresAt = new Date(base.getTime() + REWARD_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.referral.updateMany({
        where: { id: referralId, referrerStudentId: profile.id, earnedAt: { not: null }, appliedAt: null },
        data: { appliedAt: now, appliedSubjectId: subjectId, appliedExpiresAt: newExpiresAt },
      });
      if (result.count !== 1) {
        throw new ForbiddenException("This reward is not available to apply.");
      }
      await tx.studentSubject.upsert({
        where: { studentId_subjectId: { studentId: profile.id, subjectId } },
        create: { studentId: profile.id, subjectId, expiresAt: newExpiresAt },
        update: { expiresAt: newExpiresAt },
      });
    });

    return { subjectId, expiresAt: newExpiresAt };
  }

  /**
   * Called from BillingService's two activation paths, inside the SAME
   * transaction as activation (and the same WebhookEventLog idempotency
   * guard those paths already enforce) — marks the reward EARNED
   * (pending application), never applies it to a Subject itself (that's
   * the referrer's own later choice via applyReward). The conditional
   * updateMany (earnedAt: null) makes this race-safe on top of the outer
   * guard, and is what stops a resubscribe/second activation from
   * rewarding twice — a no-op if this student was never referred, or was
   * already rewarded.
   */
  async earnRewardWithinTransaction(tx: any, referredStudentId: string): Promise<void> {
    const referral = await tx.referral.findUnique({ where: { referredStudentId } });
    if (!referral) return;
    await tx.referral.updateMany({
      where: { id: referral.id, earnedAt: null },
      data: { earnedAt: new Date() },
    });
  }
}
