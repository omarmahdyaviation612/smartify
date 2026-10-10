"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { SmartifyButton } from "@smartify/ui";
import { useApiClient } from "@/lib/api-client";
import { rememberOnboardingNext, sanitizeNextPath, trackOnboardingStep } from "@/lib/onboarding-draft";
import type { Locale } from "@/content/marketing";

interface Me {
  role: string;
  hasStudentProfile?: boolean;
}

const RETRY_DELAYS_MS = [0, 800, 1500, 2500, 4000];

/**
 * Post-sign-up / post-sign-in router (onboarding drop-off fix, 2026-10-11).
 *
 * Before this page existed Clerk sent brand-new accounts back to the home
 * page and nothing told them to finish setting up — most never did. Now:
 *   - a student with no profile yet → onboarding (remembering ?next, e.g.
 *     the free trial they clicked, to continue there afterwards);
 *   - a student who already onboarded → ?next or their dashboard;
 *   - parents → the parent portal; admins → the admin dashboard.
 * A just-created account can take a moment to sync to the backend, so
 * /users/me is retried briefly before giving up.
 */
export default function WelcomePage() {
  // useSearchParams needs a Suspense boundary on a statically rendered page.
  return (
    <Suspense fallback={null}>
      <WelcomeRouter />
    </Suspense>
  );
}

function WelcomeRouter() {
  const { locale } = useParams<{ locale: Locale }>();
  const isAr = locale === "ar";
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn } = useAuth();
  const { apiFetch } = useApiClient();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace(`/${locale}/sign-in`);
      return;
    }
    const next = sanitizeNextPath(searchParams.get("next"));
    let cancelled = false;

    (async () => {
      for (const delay of RETRY_DELAYS_MS) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        if (cancelled) return;
        try {
          const me = await apiFetch<Me>("/users/me");
          if (cancelled || !me) return;
          if (me.role === "PARENT" || next === "/parent") {
            router.replace(`/${locale}/parent`);
          } else if (me.role === "ADMIN" || me.role === "SUPER_ADMIN") {
            router.replace(`/${locale}/admin`);
          } else if (me.role === "STUDENT" && !me.hasStudentProfile) {
            rememberOnboardingNext(next);
            trackOnboardingStep(apiFetch, "welcome");
            router.replace(`/${locale}/onboarding/profile`);
          } else {
            router.replace(`/${locale}${next ?? "/dashboard"}`);
          }
          return;
        } catch {
          // not synced yet — retry
        }
      }
      if (!cancelled) setFailed(true);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, locale, attempt]);

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <div className="max-w-md text-center" role="status">
        {!failed ? (
          <>
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-sf-blue-500 border-t-transparent" aria-hidden />
            <h1 className="text-xl font-semibold text-navy-900">{isAr ? "أهلاً بك في Smartify!" : "Welcome to Smartify!"}</h1>
            <p className="mt-2 text-neutral-600">{isAr ? "جارٍ تجهيز حسابك..." : "Getting your account ready..."}</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-navy-900">{isAr ? "ما زال حسابك قيد التجهيز" : "Your account is still being set up"}</h1>
            <p className="mt-2 text-neutral-600">{isAr ? "انتظر بضع ثوانٍ ثم حاول مرة أخرى." : "Give it a few seconds and try again."}</p>
            <SmartifyButton
              variant="ai"
              className="mt-6"
              onClick={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
            >
              {isAr ? "حاول مرة أخرى" : "Try again"}
            </SmartifyButton>
          </>
        )}
      </div>
    </main>
  );
}
