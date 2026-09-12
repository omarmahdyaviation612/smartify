import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ClerkAuthGuard } from "../../auth/clerk-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "@smartify/shared-types";
import { AdminCurriculumService } from "./admin-curriculum.service";
import { updateCurriculumSchema, updateGradeSchema, updatePricingPlanSchema, updateSubjectSchema } from "@smartify/validation";
import { parseBody } from "../../common/validation/parse-body";
import { uploadOptions } from "./upload-options";

// Curriculum/content CRUD: CONTENT_MANAGER can fully manage content but
// NOT pricing — pricing endpoints are further restricted to SUPER_ADMIN/
// ADMIN only, enforced per-route below rather than at the controller level.
@Controller("admin/curriculum")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.CONTENT_MANAGER)
export class AdminCurriculumController {
  constructor(private readonly service: AdminCurriculumService) {}

  @Get("curricula")
  listCurricula() {
    return this.service.listCurricula();
  }

  @Patch("curricula/:id")
  updateCurriculum(@Param("id") id: string, @Body() body: unknown) {
    return this.service.updateCurriculum(id, parseBody(updateCurriculumSchema, body));
  }

  @Get("grades")
  listGrades(@Query("curriculumId") curriculumId: string) {
    return this.service.listGrades(curriculumId);
  }

  @Post("grades")
  createGrade(@Body() body: { curriculumId: string; nameEn: string; nameAr: string; level: number }) {
    return this.service.createGrade(body.curriculumId, body);
  }

  @Patch("grades/:id")
  updateGrade(@Param("id") id: string, @Body() body: unknown) {
    return this.service.updateGrade(id, parseBody(updateGradeSchema, body));
  }

  @Get("subjects")
  listSubjects(@Query("gradeId") gradeId: string) {
    return this.service.listSubjects(gradeId);
  }

  @Post("subjects")
  createSubject(@Body() body: { gradeId: string; nameEn: string; nameAr: string; icon?: string }) {
    return this.service.createSubject(body.gradeId, body);
  }

  @Patch("subjects/:id")
  updateSubject(@Param("id") id: string, @Body() body: unknown) {
    return this.service.updateSubject(id, parseBody(updateSubjectSchema, body));
  }

  @Get("topics")
  listTopics(@Query("subjectId") subjectId: string) {
    return this.service.listTopics(subjectId);
  }

  @Get("materials")
  listMaterials(@Query("topicId") topicId: string) {
    return this.service.listMaterials(topicId);
  }

  @Post("materials")
  @UseInterceptors(FileInterceptor("file", uploadOptions))
  uploadMaterial(@UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, @Body("topicId") topicId: string) {
    if (file?.mimetype === "application/pdf") return this.service.importSubjectMaterial(file as never, file);
    if (!file) throw new BadRequestException("Upload a text material file.");
    const allowed = ["text/plain", "text/markdown", "application/json"];
    if (!allowed.includes(file.mimetype)) throw new BadRequestException("Only TXT, Markdown, or JSON text files are supported; images are ignored.");
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException("Material must be smaller than 5 MB.");
    if (file.buffer.includes(0)) throw new BadRequestException("Material must contain UTF-8 text, not binary data.");
    const text = file.buffer.toString("utf8");
    if (Buffer.from(text, "utf8").compare(file.buffer) !== 0 || text.includes("�")) {
      throw new BadRequestException("Material must be valid UTF-8 text.");
    }
    if (file.mimetype === "application/json") {
      try { JSON.parse(text); } catch { throw new BadRequestException("JSON material must contain valid JSON."); }
    }
    return this.service.createMaterial(topicId, file);
  }

  @Post("subject-materials")
  @UseInterceptors(FileInterceptor("file", uploadOptions))
  uploadSubjectMaterial(@UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, @Body("subjectId") subjectId: string) {
    if (!file || !subjectId) throw new BadRequestException("Choose a subject and upload a PDF.");
    if (file.mimetype !== "application/pdf") throw new BadRequestException("Only PDF subject materials are supported.");
    if (file.size > 25 * 1024 * 1024) throw new BadRequestException("PDF must be smaller than 25 MB.");
    return this.service.importSubjectMaterial(subjectId, file);
  }

  @Delete("materials/:id")
  deleteMaterial(@Param("id") id: string) {
    return this.service.deleteMaterial(id);
  }

  // Pricing — financial data, restricted further than the controller default.
  @Get("pricing-plans")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  listPricingPlans(@Query("curriculumId") curriculumId?: string) {
    return this.service.listPricingPlans(curriculumId);
  }

  @Patch("pricing-plans/:id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  updatePricingPlan(@Param("id") id: string, @Body() body: unknown) {
    return this.service.updatePricingPlan(id, parseBody(updatePricingPlanSchema, body));
  }
}
