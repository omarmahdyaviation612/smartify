"use client";

import { SignUp } from "@clerk/nextjs";
import { useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { sanitizeNextPath } from "@/lib/onboarding-draft";

const REFERRAL_CODE_STORAGE_KEY = "smartify_referral_code";

export default function SignUpPage() {
  const searchParams = useSearchParams();
  const { locale } = useParams<{ locale: string }>();
  // Onboarding drop-off fix (2026-10-11): without an explicit target Clerk
  // sent new accounts back to the home page, where nothing told them to
  // finish setting up. /welcome routes them into onboarding (or wherever
  // they were heading, e.g. ?next=/free-trial, once onboarding is done).
  const next = sanitizeNextPath(searchParams.get("next"));
  const afterSignUp = `/${locale}/welcome${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  // Referral V1 (2026-09-20) — a referral must be attached "before/at
  // signup" (see spec), but a StudentProfile (Referral.referredStudentId)
  // doesn't exist until onboarding's profile step completes. Captured
  // here as early as possible and stashed in localStorage; onboarding's
  // profile page reads and submits it once, then clears it — never
  // re-submitted, matching "cannot be changed later".
  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) {
      try {
        window.localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, ref);
      } catch {
        // Private browsing / storage disabled — referral capture is a
        // best-effort convenience, never load-bearing for sign-up itself.
      }
    }
  }, [searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[--sf-bg-subtle] py-20">
      {/* Same RTL/bidi fix as sign-in — see that file's comment. */}
      <div dir="ltr">
        <SignUp forceRedirectUrl={afterSignUp} signInForceRedirectUrl={afterSignUp} />
      </div>
    </div>
  );
}
