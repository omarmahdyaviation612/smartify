"use client";

import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getOnboardingCopy } from "@/content/onboarding";
import { OnboardingStepper } from "@/components/OnboardingStepper";
import { ApiError, useApiClient } from "@/lib/api-client";
import { getQuestionOptionLabel } from "@/lib/question-option-label";
import type { Locale } from "@/content/marketing";

interface DiagnosticQuestion {
  id: string;
  subjectId: string;
  subjectNameEn: string;
  subjectNameAr: string;
  type: string;
  promptEn: string;
  promptAr: string | null;
  optionsJson: string[] | null;
  optionsAr: string[] | null;
  forceArabicOptions: boolean;
  isPlaceholder: boolean;
}

export default function OnboardingDiagnosticPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const isAr = locale === "ar";
  const copy = getOnboardingCopy(locale);
  const router = useRouter();
  const { apiFetch } = useApiClient();
  const { isLoaded, isSignedIn } = useAuth();

  const [questions, setQuestions] = useState<DiagnosticQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace(`/${locale}/sign-in`);
      return;
    }

    apiFetch<DiagnosticQuestion[]>("/onboarding/diagnostic")
      .then(setQuestions)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          router.replace(`/${locale}/onboarding/profile`);
          return;
        }
        if (error instanceof ApiError && error.status === 400) {
          router.replace(`/${locale}/onboarding/grade-subjects`);
          return;
        }
        setLoadError(error instanceof ApiError ? error.message : copy.diagnostic.error);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, locale]);

  async function handleSubmit() {
    if (!questions) return;
    setSubmitting(true);
    try {
      await apiFetch("/onboarding/diagnostic/submit", {
        method: "POST",
        body: JSON.stringify({
          answers: questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? null })),
        }),
      });
      router.push(`/${locale}/onboarding/plan-ready`);
    } catch {
      setLoadError(copy.diagnostic.error);
      setSubmitting(false);
    }
  }

  const allAnswered = questions ? questions.every((q) => answers[q.id]) : false;

  return (
    <>
      <OnboardingStepper steps={copy.steps} currentIndex={3} />
      <main className="py-16">
        <SmartifyContainer className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-bold text-navy-900">{copy.diagnostic.title}</h1>
          <p className="mt-2 text-neutral-600">{copy.diagnostic.body}</p>

          {!questions && !loadError && <p className="mt-8 text-neutral-500">{copy.diagnostic.loading}</p>}
          {loadError && <p className="mt-8 text-sm text-error-500">{loadError}</p>}

          {/*
            Phase 10D.1: an empty result here means "no real diagnostic
            Questions exist for this student's selected subjects" — driven
            entirely by actual Question availability (the backend already
            excludes isPlaceholder rows), never a hardcoded subject/grade
            check or a feature flag. This is an availability fallback, not
            a completed diagnostic: no submit call happens on this path, so
            no Assessment/QuestionAttempt/LearningPlan is ever created —
            /onboarding/plan-ready already renders correctly with a null
            diagnosticScore/learningPlan (see OnboardingService.getSummary).
            Once real Questions exist for a subject, `questions.length`
            will simply stop being 0 and the normal diagnostic UI below
            resumes automatically.
          */}
          {questions && questions.length === 0 && (
            <div className="mt-8 space-y-4 text-center">
              <p className="text-neutral-500">{copy.diagnostic.noQuestions}</p>
              <SmartifyButton variant="ai" onClick={() => router.push(`/${locale}/onboarding/plan-ready`)}>
                {copy.diagnostic.noQuestionsContinueLabel}
              </SmartifyButton>
            </div>
          )}

          {questions && questions.length > 0 && (
            <div className="mt-8 space-y-6">
              {questions.map((q, i) => (
                <div key={q.id} className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                  <span className="text-xs font-medium uppercase tracking-wide text-sf-purple-600">
                    {isAr ? q.subjectNameAr : q.subjectNameEn}
                  </span>
                  <p className="mt-2 font-medium text-navy-900">
                    {i + 1}. {isAr && q.promptAr ? q.promptAr : q.promptEn}
                  </p>
                  <div className="mt-4 space-y-2">
                    {(q.optionsJson ?? []).map((opt, oi) => (
                      <label key={opt} className="flex items-center gap-3 text-sm text-neutral-700">
                        <input
                          type="radio"
                          name={q.id}
                          value={opt}
                          checked={answers[q.id] === opt}
                          onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                        />
                        {(isAr || q.forceArabicOptions) && q.optionsAr?.[oi] ? q.optionsAr[oi] : getQuestionOptionLabel(opt, locale)}
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              <SmartifyButton
                variant="ai"
                className="w-full"
                disabled={!allAnswered || submitting}
                onClick={handleSubmit}
              >
                {copy.diagnostic.submitLabel}
              </SmartifyButton>
            </div>
          )}
        </SmartifyContainer>
      </main>
    </>
  );
}
