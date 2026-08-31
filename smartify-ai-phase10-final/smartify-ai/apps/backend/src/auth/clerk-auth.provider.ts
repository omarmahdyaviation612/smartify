import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { loadBackendEnv } from "@smartify/config";
import { AuthProvider, VerifiedIdentity } from "./auth-provider.interface";

@Injectable()
export class ClerkAuthProvider implements AuthProvider {
  private readonly clerkClient;
  private readonly secretKey: string;

  constructor() {
    const env = loadBackendEnv();
    this.secretKey = env.CLERK_SECRET_KEY;
    this.clerkClient = createClerkClient({ secretKey: this.secretKey });
  }

  async verifySessionToken(token: string): Promise<VerifiedIdentity> {
    try {
      const payload = await verifyToken(token, { secretKey: this.secretKey });
      const clerkUser = await this.clerkClient.users.getUser(payload.sub);
      const primaryEmail = clerkUser.emailAddresses.find(
        (e) => e.id === clerkUser.primaryEmailAddressId,
      )?.emailAddress;

      if (!primaryEmail) {
        throw new UnauthorizedException("Clerk user has no verified primary email.");
      }

      return { externalUserId: clerkUser.id, email: primaryEmail };
    } catch {
      throw new UnauthorizedException("Invalid or expired session token.");
    }
  }
}
