"use client";

import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getOnboardingCopy } from "@/content/onboarding";
import { OnboardingStepper } from "@/components/OnboardingStepper";
import { ApiError, useApiClient } from "@/lib/api-client";
import { clearDraft } from "@/lib/onboarding-draft";
import type { Locale } from "@/content/marketing";

interface SubjectScore {
  nameEn: string;
  nameAr: string;
  correct: number;
  total: number;
  percent: number;
}
interface Summary {
  fullName: string;
  curriculum: { nameEn: string; nameAr: string };
  grade: { nameEn: string; nameAr: string };
  subjects: Array<{ nameEn: string; nameAr: string }>;
  diagnosticScore: Record<string, SubjectScore> | null;
  learningPlan: { recommendedFocus: string[]; note: string } | null;
}

export default function OnboardingPlanReadyPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const isAr = locale === "ar";
  const copy = getOnboardingCopy(locale);
  const { apiFetch } = useApiClient();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace(`/${locale}/sign-in`);
      return;
    }
    apiFetch<Summary>("/onboarding/summary")
      .then((data) => {
        setSummary(data);
        clearDraft(); // onboarding is complete — the backend is now the source of truth
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof ApiError && loadError.status === 404) {
          router.replace(`/${locale}/onboarding/profile`);
          return;
        }
        setError(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, locale]);

  return (
    <>
      <OnboardingStepper steps={copy.steps} currentIndex={4} />
      <main className="py-16">
        <SmartifyContainer className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-bold text-navy-900">{copy.planReady.title}</h1>
          <p className="mt-2 text-neutral-600">{copy.planReady.body}</p>

          {error && <p className="mt-8 text-sm text-error-500">{copy.diagnostic.error}</p>}

          {summary && (
            <div className="mt-8 space-y-8">
              <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                <p className="text-sm text-neutral-500">
                  {isAr ? summary.curriculum.nameAr : summary.curriculum.nameEn} · {isAr ? summary.grade.nameAr : summary.grade.nameEn}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-navy-900">{summary.fullName}</h2>
              </div>

              {summary.diagnosticScore && (
                <div>
                  <h3 className="mb-4 text-lg font-semibold text-navy-900">{copy.planReady.scoreTitle}</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {Object.values(summary.diagnosticScore).map((s) => (
                      <div key={s.nameEn} className="rounded-sf-lg border border-neutral-200 bg-white p-5">
                        <p className="font-medium text-navy-900">{isAr ? s.nameAr : s.nameEn}</p>
                        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                          <div className="h-full rounded-full bg-ai-gradient" style={{ width: `${s.percent}%` }} />
                        </div>
                        <p className="mt-2 text-sm text-neutral-500">
                          {s.correct}/{s.total} ({s.percent}%)
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {summary.learningPlan && (
                <div className="rounded-sf-lg bg-[--sf-bg-subtle] p-6">
                  <h3 className="font-semibold text-navy-900">{copy.planReady.planTitle}</h3>
                  <ul className="mt-3 list-inside list-disc text-neutral-700">
                    {summary.learningPlan.recommendedFocus.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <p className="mt-4 text-xs text-neutral-500">{copy.planReady.planNote}</p>
                </div>
              )}

              <p className="text-center text-sm text-neutral-500">{copy.planReady.dashboardComingSoon}</p>

              <Link href={`/${locale}/dashboard`} className="block text-center">
                <SmartifyButton variant="secondary">{copy.planReady.backHome}</SmartifyButton>
              </Link>
            </div>
          )}
        </SmartifyContainer>
      </main>
    </>
  );
}
