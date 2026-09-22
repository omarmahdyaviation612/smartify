import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AdminCurriculumController } from "./admin-curriculum.controller";
import { ROLES_KEY } from "../../common/decorators/roles.decorator";
import { UserRole } from "@smartify/shared-types";

/**
 * The new read-only status endpoint (GET /admin/curriculum/status) must
 * reuse the existing curriculum-admin authorization boundary exactly —
 * SUPER_ADMIN, ADMIN, CONTENT_MANAGER — the same as every other route on
 * this controller except the pricing ones, which narrow it further. No new
 * auth infrastructure was introduced; this test locks in that the new
 * handler relies on the controller's class-level @Roles(...) (via
 * RolesGuard.canActivate's getAllAndOverride) rather than opening it up or
 * accidentally narrowing it.
 */
describe("GET /admin/curriculum/status authorization", () => {
  it("the controller class requires SUPER_ADMIN, ADMIN, or CONTENT_MANAGER", () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AdminCurriculumController);
    expect(roles).toEqual([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.CONTENT_MANAGER]);
  });

  it("getStatus() has no narrower/overriding @Roles of its own — it inherits the controller-level roles above", () => {
    const handlerRoles = Reflect.getMetadata(ROLES_KEY, AdminCurriculumController.prototype.getStatus);
    expect(handlerRoles).toBeUndefined();
  });

  it("is guarded by the same ClerkAuthGuard/RolesGuard pair as the rest of the controller (class-level @UseGuards, not per-route)", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminCurriculumController);
    expect(guards).toBeDefined();
    expect(guards).toHaveLength(2);
  });
});
