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

  // Manual InstaPay payment method: real money-routing details, so these
  // live in deploy-time env vars (not an admin-editable DB config) and are
  // optional — InstaPay simply isn't offered until they're set. Checked at
  // request time (InstapayService), not at boot, matching STRIPE_* above.
  INSTAPAY_RECIPIENT_NAME: z.string().optional(),
  INSTAPAY_RECIPIENT_HANDLE: z.string().optional(), // mobile number or IPA address shown to students
  INSTAPAY_INSTRUCTIONS_EN: z.string().optional(),
  INSTAPAY_INSTRUCTIONS_AR: z.string().optional(),
});

export type BackendEnv = z.infer<typeof backendEnvSchema>;

// Values that are fine in development but must never reach production
// unnoticed — dev placeholders, tutorial boilerplate, obviously-fake
// secrets. Kept intentionally simple (substring/regex checks) rather than
// trying to fully validate secret formats, which vary by provider and
// change over time.
const PLACEHOLDER_PATTERNS = [/xxx/i, /placeholder/i, /changeme/i, /example\.com/i, /\btodo\b/i];

function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const NON_PRODUCTION_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "example.com"]);

function isNonProductionHost(hostname: string): boolean {
  return NON_PRODUCTION_HOSTNAMES.has(hostname) || hostname.endsWith(".local");
}

/**
 * Phase 10 hardening: fail-fast production configuration checks, run only
 * when NODE_ENV=production. Collects every problem found (rather than
 * throwing on the first one) so a misconfigured production boot reports a
 * complete picture in one shot. None of this affects development or test
 * mode — the base schema above is unchanged for those.
 */
function findUnsafeProductionConfig(source: NodeJS.ProcessEnv, env: BackendEnv): string[] {
  const errors: string[] = [];

  // FRONTEND_URL: also the CORS origin (see main.ts) — a wrong value here
  // doesn't just look bad, it actively breaks or misroutes real traffic.
  const frontendHost = hostnameOf(env.FRONTEND_URL);
  if (!frontendHost) {
    errors.push("FRONTEND_URL is not a valid URL.");
  } else if (isNonProductionHost(frontendHost)) {
    errors.push(`FRONTEND_URL points at a non-production host ("${frontendHost}").`);
  }

  const dbHost = hostnameOf(env.DATABASE_URL);
  if (!dbHost) {
    errors.push("DATABASE_URL is not a valid connection URL.");
  } else if (isNonProductionHost(dbHost)) {
    errors.push(`DATABASE_URL points at a non-production host ("${dbHost}").`);
  }
  if (looksLikePlaceholder(env.DATABASE_URL)) {
    errors.push("DATABASE_URL looks like a placeholder value.");
  }

  // REDIS_URL is currently unused by any backend code path, but it is a
  // required env var today, so it is validated the same way as DATABASE_URL
  // for whenever it is wired up — an unnoticed dev value here should still
  // be caught now rather than silently shipped.
  const redisHost = hostnameOf(env.REDIS_URL);
  if (!redisHost) {
    errors.push("REDIS_URL is not a valid connection URL.");
  } else if (isNonProductionHost(redisHost)) {
    errors.push(`REDIS_URL points at a non-production host ("${redisHost}").`);
  }

  if (!env.CLERK_SECRET_KEY.startsWith("sk_live_")) {
    errors.push('CLERK_SECRET_KEY is not a live Clerk key (expected an "sk_live_" key in production).');
  }
  if (!env.CLERK_PUBLISHABLE_KEY.startsWith("pk_live_")) {
    errors.push('CLERK_PUBLISHABLE_KEY is not a live Clerk key (expected a "pk_live_" key in production).');
  }
  if (looksLikePlaceholder(env.CLERK_WEBHOOK_SIGNING_SECRET)) {
    errors.push("CLERK_WEBHOOK_SIGNING_SECRET looks like a placeholder value.");
  }

  // OpenAI / Stripe stay OPTIONAL in production (a staged rollout without
  // AI Tutor or payments active yet is a legitimate state — see the
  // missing-optional warning below) but if a value IS present, it must not
  // be an obviously-fake one.
  if (source.OPENAI_API_KEY) {
    if (looksLikePlaceholder(source.OPENAI_API_KEY) || !source.OPENAI_API_KEY.startsWith("sk-")) {
      errors.push("OPENAI_API_KEY looks like a placeholder value, not a real OpenAI key.");
    }
  }
  if (source.STRIPE_SECRET_KEY) {
    if (looksLikePlaceholder(source.STRIPE_SECRET_KEY)) {
      errors.push("STRIPE_SECRET_KEY looks like a placeholder value.");
    } else if (source.STRIPE_SECRET_KEY.startsWith("sk_test_")) {
      errors.push('STRIPE_SECRET_KEY is a TEST key ("sk_test_..."); production requires a live key.');
    }
  }
  if (source.STRIPE_WEBHOOK_SECRET && looksLikePlaceholder(source.STRIPE_WEBHOOK_SECRET)) {
    errors.push("STRIPE_WEBHOOK_SECRET looks like a placeholder value.");
  }

  // InstaPay is "enabled" the moment any one of its four fields is set —
  // in that state all four are required and none may be a placeholder,
  // since real money-routing details shown to students would otherwise be
  // silently wrong or missing.
  const instapayFields: Record<string, string | undefined> = {
    INSTAPAY_RECIPIENT_NAME: source.INSTAPAY_RECIPIENT_NAME,
    INSTAPAY_RECIPIENT_HANDLE: source.INSTAPAY_RECIPIENT_HANDLE,
    INSTAPAY_INSTRUCTIONS_EN: source.INSTAPAY_INSTRUCTIONS_EN,
    INSTAPAY_INSTRUCTIONS_AR: source.INSTAPAY_INSTRUCTIONS_AR,
  };
  const instapayEnabled = Object.values(instapayFields).some((value) => !!value);
  if (instapayEnabled) {
    for (const [key, value] of Object.entries(instapayFields)) {
      if (!value) {
        errors.push(`${key} must be set in production because InstaPay is enabled (another INSTAPAY_* value is set).`);
      } else if (looksLikePlaceholder(value)) {
        errors.push(`${key} looks like a placeholder value.`);
      }
    }
  }

  return errors;
}

export function loadBackendEnv(source: NodeJS.ProcessEnv = process.env): BackendEnv {
  const parsed = backendEnvSchema.safeParse(source);
  if (!parsed.success) {
    console.error("❌ Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Environment validation failed — see errors above.");
  }
  const env = parsed.data;

  if (env.NODE_ENV === "production") {
    const errors = findUnsafeProductionConfig(source, env);
    if (errors.length > 0) {
      console.error(`❌ Unsafe production configuration (${errors.length} issue(s)):\n${errors.map((e) => ` - ${e}`).join("\n")}`);
      throw new Error("Production boot aborted: unsafe configuration detected — see errors above.");
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
