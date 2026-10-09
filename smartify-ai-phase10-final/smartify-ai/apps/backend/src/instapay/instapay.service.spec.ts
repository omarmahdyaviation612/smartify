import { InstapayService } from "./instapay.service";

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const NOT_AN_IMAGE = Buffer.from("this is just text, not an image", "utf8");

function setup(adminAlert?: any) {
  const state = {
    profiles: { user1: { id: "profile1", userId: "user1" }, user2: { id: "profile2", userId: "user2" } } as Record<string, any>,
    subscriptions: [] as any[],
    packs: [] as any[],
    submissions: [] as any[],
  };
  const prisma = {
    client: {
      studentProfile: { findUnique: async ({ where }: any) => state.profiles[where.userId] ?? null },
      subscription: { findFirst: async ({ where }: any) => state.subscriptions.find((s) => s.studentId === where.studentId && s.paymentProvider === where.paymentProvider && s.externalSubscriptionId === where.externalSubscriptionId) ?? null },
      tutorQuestionPackPurchase: { findFirst: async ({ where }: any) => state.packs.find((p) => p.studentId === where.studentId && p.paymentProvider === where.paymentProvider && p.externalSessionId === where.externalSessionId) ?? null },
      instapayPaymentSubmission: {
        create: async ({ data }: any) => {
          if (state.submissions.some((s) => s.referenceId === data.referenceId)) {
            throw Object.assign(Error("duplicate"), { code: "P2002" });
          }
          const row = { id: `sub-${state.submissions.length + 1}`, status: "PENDING_VERIFICATION", createdAt: new Date(), ...data };
          state.submissions.push(row);
          return row;
        },
        findMany: async ({ where, select }: any) => {
          const rows = state.submissions.filter((s) => s.studentId === where.studentId);
          if (!select) return rows;
          return rows.map((row) => Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]])));
        },
      },
    },
  } as any;
  const service = new InstapayService(prisma, {} as any, {} as any, adminAlert);
  return { service, state };
}

