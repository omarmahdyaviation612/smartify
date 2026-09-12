import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AIProviderFactory } from "../../ai/ai-provider.factory";
import { BadRequestException } from "@nestjs/common";
import pdf from "pdf-parse";

@Injectable()
export class AdminCurriculumService {
  constructor(private readonly prisma: PrismaService, private readonly ai: AIProviderFactory) {}

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

  async createMaterial(topicId: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    const topic = await this.prisma.client.topic.findUnique({ where: { id: topicId }, include: { unit: true } });
    if (!topic) throw new BadRequestException("Topic not found.");
    return this.prisma.client.learningMaterial.create({
      data: { topicId, subjectId: topic.unit.subjectId, originalName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, contentText: file.buffer.toString("utf8") },
    });
  }

  async importSubjectMaterial(subjectId: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    const subject = await this.prisma.client.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new BadRequestException("Subject not found.");
    const extracted = file.mimetype === "application/pdf" ? (await pdf(file.buffer)).text : file.buffer.toString("utf8");
    if (!extracted.trim()) throw new BadRequestException("The material contains no readable text.");
    const { provider } = await this.ai.getActiveProvider();
    const result = await provider.generate({
      systemPrompt: "Divide the provided subject material into 3-12 educational topics. Return JSON only: {\"topics\":[{\"nameEn\":\"...\",\"nameAr\":\"...\",\"summaryEn\":\"...\",\"summaryAr\":\"...\"}]}",
      messages: [{ role: "user", content: extracted.slice(0, 50000) }],
      maxOutputTokens: 1800,
    });
    let topics: Array<{ nameEn: string; nameAr: string; summaryEn: string; summaryAr: string }>;
    try { topics = JSON.parse(result.content).topics; } catch { throw new BadRequestException("AI returned an invalid topic structure."); }
    if (!Array.isArray(topics) || topics.length === 0) throw new BadRequestException("AI did not detect any topics.");
    const unit = await this.prisma.client.unit.create({ data: { subjectId, nameEn: "Imported material", nameAr: "مادة مستوردة", order: 999 } });
    const created = await Promise.all(topics.map((t, i) => this.prisma.client.topic.create({ data: { unitId: unit.id, nameEn: t.nameEn, nameAr: t.nameAr, order: i + 1 } })));
    await this.prisma.client.learningMaterial.create({ data: { subjectId, originalName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, contentText: extracted } });
    return { unitId: unit.id, topics: created };
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
