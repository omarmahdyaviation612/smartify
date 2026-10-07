import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const ALLOWED_STATUSES = new Set(["CONTACTED", "CONFIRMED", "DECLINED"]);

@Injectable()
export class TeacherRequestsService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): any { return this.prisma.client as any; }

  async create(parentUserId: string, input: { studentId: string; subjectId: string; topicId?: string; preferredTimes: string; contactNote?: string }) {
    const parent = await this.db.parentProfile.findUnique({ where: { userId: parentUserId }, select: { id: true } });
    if (!parent) throw new NotFoundException("Parent profile not found.");
    const link = await this.db.parentStudentRelation.findUnique({ where: { parentId_studentId: { parentId: parent.id, studentId: input.studentId } }, include: { student: { select: { id: true, gradeId: true, curriculumId: true } } } });
    if (!link) throw new ForbiddenException("This child is not linked to your account.");
    const preferredTimes = input?.preferredTimes?.trim();
    const contactNote = input?.contactNote?.trim() || null;
    if (!preferredTimes || preferredTimes.length > 1000 || (contactNote && contactNote.length > 1000)) throw new BadRequestException("Provide preferred times and keep each note under 1000 characters.");
    const subject = await this.db.subject.findFirst({ where: { id: input?.subjectId, isActive: true, gradeId: link.student.gradeId, grade: { curriculumId: link.student.curriculumId, isActive: true, curriculum: { isActive: true } } }, select: { id: true, sharedContentSubjectId: true } });
    if (!subject) throw new BadRequestException("Choose an active subject from the child's curriculum and grade.");
    if (input.topicId) {
      const topic = await this.db.topic.findFirst({ where: { id: input?.topicId, unit: { subjectId: { in: [subject.id, subject.sharedContentSubjectId].filter(Boolean) } } }, select: { id: true } });
      if (!topic) throw new BadRequestException("The selected topic does not belong to this subject.");
    }
    return this.db.teacherSessionRequest.create({ data: { parentId: parent.id, studentId: link.student.id, subjectId: subject.id, topicId: input?.topicId || null, preferredTimes, contactNote }, select: this.publicSelect });
  }

  async listMine(parentUserId: string) {
    const parent = await this.db.parentProfile.findUnique({ where: { userId: parentUserId }, select: { id: true } });
    if (!parent) throw new NotFoundException("Parent profile not found.");
    return this.db.teacherSessionRequest.findMany({ where: { parentId: parent.id }, orderBy: { createdAt: "desc" }, select: this.publicSelect });
  }

  async listForAdmin() {
    return this.db.teacherSessionRequest.findMany({ orderBy: [{ status: "asc" }, { createdAt: "asc" }], take: 200, select: { ...this.publicSelect, adminNote: true } });
  }

  async updateStatus(id: string, status: string, adminNote?: string) {
    if (!ALLOWED_STATUSES.has(status)) throw new BadRequestException("Choose a valid review status.");
    if (adminNote && adminNote.trim().length > 1000) throw new BadRequestException("Admin note must be under 1000 characters.");
    const current = await this.db.teacherSessionRequest.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!current) throw new NotFoundException("Request not found.");
    if (current.status === "CONFIRMED" || current.status === "DECLINED") throw new BadRequestException("This request has already been finalized.");
    const updated = await this.db.teacherSessionRequest.updateMany({ where: { id, status: current.status }, data: { status, adminNote: adminNote?.trim() || null } });
    if (updated.count !== 1) throw new BadRequestException("The request changed; refresh and try again.");
    return this.db.teacherSessionRequest.findUnique({ where: { id }, select: { ...this.publicSelect, adminNote: true } });
  }

  private readonly publicSelect = {
    id: true, studentId: true, subjectId: true, topicId: true, preferredTimes: true, contactNote: true, status: true, createdAt: true, updatedAt: true,
    student: { select: { fullName: true } }, subject: { select: { nameEn: true, nameAr: true } }, topic: { select: { nameEn: true, nameAr: true } },
  };
}
