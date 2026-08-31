import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../../auth/clerk-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "@smartify/shared-types";
import { AdminCurriculumService } from "./admin-curriculum.service";

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
  updateCurriculum(@Param("id") id: string, @Body() body: any) {
    return this.service.updateCurriculum(id, body);
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
  updateGrade(@Param("id") id: string, @Body() body: any) {
    return this.service.updateGrade(id, body);
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
  updateSubject(@Param("id") id: string, @Body() body: any) {
    return this.service.updateSubject(id, body);
  }

  // Pricing — financial data, restricted further than the controller default.
  @Get("pricing-plans")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  listPricingPlans(@Query("curriculumId") curriculumId?: string) {
    return this.service.listPricingPlans(curriculumId);
  }

  @Patch("pricing-plans/:id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  updatePricingPlan(@Param("id") id: string, @Body() body: any) {
    return this.service.updatePricingPlan(id, body);
  }
}
