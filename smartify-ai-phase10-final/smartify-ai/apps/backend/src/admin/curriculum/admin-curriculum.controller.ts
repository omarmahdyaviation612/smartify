import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ClerkAuthGuard } from "../../auth/clerk-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "@smartify/shared-types";
import { AdminCurriculumService } from "./admin-curriculum.service";
import { confirmExtraBookStructureSchema, confirmSubjectStructureSchema, createSharedSubjectAliasSchema, sharedSubjectContentSchema, updateCurriculumSchema, updateGradeSchema, updatePricingPlanSchema, updateSubjectSchema } from "@smartify/validation";
import { parseBody } from "../../common/validation/parse-body";
import { uploadOptions, textbookUploadOptions } from "./upload-options";

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

  // Read-only curriculum/content status dashboard — metadata only, never
  // groundingNotesJson/teachingStepsJson content. Uses the controller's
  // default @Roles (SUPER_ADMIN, ADMIN, CONTENT_MANAGER) — no narrower
  // override needed, unlike the pricing routes below.
  @Get("status")
  getStatus() {
    return this.service.getCurriculumStatus();
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
  createSubject(@Body() body: { gradeId: string; nameEn: string; nameAr: string; icon?: string; isActive?: boolean }) {
    return this.service.createSubject(body.gradeId, body);
  }

  @Patch("subjects/:id")
  updateSubject(@Param("id") id: string, @Body() body: unknown) {
    return this.service.updateSubject(id, parseBody(updateSubjectSchema, body));
  }

  @Patch("subjects/:id/shared-content")
  updateSharedSubjectContent(@Param("id") id: string, @Body() body: unknown) {
    return this.service.updateSharedSubjectContent(id, parseBody(sharedSubjectContentSchema, body));
  }

  @Post("subjects/shared-content")
  createSharedSubjectAlias(@Body() body: unknown) {
    const input = parseBody(createSharedSubjectAliasSchema, body);
    return this.service.createSharedSubjectAlias(input.targetGradeId, input.sourceSubjectId);
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

  /**
   * Admin textbook upload, Step 1 (2026-09-20) — FIRST-TIME upload only.
   * Deliberately has no `replace`/`force`/`overwrite` field anywhere in
   * this handler; if Subject.sourceFile already exists,
   * uploadSubjectTextbook() (via CurriculumSourceUploadService.
   * uploadFirstTime) refuses with a safe, generic BadRequestException.
   * Replacement is a separate, not-yet-built feature — there is currently
   * no HTTP path that can overwrite an existing textbook. Real PDF
   * validation (magic bytes, 200MB) happens in the shared service; the
   * MIME check here is a cheap first filter only, never trusted alone.
   * Uses the controller's default @Roles — same as every other route
   * above except pricing.
   */
  @Post("subjects/:id/textbook")
  @UseInterceptors(FileInterceptor("file", textbookUploadOptions))
  uploadSubjectTextbook(@Param("id") subjectId: string, @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    if (!file) throw new BadRequestException("Choose a PDF file to upload.");
    if (file.mimetype !== "application/pdf") throw new BadRequestException("Only PDF files are supported.");
    return this.service.uploadSubjectTextbook(subjectId, file);
  }

  /**
   * Admin New Subject + Textbook Ingestion V1 (2026-09-20) — "Analyze
   * Textbook". Reads the already-uploaded PDF and proposes a Unit/Topic
   * structure; writes nothing to the database. Uses the controller's
   * default @Roles, same as every other content-management route.
   */
  @Post("subjects/:id/analyze-textbook")
  analyzeSubjectTextbook(@Param("id") subjectId: string) {
    return this.service.analyzeSubjectTextbook(subjectId);
  }

  /**
   * Admin New Subject + Textbook Ingestion V1 (2026-09-20) — "Confirm &
   * Create Curriculum Structure". The only step in this workflow that
   * writes Units/Topics; see AdminCurriculumService.confirmSubjectStructure
   * for the full validation/idempotency/transaction behavior.
   */
  @Post("subjects/:id/confirm-structure")
  confirmSubjectStructure(@Param("id") subjectId: string, @Body() body: unknown) {
    return this.service.confirmSubjectStructure(subjectId, parseBody(confirmSubjectStructureSchema, body));
  }

  /** Starts or resumes a single bounded grounding chunk for this Subject. */
  @Post("subjects/:id/prepare-grounding")
  prepareSubjectGrounding(@Param("id") subjectId: string) {
    return this.service.prepareNextSubjectGroundingChunk(subjectId);
  }

  /**
   * English Extra Book / Story support V1 (2026-09-20) — "Add Extra Book",
   * upload step, for an EXISTING Subject. Never touches Subject.sourceFile
   * — see CurriculumSourceUploadService.uploadExtraBook. Uses the
   * controller's default @Roles, same as every other content-management
   * route (including the main textbook upload above).
   */
  @Post("subjects/:id/extra-book")
  @UseInterceptors(FileInterceptor("file", textbookUploadOptions))
  uploadExtraBook(@Param("id") subjectId: string, @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, @Body("bookLabel") bookLabel: string) {
    if (!file) throw new BadRequestException("Choose a PDF file to upload.");
    if (file.mimetype !== "application/pdf") throw new BadRequestException("Only PDF files are supported.");
    if (!bookLabel || !bookLabel.trim()) throw new BadRequestException("Enter a name for this book.");
    return this.service.uploadExtraBook(subjectId, file, bookLabel);
  }

  /**
   * English Extra Book / Story support V1 (2026-09-20) — "Add Extra
   * Book", "Analyze Textbook" step. See
   * AdminCurriculumService.analyzeExtraBook for the trusted-source
   * resolution.
   */
  @Post("subjects/:id/extra-book/analyze")
  analyzeExtraBook(@Param("id") subjectId: string, @Body("bookLabel") bookLabel: string) {
    if (!bookLabel || !bookLabel.trim()) throw new BadRequestException("Enter a name for this book.");
    return this.service.analyzeExtraBook(subjectId, bookLabel);
  }

  /**
   * English Extra Book / Story support V1 (2026-09-20) — "Add Extra
   * Book", "Confirm & Add to Subject" step. The only step in this flow
   * that writes Units/Topics; see
   * AdminCurriculumService.confirmExtraBookStructure for the full
   * validation/trust/idempotency/transaction behavior.
   */
  @Post("subjects/:id/extra-book/confirm")
  confirmExtraBookStructure(@Param("id") subjectId: string, @Body() body: unknown) {
    return this.service.confirmExtraBookStructure(subjectId, parseBody(confirmExtraBookStructureSchema, body));
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
