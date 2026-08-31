import { Module } from "@nestjs/common";
import { AUTH_PROVIDER } from "./auth-provider.interface";
import { ClerkAuthProvider } from "./clerk-auth.provider";
import { ClerkAuthGuard } from "./clerk-auth.guard";
import { ClerkWebhookController } from "./clerk-webhook.controller";

@Module({
  controllers: [ClerkWebhookController],
  providers: [
    // Bind the interface token to the concrete Clerk implementation.
    // Swapping providers later = change this one line + add the new class.
    { provide: AUTH_PROVIDER, useClass: ClerkAuthProvider },
    ClerkAuthGuard,
  ],
  exports: [AUTH_PROVIDER, ClerkAuthGuard],
})
export class AuthModule {}