describe("InstapayService.submitReceipt", () => {
  it("rejects a non-image mimetype even if the extension looks right", async () => {
    const { service, state } = setup();
    state.subscriptions.push({ id: "sub1", studentId: "profile1", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-AAAAAAAA", monthlyTotalEGP: 500 });
    await expect(
      service.submitReceipt("user1", { referenceId: "SMAI-S-AAAAAAAA", submittedAmountEGP: 500 }, { mimetype: "application/pdf", size: 100, buffer: NOT_AN_IMAGE }),
    ).rejects.toThrow("Only JPEG or PNG");
  });

  it("rejects a spoofed mimetype whose bytes are not actually an image", async () => {
    const { service, state } = setup();
    state.subscriptions.push({ id: "sub1", studentId: "profile1", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-AAAAAAAA", monthlyTotalEGP: 500 });
    await expect(
      service.submitReceipt("user1", { referenceId: "SMAI-S-AAAAAAAA", submittedAmountEGP: 500 }, { mimetype: "image/jpeg", size: NOT_AN_IMAGE.length, buffer: NOT_AN_IMAGE }),
    ).rejects.toThrow("not a valid JPEG or PNG");
  });

  it("rejects an oversized file", async () => {
    const { service, state } = setup();
    state.subscriptions.push({ id: "sub1", studentId: "profile1", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-AAAAAAAA", monthlyTotalEGP: 500 });
    await expect(
      service.submitReceipt("user1", { referenceId: "SMAI-S-AAAAAAAA", submittedAmountEGP: 500 }, { mimetype: "image/jpeg", size: 6 * 1024 * 1024, buffer: JPEG_HEADER }),
    ).rejects.toThrow("smaller than 5 MB");
  });

  it("rejects a reference that does not belong to the caller", async () => {
    const { service, state } = setup();
    state.subscriptions.push({ id: "sub1", studentId: "SOMEONE_ELSE", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-AAAAAAAA", monthlyTotalEGP: 500 });
    await expect(
      service.submitReceipt("user1", { referenceId: "SMAI-S-AAAAAAAA", submittedAmountEGP: 500 }, { mimetype: "image/jpeg", size: JPEG_HEADER.length, buffer: JPEG_HEADER }),
    ).rejects.toThrow("does not belong to your account");
  });

  it("accepts a valid PNG receipt against the caller's own subscription reference", async () => {
    const { service, state } = setup();
    state.subscriptions.push({ id: "sub1", studentId: "profile1", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-AAAAAAAA", monthlyTotalEGP: 500 });
    const result = await service.submitReceipt(
      "user1",
      { referenceId: "SMAI-S-AAAAAAAA", submittedAmountEGP: 500, senderName: "Omar" },
      { mimetype: "image/png", size: PNG_HEADER.length, buffer: PNG_HEADER },
    );
    expect(result.status).toBe("PENDING_VERIFICATION");
    expect(state.submissions[0].kind).toBe("SUBSCRIPTION");
  });

  it("accepts a valid receipt against the caller's own question-pack reference", async () => {
    const { service, state } = setup();
    state.packs.push({ id: "pack1", studentId: "profile1", paymentProvider: "instapay", externalSessionId: "SMAI-P-BBBBBBBB", amountEGP: 50 });
    const result = await service.submitReceipt(
      "user1",
      { referenceId: "SMAI-P-BBBBBBBB", submittedAmountEGP: 50 },
      { mimetype: "image/jpeg", size: JPEG_HEADER.length, buffer: JPEG_HEADER },
    );
    expect(result.status).toBe("PENDING_VERIFICATION");
    expect(state.submissions[0].kind).toBe("QUESTION_PACK");
  });

  it("rejects a second receipt submitted against an already-used reference", async () => {
    const { service, state } = setup();
    state.subscriptions.push({ id: "sub1", studentId: "profile1", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-AAAAAAAA", monthlyTotalEGP: 500 });
    await service.submitReceipt("user1", { referenceId: "SMAI-S-AAAAAAAA", submittedAmountEGP: 500 }, { mimetype: "image/jpeg", size: JPEG_HEADER.length, buffer: JPEG_HEADER });
    await expect(
      service.submitReceipt("user1", { referenceId: "SMAI-S-AAAAAAAA", submittedAmountEGP: 500 }, { mimetype: "image/jpeg", size: JPEG_HEADER.length, buffer: JPEG_HEADER }),
    ).rejects.toThrow("already been submitted");
  });

  it("alerts the admins once per accepted receipt, and not for a rejected one", async () => {
    const alerts: any[] = [];
    const { service, state } = setup({ notifyNewSubmission: async (x: any) => { alerts.push(x); } });
    state.profiles.user1.fullName = "Omar";
    state.subscriptions.push({ id: "sub1", studentId: "profile1", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-AAAAAAAA", monthlyTotalEGP: 500 });
    await service.submitReceipt("user1", { referenceId: "SMAI-S-AAAAAAAA", submittedAmountEGP: 450, senderName: "O" }, { mimetype: "image/png", size: PNG_HEADER.length, buffer: PNG_HEADER });
    await expect(
      service.submitReceipt("user1", { referenceId: "SMAI-S-AAAAAAAA", submittedAmountEGP: 0 }, { mimetype: "image/png", size: PNG_HEADER.length, buffer: PNG_HEADER }),
    ).rejects.toThrow();
    expect(alerts).toEqual([
      expect.objectContaining({ submissionId: "sub-1", kind: "SUBSCRIPTION", expectedAmountEGP: 500, submittedAmountEGP: 450, studentName: "Omar", senderName: "O" }),
    ]);
  });

  it("rejects a missing file", async () => {
    const { service, state } = setup();
    state.subscriptions.push({ id: "sub1", studentId: "profile1", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-AAAAAAAA", monthlyTotalEGP: 500 });
    await expect(
      service.submitReceipt("user1", { referenceId: "SMAI-S-AAAAAAAA", submittedAmountEGP: 500 }, undefined),
    ).rejects.toThrow("Upload a receipt image.");
  });

  it("rejects a non-positive submitted amount", async () => {
    const { service, state } = setup();
    state.subscriptions.push({ id: "sub1", studentId: "profile1", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-AAAAAAAA", monthlyTotalEGP: 500 });
    await expect(
      service.submitReceipt("user1", { referenceId: "SMAI-S-AAAAAAAA", submittedAmountEGP: 0 }, { mimetype: "image/jpeg", size: JPEG_HEADER.length, buffer: JPEG_HEADER }),
    ).rejects.toThrow("amount you actually transferred");
  });
});

describe("InstapayService.listMine — privacy/access", () => {
  it("returns only the caller's own submissions, never another student's", async () => {
    const { service, state } = setup();
    state.subscriptions.push(
      { id: "sub1", studentId: "profile1", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-MINE0001", monthlyTotalEGP: 500 },
      { id: "sub2", studentId: "profile2", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-OTHER001", monthlyTotalEGP: 500 },
    );
    await service.submitReceipt("user1", { referenceId: "SMAI-S-MINE0001", submittedAmountEGP: 500 }, { mimetype: "image/jpeg", size: JPEG_HEADER.length, buffer: JPEG_HEADER });
    await service.submitReceipt("user2", { referenceId: "SMAI-S-OTHER001", submittedAmountEGP: 500 }, { mimetype: "image/png", size: PNG_HEADER.length, buffer: PNG_HEADER });

    const mine = await service.listMine("user1");
    expect(mine).toHaveLength(1);
    expect(mine[0].referenceId).toBe("SMAI-S-MINE0001");
  });

  it("never includes receipt bytes or mimetype in the returned shape", async () => {
    const { service, state } = setup();
    state.subscriptions.push({ id: "sub1", studentId: "profile1", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-AAAAAAAA", monthlyTotalEGP: 500 });
    await service.submitReceipt("user1", { referenceId: "SMAI-S-AAAAAAAA", submittedAmountEGP: 500 }, { mimetype: "image/jpeg", size: JPEG_HEADER.length, buffer: JPEG_HEADER });

    const mine = await service.listMine("user1");
    expect(mine[0]).not.toHaveProperty("receiptImage");
    expect(mine[0]).not.toHaveProperty("receiptMimeType");
  });

  it("returns an empty list rather than throwing for a user with no student profile yet", async () => {
    const { service } = setup();
    await expect(service.listMine("no-such-user")).resolves.toEqual([]);
  });
});

describe("InstapayService.isConfigured", () => {
  const requiredEnv = {
    DATABASE_URL: "postgresql://test:test@localhost:5432/smartify_test",
    REDIS_URL: "redis://localhost:6379",
    CLERK_SECRET_KEY: "sk_test_unit",
    CLERK_PUBLISHABLE_KEY: "pk_test_unit",
    CLERK_WEBHOOK_SIGNING_SECRET: "whsec_test_unit",
    FRONTEND_URL: "http://localhost:3000",
  };
  const originalEnv = { ...process.env };
  afterEach(() => { process.env = { ...originalEnv }; });

  it("is false when recipient env vars are unset", () => {
    process.env = { ...originalEnv, ...requiredEnv, INSTAPAY_RECIPIENT_NAME: "", INSTAPAY_RECIPIENT_HANDLE: "" };
    const { service } = setup();
    expect(service.isConfigured()).toBe(false);
  });

  it("is true once recipient name and handle are set", () => {
    process.env = { ...originalEnv, ...requiredEnv, INSTAPAY_RECIPIENT_NAME: "Smartify AI", INSTAPAY_RECIPIENT_HANDLE: "01000000000" };
    const { service } = setup();
    expect(service.isConfigured()).toBe(true);
  });
});
