/**
 * Phase 9.2.1 precheck ONLY: read-only query against the real, currently
 * configured Clerk environment (createClerkClient with CLERK_SECRET_KEY,
 * the exact same client construction ClerkAuthProvider uses) to check
 * whether a real Clerk user exists for the designated owner email. No
 * database write, no Clerk write, no fabricated identifiers. The full
 * Clerk user ID is deliberately never printed — only a redacted form.
 */
import "reflect-metadata";
import "dotenv/config";
import { createClerkClient } from "@clerk/backend";
import { loadBackendEnv } from "@smartify/config";

const OWNER_EMAIL = "omarmahdyaviation612@gmail.com";

function redact(id: string) {
  if (id.length <= 10) return "***";
  return `${id.slice(0, 8)}...${id.slice(-4)} (len=${id.length})`;
}

async function main() {
  const env = loadBackendEnv();
  console.log("CLERK_SECRET_KEY configured:", Boolean(env.CLERK_SECRET_KEY));
  console.log("CLERK_SECRET_KEY prefix:", env.CLERK_SECRET_KEY?.slice(0, 7));

  const clerkClient = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });

  try {
    const list = await clerkClient.users.getUserList({ emailAddress: [OWNER_EMAIL] });
    console.log("\nClerk API reachable: YES");
    console.log("Matching Clerk users found:", list.data.length);
    for (const u of list.data) {
      const primaryEmail = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress;
      console.log(JSON.stringify({
        clerkUserIdRedacted: redact(u.id),
        primaryEmail,
        emailMatchesExactly: primaryEmail === OWNER_EMAIL,
        allEmailAddresses: u.emailAddresses.map((e) => e.emailAddress),
        createdAt: new Date(u.createdAt).toISOString(),
        banned: u.banned,
      }, null, 2));
    }
  } catch (err: any) {
    console.log("\nClerk API reachable: NO / ERROR");
    console.log("error name:", err?.name);
    console.log("error message:", err?.message);
    console.log("status:", err?.status);
  }
}

main().catch((err) => {
  console.error("PRECHECK FAILED:", err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
