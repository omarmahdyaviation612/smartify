import { ServiceUnavailableException } from "@nestjs/common";

/** Price of one extra daily AI allowance, paid manually via InstaPay. */
export const AI_DAILY_TOPUP_PRICE_EGP = 50;

/**
 * Machine-readable code the frontend keys on to replace the plain red error
 * with the "daily limit reached — continue now or tomorrow" card. Only ever
 * used for the PER-USER cap: buying a top-up can lift that one, but not the
 * global or platform caps, so those keep their generic messages.
 */
export const AI_DAILY_LIMIT_REACHED_CODE = "AI_DAILY_LIMIT_REACHED";

export const AI_DAILY_LIMIT_REACHED_MESSAGE = "You've reached today's AI usage limit. Please try again tomorrow.";

export function aiDailyLimitReachedException(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    error: "Service Unavailable",
    code: AI_DAILY_LIMIT_REACHED_CODE,
    message: AI_DAILY_LIMIT_REACHED_MESSAGE,
    topUpPriceEGP: AI_DAILY_TOPUP_PRICE_EGP,
  });
}
