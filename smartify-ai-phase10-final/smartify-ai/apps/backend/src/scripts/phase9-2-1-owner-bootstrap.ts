/**
 * Phase 9.2.1: bootstrap the real Smartify owner SUPER_ADMIN.
 *
 * Fetches the real, verified Clerk user for the designated owner email
 * (same createClerkClient construction as ClerkAuthProvider) and upserts
 * exactly one Smartify User row keyed by that email, setting the REAL
 * clerkUserId returned by Clerk and role SUPER_ADMIN. Never fabricates a
 * clerkUserId, never touches any other user, never creates a
 * StudentProfile (an admin account has no student data). Refuses to
 * proceed if Clerk has no matching user, more than one matching user, or
 * a mismatched email — smallest possible DB change, no silent guessing.
 */
import "reflect-metadata";
import "dotenv/config";
import { createClerkClient } from "@clerk/backend";
import { loadBackendEnv } from "@smartify/config";
import { prisma } from "@smartify/database";

const OWNER_EMAIL = "omarmahdyaviation612@gmail.com";

function redact(id: string) {
  if (id.length <= 10) return "***";
  return `${id.slice(0, 8)}...${id.slice(-4)} (len=${id.length})`;
}

async function main() {
  const env = loadBackendEnv();
  const clerkClient = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });

  const list = await clerkClient.users.getUserList({ emailAddress: [OWNER_EMAIL] });
  if (list.data.length === 0) {
    console.log("BLOCKED_WAITING_FOR_OWNER_SIGNIN: no Clerk user found for this email in the configured Clerk environment.");
    process.exitCode = 2;
    return;
  }
  if (list.data.length > 1) {
    console.log("BLOCKED: multiple Clerk users matched this email — refusing to guess which one is the owner.");
    process.exitCode = 2;
    return;
  }

  const clerkUser = list.data[0];
  const primaryEmail = clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress;
  if (primaryEmail !== OWNER_EMAIL) {
    console.log("BLOCKED: Clerk user's primary email does not exactly match the designated owner email — refusing to proceed.");
    process.exitCode = 2;
    return;
  }
  if (clerkUser.banned) {
    console.log("BLOCKED: the matched Clerk account is banned — refusing to grant SUPER_ADMIN.");
    process.exitCode = 2;
    return;
  }

  const realClerkUserId = clerkUser.id; // used directly below, never logged in full

  const before = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  console.log("Existed before:", Boolean(before), before ? { role: before.role, clerkUserIdRedacted: redact(before.clerkUserId) } : null);

  const after = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { clerkUserId: realClerkUserId, role: "SUPER_ADMIN" },
    create: { email: OWNER_EMAIL, clerkUserId: realClerkUserId, role: "SUPER_ADMIN" },
  });

  console.log("\nBootstrap complete.");
  console.log(JSON.stringify({
    id: after.id,
    email: after.email,
    role: after.role,
    clerkUserIdRedacted: redact(after.clerkUserId),
    clerkUserIdMatchesVerifiedClerkAccount: after.clerkUserId === realClerkUserId,
    createdAt: after.createdAt,
    updatedAt: after.updatedAt,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("OWNER BOOTSTRAP FAILED:", err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
