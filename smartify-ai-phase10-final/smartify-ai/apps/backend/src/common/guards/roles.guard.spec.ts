import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";
import { UserRole } from "@smartify/shared-types";

/**
 * RolesGuard is the actual authorization boundary for the whole app
 * (see 02-phase2-decisions.md) — every /admin/* route, every student
 * endpoint's role checks, all route through this. It deserves direct
 * unit coverage independent of any specific controller.
 */
function makeContext(user: { role: UserRole } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe("RolesGuard", () => {
  function makeGuard(requiredRoles: UserRole[] | undefined) {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(requiredRoles) } as unknown as Reflector;
    return new RolesGuard(reflector);
  }

  it("allows the request through when the endpoint has no @Roles decorator", () => {
    const guard = makeGuard(undefined);
    expect(guard.canActivate(makeContext({ role: UserRole.STUDENT }))).toBe(true);
  });

  it("allows the request when the user's role is in the required list", () => {
    const guard = makeGuard([UserRole.SUPER_ADMIN, UserRole.ADMIN]);
    expect(guard.canActivate(makeContext({ role: UserRole.ADMIN }))).toBe(true);
  });

  it("rejects the request when the user's role is NOT in the required list", () => {
    const guard = makeGuard([UserRole.SUPER_ADMIN]);
    expect(() => guard.canActivate(makeContext({ role: UserRole.STUDENT }))).toThrow(ForbiddenException);
  });

  it("rejects when there is no user attached to the request at all", () => {
    const guard = makeGuard([UserRole.SUPER_ADMIN]);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });

  it("enforces CONTENT_MANAGER is excluded from pricing-plan-style restricted routes", () => {
    // Mirrors AdminCurriculumController's pricing-plans routes, which
    // override the controller's default @Roles to exclude CONTENT_MANAGER.
    const guard = makeGuard([UserRole.SUPER_ADMIN, UserRole.ADMIN]);
    expect(() => guard.canActivate(makeContext({ role: UserRole.CONTENT_MANAGER }))).toThrow(ForbiddenException);
  });
});
