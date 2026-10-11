"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAiLimitCopy } from "@/content/ai-limit";
import { useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";

interface TopUpStatus {
  priceEGP: number;
  activeToday: number;
  pendingReview: boolean;
}

const DEFAULT_PRICE_EGP = 50;
const BUTTON_BASE = "inline-flex w-full items-center justify-center rounded-sf px-6 py-3 text-base font-semibold transition-colors duration-200";

/**
 * Shown in place of the plain error line when the student's own daily AI
 * allowance is used up (backend code AI_DAILY_LIMIT_REACHED). Offers the two
 * honest options: pay for one extra daily allowance via InstaPay, or come
 * back tomorrow when the free allowance renews.
 */
export function AiLimitReachedCard({ locale, returnTo }: { locale: Locale; returnTo: string }) {
  const copy = getAiLimitCopy(locale);
  const { apiFetch } = useApiClient();
  const [status, setStatus] = useState<TopUpStatus | null>(null);

  useEffect(() => {
    apiFetch<TopUpStatus>("/ai-topup/status").then(setStatus).catch(() => setStatus(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const price = status?.priceEGP ?? DEFAULT_PRICE_EGP;
  const payHref = `/${locale}/billing/instapay?kind=ai-topup&returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <section
      role="status"
      aria-live="polite"
      className="mx-auto w-full max-w-xl rounded-2xl border border-sf-purple-100 bg-gradient-to-br from-white via-white to-sf-purple-50 p-6 text-center shadow-sm"
    >
      <div aria-hidden="true" className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-sf-purple-50 text-2xl">
        🎯
      </div>
      <h2 className="text-lg font-bold text-navy-900">{copy.title}</h2>
      <p className="mt-2 text-sm leading-6 text-neutral-600">{copy.body}</p>

      {status?.pendingReview ? (
        <div className="mt-5 rounded-xl border border-sf-purple-100 bg-white/80 px-4 py-3 text-start">
          <p className="text-sm font-semibold text-sf-purple-600">{copy.pendingTitle}</p>
          <p className="mt-1 text-sm text-neutral-600">{copy.pendingBody}</p>
        </div>
      ) : (
        <>
          <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-sf-purple-600">{copy.optionsLead}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Link href={payHref} className={`${BUTTON_BASE} bg-ai-gradient text-white shadow-[0_8px_24px_rgba(124,58,237,0.18)]`}>
                {copy.payLabel(price)}
              </Link>
              <span className="text-xs text-neutral-500">{copy.payHint}</span>
            </div>
            <div className="flex flex-col gap-1">
              <Link href={`/${locale}/dashboard`} className={`${BUTTON_BASE} border border-neutral-300 bg-white text-navy-900 hover:bg-neutral-50`}>
                {copy.tomorrowLabel}
              </Link>
              <span className="text-xs text-neutral-500">{copy.tomorrowHint}</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
