import { ForbiddenException } from "@nestjs/common";
import { HomeworkService } from "./homework.service";

describe("HomeworkService", () => {
  const profile = { id: "student-1", userId: "user-1", curriculumId: "curr-1", gradeId: "grade-1", subjects: [{ subjectId: "subject-1" }] };
  function harness(options: { addon?: boolean; extracted?: any; candidates?: any[]; contentSubjectId?: string } = {}) {
    const prisma: any = { client: {
      studentProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
      subscription: { findUnique: jest.fn().mockResolvedValue({ status: "active", homeworkAddonActive: options.addon ?? true, homeworkAddonMonthlyAllowance: 10, currentPeriodStart: new Date("2026-10-01"), currentPeriodEnd: new Date("2026-11-01") }) },
      homeworkSession: { create: jest.fn().mockResolvedValue({ id: "session-1" }), update: jest.fn().mockResolvedValue({}), delete: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    } };
    const matcher: any = { eligibleSubjects: jest.fn().mockResolvedValue({ profile, subjects: [{ id: "subject-1", nameEn: "Math", nameAr: "رياضيات" }] }),
      requireSubject: jest.fn().mockResolvedValue({ profile, contentSubjectId: options.contentSubjectId ?? "subject-1" }),
      findGroundedCandidates: jest.fn().mockResolvedValue(options.candidates ?? []) };
    const quota: any = { reserveExercise: jest.fn().mockResolvedValue({ reserved: true }), refundReservation: jest.fn().mockResolvedValue(true),
      getStatus: jest.fn().mockResolvedValue({ limit: 10, used: 0, reserved: 1, remaining: 9, periodEnd: new Date("2026-11-01") }) };
    const image: any = { extract: jest.fn().mockResolvedValue(options.extracted ?? { readable: false, question: "", topicQuery: "" }) };
    const providers: any = { getActiveProvider: jest.fn() }; const usage: any = {};
    const service = new HomeworkService(prisma, matcher, quota, image, providers, usage);
    return { service, prisma, matcher, quota, image, providers };
  }

  it("keeps add-on access disabled until verified billing activates it", async () => {
    const h = harness({ addon: false });
    await expect(h.service.upload("user-1", "subject-1", { buffer: Buffer.from("x"), mimetype: "image/png", size: 1 })).rejects.toThrow(ForbiddenException);
    expect(h.quota.reserveExercise).not.toHaveBeenCalled();
    expect(h.image.extract).not.toHaveBeenCalled();
  });

  it("refunds unreadable photos and persists no image bytes", async () => {
    const h = harness(); const photo = { buffer: Buffer.from("private-photo"), mimetype: "image/png", size: 13 };
    const result = await h.service.upload("user-1", "subject-1", photo);
    expect(result.status).toBe("UNSUPPORTED");
    expect(h.quota.refundReservation).toHaveBeenCalledWith("student-1", "session-1");
    expect(h.prisma.client.homeworkSession.create.mock.calls[0][0].data).not.toHaveProperty("image");
    expect(JSON.stringify(h.prisma.client.homeworkSession.create.mock.calls[0][0].data)).not.toContain("private-photo");
  });

  it("keeps the student's selected curriculum subject while using its linked shared source subject", async () => {
    const h = harness({ contentSubjectId: "moe-arabic-y5", extracted: { readable: true, question: "اقرأ الفقرة", topicQuery: "القراءة" }, candidates: [{ id: "topic-1", nameAr: "القراءة", nameEn: "Reading" }] });
    await h.service.upload("user-1", "british-arabic-y5", { buffer: Buffer.from("photo"), mimetype: "image/png", size: 5 });
    expect(h.prisma.client.homeworkSession.create.mock.calls[0][0].data).toMatchObject({ subjectId: "moe-arabic-y5", accessSubjectId: "british-arabic-y5", gradeId: "grade-1", curriculumId: "curr-1" });
    expect(h.matcher.findGroundedCandidates).toHaveBeenCalledWith("moe-arabic-y5", "القراءة");
  });

  it("never asks the provider to coach before a grounded topic is confirmed", async () => {
    const h = harness();
    h.prisma.client.homeworkSession.findFirst = jest.fn().mockResolvedValue({ id: "session-1", studentId: "student-1", status: "AWAITING_TOPIC_CONFIRMATION", topic: null });
    await expect(h.service.turn("user-1", "session-1", { kind: "HELP", message: "hint" })).rejects.toThrow(/Confirm a grounded topic/);
    expect(h.providers.getActiveProvider).not.toHaveBeenCalled();
  });
});
