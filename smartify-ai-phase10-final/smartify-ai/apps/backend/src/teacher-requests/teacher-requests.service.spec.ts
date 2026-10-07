import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { TeacherRequestsService } from "./teacher-requests.service";

function harness() {
  const parent = { id: "parent-1" };
  const student = { id: "student-1", gradeId: "grade-1", curriculumId: "curriculum-1" };
  const prisma: any = { client: {
    parentProfile: { findUnique: jest.fn().mockResolvedValue(parent) },
    parentStudentRelation: { findUnique: jest.fn().mockResolvedValue({ student }) },
    subject: { findFirst: jest.fn().mockResolvedValue({ id: "subject-1", sharedContentSubjectId: null }) },
    topic: { findFirst: jest.fn().mockResolvedValue({ id: "topic-1" }) },
    teacherSessionRequest: { create: jest.fn().mockResolvedValue({ id: "request-1", status: "PENDING" }), findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue({ id: "request-1", status: "PENDING" }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  } };
  return { service: new TeacherRequestsService(prisma), prisma: prisma.client };
}

describe("TeacherRequestsService", () => {
  it("creates a pending request after verifying linked child and subject scope", async () => {
    const { service, prisma } = harness();
    await service.create("parent-user", { studentId: "student-1", subjectId: "subject-1", preferredTimes: "Weekday evenings" });
    expect(prisma.parentStudentRelation.findUnique).toHaveBeenCalled();
    expect(prisma.teacherSessionRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ preferredTimes: "Weekday evenings" }) }));
    expect(prisma.teacherSessionRequest.create.mock.calls[0][0].data).not.toHaveProperty("status");
  });
  it("does not create a request for an unrelated child", async () => {
    const { service, prisma } = harness();
    prisma.parentStudentRelation.findUnique.mockResolvedValue(null);
    await expect(service.create("parent-user", { studentId: "other", subjectId: "subject-1", preferredTimes: "Any" })).rejects.toThrow(ForbiddenException);
    expect(prisma.subject.findFirst).not.toHaveBeenCalled();
  });
  it("rejects invalid and final status transitions", async () => {
    const { service, prisma } = harness();
    await expect(service.updateStatus("request-1", "PENDING")).rejects.toThrow(BadRequestException);
    prisma.teacherSessionRequest.findUnique.mockResolvedValue({ id: "request-1", status: "CONFIRMED" });
    await expect(service.updateStatus("request-1", "CONTACTED")).rejects.toThrow(BadRequestException);
    expect(prisma.teacherSessionRequest.updateMany).not.toHaveBeenCalled();
  });
});
