import { Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import { loadBackendEnv } from "@smartify/config";

// Resend's own shared test sender — works without a verified domain, but
// only ever delivers to the email address on the account that owns the
// API key. Used automatically when RESEND_FROM_EMAIL isn't set, so email
// sending "just works" in development before a real domain is verified.
const RESEND_TEST_SENDER = "Smartify AI <onboarding@resend.dev>";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

/**
 * Thin wrapper over Resend, matching this codebase's existing
 * provider-optionality pattern (OpenAiTtsProvider, PaymentProviderFactory):
 * a missing/misconfigured API key must never crash the feature that
 * triggered the email (lesson completion, in this case) — it logs and
 * no-ops instead, exactly like TtsProviderFactory falling back silently
 * when voice playback can't be configured. There is deliberately no
 * "EmailProviderFactory" abstraction (unlike AI/TTS/payments) — Resend is
 * the only provider this app has ever used, so the extra indirection
 * isn't earning its keep yet; add one if/when a second provider is ever
 * actually needed.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: Resend | null;
  private readonly from: string;

  constructor() {
    const env = loadBackendEnv();
    this.client = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
    this.from = env.RESEND_FROM_EMAIL || RESEND_TEST_SENDER;
    if (!this.client) {
      this.logger.warn("RESEND_API_KEY is not set — outbound email is disabled; emails will be logged and skipped.");
    }
  }

  /**
   * Never throws — every caller of this method treats email as a
   * best-effort side effect of something else (a lesson-completion check,
   * not the check itself), so a Resend outage or missing config must
   * never break the caller's own response to the student.
   */
  async send(input: SendEmailInput): Promise<{ sent: boolean }> {
    if (!this.client) {
      this.logger.log("Email not sent because no provider is configured.");
      return { sent: false };
    }
    try {
      const result = await this.client.emails.send({ from: this.from, to: input.to, subject: input.subject, html: input.html });
      if (result.error) {
        this.logger.warn("Resend rejected an email.");
        return { sent: false };
      }
      return { sent: true };
    } catch (err) {
      this.logger.warn("Email send failed.");
      return { sent: false };
    }
  }
}
