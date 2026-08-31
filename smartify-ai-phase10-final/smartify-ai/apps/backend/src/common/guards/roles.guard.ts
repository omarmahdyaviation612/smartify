import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@smartify/shared-types";
import { ROLES_KEY } from "../decorators/roles.decorator";

/**
 * The actual authorization boundary. Runs AFTER ClerkAuthGuard has
 * attached the local user, and checks that user's DB-stored `role`
 * against the roles required by @Roles(...) on the handler/class.
 *
 * This guard has no dependency on Clerk at all — it would work
 * unchanged if the identity provider were swapped out tomorrow.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // no @Roles(...) decorator → auth required, but any role is fine
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException("You do not have permission to perform this action.");
    }

    return true;
  }
}
