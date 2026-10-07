import { ResultNotificationService } from "./result-notification.service";

describe("ResultNotificationService", () => {
  function setup(existing?: any) {
    const prisma = { client: {
      parentStudentRelation: { findMany: jest.fn().mockResolvedValue([{
        parentId: "parent-1",
        parent: { notificationLocale: "ar", user: { email: "parent@example.test" } },
      }]) },
      parentResultNotification: {
        upsert: jest.fn().mockResolvedValue(existing ?? { id: "delivery-1", emailStatus: "PENDING" }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
    } } as any;
    const email = { send: jest.fn().mockResolvedValue({ sent: true }) } as any;
    return { service: new ResultNotificationService(prisma, email), prisma, email };
  }

  it("sends the approved four result fields to linked parents by email only", async () => {
    const { service, prisma, email } = setup();
    await service.notifyResult({
      eventKey: "quiz:result-1",
      studentId: "student-1",
      studentName: "Student Name",
      subjectNames: { en: ["Science"], ar: ["العلوم"] },
      score: 73,
      completedAt: new Date("2026-10-07T10:30:00Z"),
      quizResultId: "result-1",
    });

    expect(prisma.client.parentStudentRelation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { studentId: "student-1" } }));
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: "parent@example.test" }));
    const payload = JSON.stringify(email.send.mock.calls[0][0]);
    expect(payload).toContain("Student Name");
    expect(payload).toContain("73%");
    expect(payload).toContain("العلوم");
    expect(payload).toContain("٢٠٢٦");
    expect(Object.keys(prisma.client.parentResultNotification.upsert.mock.calls[0][0].create.summaryJson).sort())
      .toEqual(["completedAt", "score", "studentName", "subject"]);
    expect(payload).not.toMatch(/question|answer|explanation|conversation|correctCount|totalQuestions/i);
  });

  it("does not resend a result already delivered by email", async () => {
    const { service, email } = setup({ id: "delivery-1", emailStatus: "SENT" });
    await service.notifyResult({
      eventKey: "practice:batch-1", studentId: "student-1", studentName: "Student Name",
      subjectNames: { en: ["Science"], ar: ["العلوم"] }, score: 100,
      completedAt: new Date("2026-10-07T10:30:00Z"), practiceSubmissionId: "batch-1",
    });
    expect(email.send).not.toHaveBeenCalled();
  });
});
