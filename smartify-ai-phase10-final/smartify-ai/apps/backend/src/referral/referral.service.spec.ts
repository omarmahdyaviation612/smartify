import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ReferralService } from "./referral.service";

/**
 * Referral V1 (2026-09-20). The `$transaction` mock here mirrors the same
 * pattern billing-webhook-retry.spec.ts / billing-lifecycle-webhook.spec.ts
 * already use: a draft-then-commit snapshot, so a thrown error inside the
 * callback leaves the outer state untouched — the same guarantee a real
 * Postgres transaction gives applyReward's conditional updateMany +
 * studentSubject upsert pair.
 */
describe("ReferralService", () => {
  function makeHarness() {
    const gradeId = "grade-1";
    const profiles: Record<string, { id: string; userId: string; gradeId: string }> = {
      "user-referrer": { id: "student-referrer", userId: "user-referrer", gradeId },
      "user-referred": { id: "student-referred", userId: "user-referred", gradeId },
    };
    const subjects = [
      { id: "subject-math", gradeId, isActive: true, nameEn: "Math" },
      { id: "subject-science", gradeId, isActive: true, nameEn: "Science" },
    ];

    let state = {
      referralCodesByStudentId: new Map<string, { id: string; studentId: string; code: string }>(),
      referralCodesByCode: new Map<string, { id: string; studentId: string; code: string }>(),
      referralsById: new Map<string, any>(),
      referralsByReferredId: new Map<string, any>(),
      studentSubjectsByKey: new Map<string, { studentId: string; subjectId: string; expiresAt: Date | null }>(),
    };
    let codeCounter = 0;
    let referralCounter = 0;

    function client(get: () => typeof state) {
      return {
        studentProfile: { findUnique: async ({ where }: any) => profiles[where.userId] ?? Object.values(profiles).find((p) => p.id === where.id) ?? null },
        gradeSubject: {
          findMany: jest.fn().mockImplementation(async ({ where }: any) =>
            subjects
              .filter((s) => (where.subjectId?.in ? where.subjectId.in.includes(s.id) : true) && s.isActive === where.isActive)
              .map((s) => ({ subject: s })),
          ),
          findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
            subjects
              .filter((s) => where.subjectId.in.includes(s.id) && s.isActive === where.isActive)
              .map((s) => ({ subject: s }))[0] ?? null,
          ),
        },
        subject: {
          // getState resolves display names for ids already granted — by id
          // alone, deliberately not offering-filtered.
          findMany: async ({ where }: any) => subjects.filter((s) => (where.id?.in ? where.id.in.includes(s.id) : true)),
        },
        referralCode: {
          findUnique: async ({ where }: any) => (where.studentId ? get().referralCodesByStudentId.get(where.studentId) : get().referralCodesByCode.get(where.code)) ?? null,
          create: async ({ data }: any) => {
            if (get().referralCodesByStudentId.has(data.studentId)) throw Object.assign(new Error("dup"), { code: "P2002" });
            const row = { id: `code-${++codeCounter}`, studentId: data.studentId, code: data.code };
            get().referralCodesByStudentId.set(data.studentId, row);
            get().referralCodesByCode.set(data.code, row);
            return row;
          },
        },
        referral: {
          findUnique: async ({ where }: any) =>
            where.referredStudentId ? get().referralsByReferredId.get(where.referredStudentId) ?? null : get().referralsById.get(where.id) ?? null,
          findMany: async ({ where }: any) => [...get().referralsById.values()].filter((r) => r.referrerStudentId === where.referrerStudentId),
          create: async ({ data }: any) => {
            if (get().referralsByReferredId.has(data.referredStudentId)) throw Object.assign(new Error("dup"), { code: "P2002" });
            const row = { id: `referral-${++referralCounter}`, earnedAt: null, appliedAt: null, appliedSubjectId: null, appliedExpiresAt: null, createdAt: new Date(), ...data };
            get().referralsById.set(row.id, row);
            get().referralsByReferredId.set(row.referredStudentId, row);
            return row;
          },
          updateMany: async ({ where, data }: any) => {
            const row = get().referralsById.get(where.id);
            if (!row) return { count: 0 };
            if (where.earnedAt === null && row.earnedAt !== null) return { count: 0 };
            if (where.appliedAt === null && row.appliedAt !== null) return { count: 0 };
            if (where.earnedAt?.not !== undefined && row.earnedAt == null) return { count: 0 };
            if (where.referrerStudentId !== undefined && row.referrerStudentId !== where.referrerStudentId) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
          },
        },
        studentSubject: {
          findUnique: async ({ where }: any) => {
            const key = `${where.studentId_subjectId.studentId}:${where.studentId_subjectId.subjectId}`;
            return get().studentSubjectsByKey.get(key) ?? null;
          },
          findMany: async ({ where }: any) => [...get().studentSubjectsByKey.values()].filter((s) => s.studentId === where.studentId),
          upsert: async ({ where, create, update }: any) => {
            const key = `${where.studentId_subjectId.studentId}:${where.studentId_subjectId.subjectId}`;
            const existing = get().studentSubjectsByKey.get(key);
            const row = existing ? { ...existing, ...update } : { ...create };
            get().studentSubjectsByKey.set(key, row);
            return row;
          },
        },
      };
    }

    let mutex = Promise.resolve();
    const db: any = {
      ...client(() => state),
      $transaction: (fn: any) => {
        const run = mutex.then(async () => {
          const draft = {
            referralCodesByStudentId: new Map(state.referralCodesByStudentId),
            referralCodesByCode: new Map(state.referralCodesByCode),
            referralsById: new Map([...state.referralsById].map(([k, v]) => [k, { ...v }])),
            referralsByReferredId: new Map([...state.referralsByReferredId].map(([k, v]) => [k, { ...v }])),
            studentSubjectsByKey: new Map(state.studentSubjectsByKey),
          };
          // referralsById and referralsByReferredId must point at the SAME
          // row objects for updateMany's mutation to be visible either way.
          for (const [id, row] of draft.referralsById) {
            draft.referralsByReferredId.set(row.referredStudentId, row);
          }
          const result = await fn(client(() => draft));
          state = draft;
          return result;
        });
        mutex = run.then(() => undefined, () => undefined);
        return run;
      },
    };

    return { service: new ReferralService({ client: db } as any), state: () => state, subjects, client: db };
  }

  describe("attach", () => {
    it("attaches a referral once", async () => {
      const h = makeHarness();
      const code = await h.service.getOrCreateCode("user-referrer");
      const result = await h.service.attach("user-referred", code);
      expect(result.attached).toBe(true);
    });

    it("rejects self-referral", async () => {
      const h = makeHarness();
      const code = await h.service.getOrCreateCode("user-referrer");
      await expect(h.service.attach("user-referrer", code)).rejects.toThrow(BadRequestException);
    });

    it("rejects an unknown code", async () => {
      const h = makeHarness();
      await expect(h.service.attach("user-referred", "NOSUCHCODE")).rejects.toThrow(BadRequestException);
    });

    it("cannot be changed once attached", async () => {
      const h = makeHarness();
      const code = await h.service.getOrCreateCode("user-referrer");
      await h.service.attach("user-referred", code);
      await expect(h.service.attach("user-referred", code)).rejects.toThrow(ForbiddenException);
    });
  });

  describe("earnRewardWithinTransaction", () => {
    it("marks the reward earned on first activation", async () => {
      const h = makeHarness();
      const code = await h.service.getOrCreateCode("user-referrer");
      await h.service.attach("user-referred", code);

      await h.service.earnRewardWithinTransaction({ referral: (h.service as any).prisma.client.referral } as any, "student-referred");

      const me = await h.service.getMe("user-referrer");
      expect(me.successfulReferrals).toBe(1);
      expect(me.pendingRewards).toHaveLength(1);
    });

    it("a second activation (resubscribe) never rewards twice", async () => {
      const h = makeHarness();
      const code = await h.service.getOrCreateCode("user-referrer");
      await h.service.attach("user-referred", code);
      const referral = (h.service as any).prisma.client.referral;

      await h.service.earnRewardWithinTransaction({ referral } as any, "student-referred");
      const earnedAtFirst = (await h.service.getMe("user-referrer")).pendingRewards[0]?.earnedAt;

      await h.service.earnRewardWithinTransaction({ referral } as any, "student-referred");
      const me = await h.service.getMe("user-referrer");
      expect(me.successfulReferrals).toBe(1);
      expect(me.pendingRewards[0]?.earnedAt).toEqual(earnedAtFirst);
    });

    it("a student who was never referred earns nothing (no-op, never throws)", async () => {
      const h = makeHarness();
      const referral = (h.service as any).prisma.client.referral;
      await expect(h.service.earnRewardWithinTransaction({ referral } as any, "student-nobody-referred")).resolves.toBeUndefined();
    });
  });

  describe("applyReward", () => {
    async function seedEarnedReferral(h: ReturnType<typeof makeHarness>) {
      const code = await h.service.getOrCreateCode("user-referrer");
      await h.service.attach("user-referred", code);
      const referral = (h.service as any).prisma.client.referral;
      await h.service.earnRewardWithinTransaction({ referral } as any, "student-referred");
      const me = await h.service.getMe("user-referrer");
      return me.pendingRewards[0].referralId as string;
    }

    it("offers a shared subject to a grade that does not own its content home", async () => {
      // The referrer's grade is grade-1; shared Arabic's content home is
      // grade-eg-5. Under the old rule it never appeared here at all.
      const h = makeHarness();
      const sharedArabic = { id: "subject-arabic-eg5", gradeId: "grade-eg-5", isActive: true, nameEn: "Arabic", nameAr: "العربية" };
      h.subjects.push(sharedArabic);

      const eligible = await h.service.getEligibleRewardSubjects("user-referrer");

      expect(eligible).toContainEqual({ id: sharedArabic.id, nameEn: "Arabic", nameAr: "العربية" });
      // Proves the rule is now the OFFERING, not subject.gradeId: the service
      // must consult GradeSubject for the student's own grade. Without this the
      // assertion above could pass on a mock that ignores gradeId entirely.
      expect(h.client.gradeSubject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ gradeId: "grade-1" }) }),
      );
    });

    it("grants exactly one Subject +30 days when the referrer has no prior grant", async () => {
      const h = makeHarness();
      const referralId = await seedEarnedReferral(h);

      const before = Date.now();
      const result = await h.service.applyReward("user-referrer", referralId, "subject-math");

      // "+30 days" is CALENDAR arithmetic (applyReward's setDate(+30)), not
      // +30*24h of elapsed time. Across a DST boundary the two differ by an
      // hour — Africa/Cairo drops 03:00 -> 02:00 in late October, which made a
      // pure-millisecond expectation fail for about a month every year. Compare
      // against the same calendar arithmetic so the assertion is DST-safe.
      const expected = new Date(before);
      expected.setDate(expected.getDate() + 30);

      expect(result.subjectId).toBe("subject-math");
      expect(Math.abs(result.expiresAt.getTime() - expected.getTime())).toBeLessThan(5000);
    });

    it("stacks onto an existing non-expired grant (existing expiry + 30 days), never resets to now", async () => {
      const h = makeHarness();
      const referralId = await seedEarnedReferral(h);
      const farFuture = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      h.state().studentSubjectsByKey.set("student-referrer:subject-math", { studentId: "student-referrer", subjectId: "subject-math", expiresAt: farFuture });

      const result = await h.service.applyReward("user-referrer", referralId, "subject-math");
      const expectedMs = farFuture.getTime() + 30 * 24 * 60 * 60 * 1000;
      expect(Math.abs(result.expiresAt.getTime() - expectedMs)).toBeLessThan(5000);
    });

    it("rejects applying to a subject the referrer already permanently owns", async () => {
      const h = makeHarness();
      const referralId = await seedEarnedReferral(h);
      h.state().studentSubjectsByKey.set("student-referrer:subject-math", { studentId: "student-referrer", subjectId: "subject-math", expiresAt: null });

      await expect(h.service.applyReward("user-referrer", referralId, "subject-math")).rejects.toThrow(BadRequestException);
    });

    it("rejects applying a reward that hasn't been earned yet", async () => {
      const h = makeHarness();
      const code = await h.service.getOrCreateCode("user-referrer");
      await h.service.attach("user-referred", code);
      const me = await h.service.getMe("user-referrer");
      const unearnedReferralId = h.state().referralsByReferredId.get("student-referred")!.id;
      expect(me.pendingRewards).toHaveLength(0);

      await expect(h.service.applyReward("user-referrer", unearnedReferralId, "subject-math")).rejects.toThrow(ForbiddenException);
    });

    it("cannot apply the same reward twice, even concurrently — exactly one Subject grant results", async () => {
      const h = makeHarness();
      const referralId = await seedEarnedReferral(h);

      const results = await Promise.allSettled([
        h.service.applyReward("user-referrer", referralId, "subject-math"),
        h.service.applyReward("user-referrer", referralId, "subject-science"),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled.length).toBe(1);
    });
  });
});
