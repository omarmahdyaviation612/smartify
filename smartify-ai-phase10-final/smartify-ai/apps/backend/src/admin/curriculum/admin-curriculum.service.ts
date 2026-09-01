import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AdminCurriculumService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Curricula ----
  listCurricula() {
    return this.prisma.client.curriculum.findMany({ orderBy: { code: "asc" } });
  }

  updateCurriculum(id: string, data: { nameEn?: string; nameAr?: string; isActive?: boolean }) {
    return this.prisma.client.curriculum.update({ where: { id }, data });
  }

  // ---- Grades ----
  listGrades(curriculumId: string) {
    return this.prisma.client.grade.findMany({ where: { curriculumId }, orderBy: { level: "asc" } });
  }

  createGrade(curriculumId: string, data: { nameEn: string; nameAr: string; level: number }) {
    return this.prisma.client.grade.create({ data: { curriculumId, ...data } });
  }

  updateGrade(id: string, data: { nameEn?: string; nameAr?: string; level?: number; isActive?: boolean }) {
    return this.prisma.client.grade.update({ where: { id }, data });
  }

  // ---- Subjects ----
  listSubjects(gradeId: string) {
    return this.prisma.client.subject.findMany({ where: { gradeId } });
  }

  createSubject(gradeId: string, data: { nameEn: string; nameAr: string; icon?: string }) {
    return this.prisma.client.subject.create({ data: { gradeId, ...data } });
  }

  updateSubject(id: string, data: { nameEn?: string; nameAr?: string; icon?: string; isActive?: boolean }) {
    return this.prisma.client.subject.update({ where: { id }, data });
  }

  listTopics(subjectId: string) {
    return this.prisma.client.topic.findMany({ where: { unit: { subjectId } }, include: { unit: true }, orderBy: [{ unit: { order: "asc" } }, { order: "asc" }] });
  }

  listMaterials(topicId: string) {
    return this.prisma.client.learningMaterial.findMany({ where: { topicId }, orderBy: { createdAt: "desc" }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } });
  }

  createMaterial(topicId: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    return this.prisma.client.learningMaterial.create({
      data: { topicId, originalName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, contentText: file.buffer.toString("utf8") },
    });
  }

  deleteMaterial(id: string) {
    return this.prisma.client.learningMaterial.delete({ where: { id } });
  }

  // ---- Pricing plans (SUPER_ADMIN/ADMIN only — enforced at the controller level, not here) ----
  listPricingPlans(curriculumId?: string) {
    return this.prisma.client.pricingPlan.findMany({
      where: curriculumId ? { curriculumId } : undefined,
      orderBy: { monthlyPriceEGP: "asc" },
      include: { curriculum: true },
    });
  }

  async updatePricingPlan(
    id: string,
    data: { monthlyPriceEGP?: number; includedSubjects?: number; additionalSubjectPriceEGP?: number; isActive?: boolean },
  ) {
    const existing = await this.prisma.client.pricingPlan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Pricing plan not found.");
    return this.prisma.client.pricingPlan.update({ where: { id }, data });
  }
}
