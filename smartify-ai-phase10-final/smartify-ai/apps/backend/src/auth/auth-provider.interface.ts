/**
 * Abstraction over "who is this request from". Nothing outside this file
 * and its concrete implementations should import the Clerk SDK directly —
 * swapping identity providers later means writing one new class here.
 */
export interface VerifiedIdentity {
  externalUserId: string;
  email: string;
}

export interface AuthProvider {
  /** Verifies a session token from the Authorization header. Throws on invalid/expired tokens. */
  verifySessionToken(token: string): Promise<VerifiedIdentity>;
}

export const AUTH_PROVIDER = Symbol("AUTH_PROVIDER");
