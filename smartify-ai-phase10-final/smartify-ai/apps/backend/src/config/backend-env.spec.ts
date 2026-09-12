import { loadBackendEnv } from "@smartify/config";

// A realistic, fully-valid production environment — every test below
// starts from a clone of this and breaks exactly one field, so a failure
// always isolates to the thing the test is actually checking.
const VALID_PRODUCTION_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  PORT: "4000",
  DATABASE_URL: "postgresql://app_user:realsecretvalue@db.internal.smartify-prod.example:5432/smartify",
  REDIS_URL: "redis://cache.internal.smartify-prod.example:6379",
  FRONTEND_URL: "https://app.smartify.ai",
  CLERK_SECRET_KEY: "sk_live_realsecretvalue1234567890",
  CLERK_PUBLISHABLE_KEY: "pk_live_realsecretvalue1234567890",
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_realsecretvalue1234567890",
  OPENAI_API_KEY: "sk-realsecretvalue1234567890",
  STRIPE_SECRET_KEY: "sk_live_realsecretvalue1234567890",
  STRIPE_WEBHOOK_SECRET: "whsec_realsecretvalue1234567890",
};

describe("loadBackendEnv — production validation", () => {
  it("accepts a fully valid production environment", () => {
    expect(() => loadBackendEnv({ ...VALID_PRODUCTION_ENV })).not.toThrow();
  });

  it("still works normally in development mode (no production checks applied)", () => {
    const env = loadBackendEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:password@localhost:5432/smartify_ai",
      REDIS_URL: "redis://localhost:6379",
      CLERK_SECRET_KEY: "sk_test_xxx",
      CLERK_PUBLISHABLE_KEY: "pk_test_xxx",
      CLERK_WEBHOOK_SIGNING_SECRET: "whsec_xxx",
    });
    expect(env.NODE_ENV).toBe("development");
    expect(env.FRONTEND_URL).toBe("http://localhost:3000");
  });

  it("rejects a missing required secret", () => {
    const env = { ...VALID_PRODUCTION_ENV };
    delete env.CLERK_WEBHOOK_SIGNING_SECRET;
    expect(() => loadBackendEnv(env)).toThrow(/Environment validation failed/);
  });

  it("rejects a localhost production URL (FRONTEND_URL)", () => {
    const env = { ...VALID_PRODUCTION_ENV, FRONTEND_URL: "http://localhost:3000" };
    expect(() => loadBackendEnv(env)).toThrow(/unsafe configuration/i);
  });

  it("rejects a localhost production URL (DATABASE_URL)", () => {
    const env = { ...VALID_PRODUCTION_ENV, DATABASE_URL: "postgresql://user:password@localhost:5432/smartify" };
    expect(() => loadBackendEnv(env)).toThrow(/unsafe configuration/i);
  });

  it("rejects a placeholder OpenAI key", () => {
    const env = { ...VALID_PRODUCTION_ENV, OPENAI_API_KEY: "sk-proj-xxx" };
    expect(() => loadBackendEnv(env)).toThrow(/unsafe configuration/i);
  });

  it("rejects a development Clerk secret key in production", () => {
    const env = { ...VALID_PRODUCTION_ENV, CLERK_SECRET_KEY: "sk_test_realsecretvalue1234567890" };
    expect(() => loadBackendEnv(env)).toThrow(/unsafe configuration/i);
  });

  it("rejects a development Clerk publishable key in production", () => {
    const env = { ...VALID_PRODUCTION_ENV, CLERK_PUBLISHABLE_KEY: "pk_test_realsecretvalue1234567890" };
    expect(() => loadBackendEnv(env)).toThrow(/unsafe configuration/i);
  });

  it("rejects a TEST Stripe key in production", () => {
    const env = { ...VALID_PRODUCTION_ENV, STRIPE_SECRET_KEY: "sk_test_realsecretvalue1234567890" };
    expect(() => loadBackendEnv(env)).toThrow(/unsafe configuration/i);
  });

  it("rejects placeholder InstaPay configuration when InstaPay is partially enabled", () => {
    const env = { ...VALID_PRODUCTION_ENV, INSTAPAY_RECIPIENT_NAME: "Smartify" };
    expect(() => loadBackendEnv(env)).toThrow(/unsafe configuration/i);
  });

  it("rejects a placeholder-looking InstaPay value even when all four fields are present", () => {
    const env = {
      ...VALID_PRODUCTION_ENV,
      INSTAPAY_RECIPIENT_NAME: "Smartify",
      INSTAPAY_RECIPIENT_HANDLE: "01000000000",
      INSTAPAY_INSTRUCTIONS_EN: "placeholder instructions",
      INSTAPAY_INSTRUCTIONS_AR: "تعليمات حقيقية",
    };
    expect(() => loadBackendEnv(env)).toThrow(/unsafe configuration/i);
  });

  it("accepts fully-configured, non-placeholder InstaPay details in production", () => {
    const env = {
      ...VALID_PRODUCTION_ENV,
      INSTAPAY_RECIPIENT_NAME: "Smartify Education",
      INSTAPAY_RECIPIENT_HANDLE: "01234567890",
      INSTAPAY_INSTRUCTIONS_EN: "Send the exact amount and upload your receipt.",
      INSTAPAY_INSTRUCTIONS_AR: "أرسل المبلغ بالضبط وقم برفع إيصال الدفع.",
    };
    expect(() => loadBackendEnv(env)).not.toThrow();
  });

  it("rejects a malformed DATABASE_URL", () => {
    const env = { ...VALID_PRODUCTION_ENV, DATABASE_URL: "not-a-valid-url" };
    expect(() => loadBackendEnv(env)).toThrow(/unsafe configuration/i);
  });

  it("rejects a malformed REDIS_URL", () => {
    const env = { ...VALID_PRODUCTION_ENV, REDIS_URL: "not-a-valid-url" };
    expect(() => loadBackendEnv(env)).toThrow(/unsafe configuration/i);
  });

  it("does not require OpenAI/Stripe keys to boot (staged rollout is a legitimate production state)", () => {
    const env = { ...VALID_PRODUCTION_ENV };
    delete env.OPENAI_API_KEY;
    delete env.STRIPE_SECRET_KEY;
    delete env.STRIPE_WEBHOOK_SECRET;
    expect(() => loadBackendEnv(env)).not.toThrow();
  });
});
