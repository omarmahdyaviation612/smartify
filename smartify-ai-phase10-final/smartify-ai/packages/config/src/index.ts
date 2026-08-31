import { z } from "zod";

// Backend env schema. Fails fast on boot if required vars are missing —
// per the spec's "secure environment variables" requirement, nothing here
// has a silently-wrong default for secrets.
export const backendEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  CLERK_SECRET_KEY: z.string().min(1, "CLERK_SECRET_KEY is required"),
  CLERK_PUBLISHABLE_KEY: z.string().min(1, "CLERK_PUBLISHABLE_KEY is required"),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1, "CLERK_WEBHOOK_SIGNING_SECRET is required"),

  OPENAI_API_KEY: z.string().optional(), // optional until Phase 6 (AI Tutor) is built
  STRIPE_SECRET_KEY: z.string().optional(), // optional until a real payment provider is activated (Phase 8)
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
});

export type BackendEnv = z.infer<typeof backendEnvSchema>;

/**
 * Phase 10 hardening: base validation above already fails fast for
 * anything genuinely REQUIRED in every environment (DB, Redis, Clerk).
 * But several vars are legitimately OPTIONAL in development (no
 * OPENAI_API_KEY yet, no Stripe key yet) with defaults/absence that
 * would be dangerous left silent in PRODUCTION specifically:
 *   - FRONTEND_URL defaulting to localhost in production would silently
 *     misconfigure CORS (the real frontend's origin would be rejected)
 *     — this is treated as a hard failure, not a warning, since it's a
 *     security-relevant default (fail closed, but fail LOUDLY, not
 *     silently "working" against the wrong origin).
 *   - OPENAI_API_KEY / STRIPE_SECRET_KEY missing in production means a
 *     whole feature (AI Tutor / billing) will be unavailable. That's a
 *     legitimate product state (e.g. staged rollout), so these are
 *     WARNINGS at boot, loud and impossible to miss in logs, not a
 *     refusal to start — silently missing would be worse than a loud warning.
 */
export function loadBackendEnv(source: NodeJS.ProcessEnv = process.env): BackendEnv {
  const parsed = backendEnvSchema.safeParse(source);
  if (!parsed.success) {
    console.error("❌ Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Environment validation failed — see errors above.");
  }
  const env = parsed.data;

  if (env.NODE_ENV === "production") {
    if (!source.FRONTEND_URL) {
      throw new Error(
        "Production boot aborted: FRONTEND_URL must be set explicitly in production " +
          "(the localhost default would silently break CORS against the real frontend).",
      );
    }

    const missingOptional: string[] = [];
    if (!source.OPENAI_API_KEY) missingOptional.push("OPENAI_API_KEY (AI Tutor will be unavailable)");
    if (!source.STRIPE_SECRET_KEY) missingOptional.push("STRIPE_SECRET_KEY (no payment provider can be activated)");
    if (missingOptional.length > 0) {
      console.warn(`⚠️  Production mode started with missing configuration: ${missingOptional.join("; ")}`);
    }
  }

  return env;
}
