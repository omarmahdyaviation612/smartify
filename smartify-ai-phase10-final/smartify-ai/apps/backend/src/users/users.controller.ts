import { BadRequestException, Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { UserRole } from "@smartify/shared-types";
import { updateUserRoleSchema } from "@smartify/validation";
import { UsersService } from "./users.service";

@Controller("users")
@UseGuards(ClerkAuthGuard, RolesGuard) // identity first, then authorization
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Any authenticated user can read their own profile. */
  @Get("me")
  me(@CurrentUser() user: any) {
    return this.usersService.findById(user.id);
  }

  /** Only admins can list all users — proves RolesGuard end to end. */
  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT)
  list() {
    return this.usersService.findAll();
  }

  /** Role changes are an explicit admin action — never inferred from Clerk. */
  @Patch(":id/role")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  updateRole(@CurrentUser() actor: any, @Param("id") id: string, @Body() body: unknown) {
    const input = updateUserRoleSchema.parse({ ...(body as object), userId: id });
    const role = Object.values(UserRole).find((value) => value === input.role);
    if (!role) throw new BadRequestException("Invalid user role.");
    return this.usersService.updateRole(actor.id, actor.role, input.userId, role);
  }
}
