import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

type CacheScope = {
  curriculumId: string;
  gradeId: string;
  subjectId: string;
  topicId?: string;
  language: string;
  prompt: string;
};

@Injectable()
export class TutorAnswerCacheService {
  constructor(private readonly prisma: PrismaService) {}

  normalizePrompt(prompt: string) {
    return prompt.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  }

  async find(scope: CacheScope) {
    return this.prisma.client.tutorAnswerCache.findFirst({
      where: {
        curriculumId: scope.curriculumId,
        gradeId: scope.gradeId,
        subjectId: scope.subjectId,
        topicId: scope.topicId ?? null,
        language: scope.language,
        normalizedPrompt: this.normalizePrompt(scope.prompt),
      },
      select: { answer: true },
    });
  }

  async save(params: CacheScope & { answer: string; provider: string; model: string }) {
    const normalizedPrompt = this.normalizePrompt(params.prompt);
    const existing = await this.prisma.client.tutorAnswerCache.findFirst({
      where: {
        curriculumId: params.curriculumId,
        gradeId: params.gradeId,
        subjectId: params.subjectId,
        topicId: params.topicId ?? null,
        language: params.language,
        normalizedPrompt,
      },
    });
    if (existing) {
      await this.prisma.client.tutorAnswerCache.update({
        where: { id: existing.id },
        data: { answer: params.answer, provider: params.provider, model: params.model },
      });
      return;
    }
    await this.prisma.client.tutorAnswerCache.create({
      data: {
        curriculumId: params.curriculumId,
        gradeId: params.gradeId,
        subjectId: params.subjectId,
        topicId: params.topicId,
        language: params.language,
        normalizedPrompt,
        answer: params.answer,
        provider: params.provider,
        model: params.model,
      },
    });
  }
}
