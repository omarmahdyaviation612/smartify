import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { AUTH_PROVIDER, AuthProvider } from "./auth-provider.interface";

/**
 * Verifies the session token (via AuthProvider — currently Clerk), then
 * resolves it to our internal User row and attaches it to the request.
 *
 * This is the ONLY place a Clerk session token is trusted for *identity*.
 * It never grants authorization by itself — RolesGuard does that against
 * the local `role` column, not against anything Clerk returns.
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly authProvider: AuthProvider,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    const token = authHeader.slice("Bearer ".length);
    const identity = await this.authProvider.verifySessionToken(token);

    let user = await this.prisma.client.user.findUnique({
      where: { clerkUserId: identity.externalUserId },
    });

    if (!user) {
      const userWithEmail = await this.prisma.client.user.findUnique({
        where: { email: identity.email },
      });
      if (userWithEmail && userWithEmail.clerkUserId !== identity.externalUserId) {
        throw new UnauthorizedException("This email is linked to another account.");
      }

      user =
        userWithEmail ??
        (await this.prisma.client.user.create({
          data: {
            clerkUserId: identity.externalUserId,
            email: identity.email,
            role: "STUDENT",
          },
        }));
    }

    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException("No active local account for this session.");
    }

    // Attach the LOCAL user record — role/authorization checks downstream
    // read from this, never from the Clerk token or profile.
    (request as any).user = user;
    return true;
  }
}
