"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getPracticeCopy } from "@/content/practice";
import { getMarketingCopy } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import { useApiClient } from "@/lib/api-client";
import { getQuestionOptionLabel } from "@/lib/question-option-label";
import { getLocalizedExplanation } from "@/lib/localized-explanation";
import type { Locale } from "@/content/marketing";
import Link from "next/link";
import { getLearningFeedback } from "@/content/learning-feedback";

interface Subject {
  entitlement?: "ACTIVE" | "LOCKED";
  id: string;
  nameEn: string;
  nameAr: string;
}
interface Topic {
  id: string;
  nameEn: string;
  nameAr: string;
  accuracyPercent: number | null;
}
interface Question {
  id: string;
  type: string;
  promptEn: string;
  promptAr: string | null;
  optionsJson: string[] | null;
  optionsAr: string[] | null;
}
interface Feedback {
  questionId: string;
  isCorrect: boolean;
  correctAnswer: string;
  explanationEn: string | null;
  explanationAr: string | null;
}

function answerOptionLabel(question: Question | undefined, answer: unknown, forceArabic: boolean, locale: Locale) {
  const index = question?.optionsJson?.indexOf(String(answer)) ?? -1;
  return forceArabic && index >= 0 && question?.optionsAr?.[index]
    ? question.optionsAr[index]
    : getQuestionOptionLabel(String(answer), locale);
}

export default function PracticePage() {
  const { locale } = useParams<{ locale: Locale }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSubjectId = searchParams.get("subjectId");
  const isAr = locale === "ar";
  const copy = getPracticeCopy(locale);
  const navCopy = getMarketingCopy(locale);
  const { apiFetch } = useApiClient();
  const feedback = getLearningFeedback(locale);
  const [error, setError] = useState<string | null>(null);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [topicsFor, setTopicsFor] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);

  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState<string>("");
  const [notOnboarded, setNotOnboarded] = useState(false);

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [forceArabicOptions, setForceArabicOptions] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<{ correctCount: number; total: number; feedback: Feedback[] } | null>(null);
  const [submissionKey, setSubmissionKey] = useState("");

  useEffect(() => {
    let active = true;
    setError(null);
    apiFetch<{ subjects: Subject[] }>("/dashboard/summary")
      .then((data) => {
        if (!active) return;
        if (data.subjects.some(s => s.id === requestedSubjectId && s.entitlement === "LOCKED")) { router.replace(`/${locale}/billing?subjectId=${encodeURIComponent(requestedSubjectId!)}`); return; }
        data.subjects = data.subjects.filter(s => s.entitlement !== "LOCKED");
        setSubjects(data.subjects);
        const requested = requestedSubjectId && data.subjects.some((s) => s.id === requestedSubjectId) ? requestedSubjectId : null;
        if (requested) setSubjectId(requested);
        else if (data.subjects[0]) setSubjectId(data.subjects[0].id);
        else setNotOnboarded(true);
      })
      .catch((err) => {
        if (!active) return;
        if (err?.status === 404) setNotOnboarded(true);
        else setError(feedback.loadError);
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry, locale]);

  useEffect(() => {
    if (!subjectId) return;
    let active = true;
    setTopics([]);
    setTopicsLoading(true);
    setError(null);
    apiFetch<Topic[]>(`/practice/topics?subjectId=${subjectId}`)
      .then((data) => { if (active) setTopics(data); })
      .catch(() => { if (active) setError(feedback.loadError); })
      .finally(() => { if (active) { setTopicsLoading(false); setTopicsFor(subjectId); } });
    setTopicId("");
    setQuestions(null);
    setResults(null);
    setSubmissionKey("");
    return () => { active = false; };
  }, [subjectId, retry, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startPractice() {
    if (busy || topicsLoading || topicsFor !== subjectId || !subjectId || topics.length === 0) return;
    setBusy(true);
    setError(null);
    try {
    const query = topicId ? `subjectId=${subjectId}&topicId=${topicId}` : `subjectId=${subjectId}`;
    const data = await apiFetch<{ questions: Question[]; forceArabicOptions?: boolean }>(`/practice/questions?${query}`);
    if (!data.questions.length) { setError(feedback.questionsUnavailable); return; }
    setQuestions(data.questions);
    setForceArabicOptions(data.forceArabicOptions === true);
    setAnswers({});
    setResults(null);
    setSubmissionKey(window.crypto.randomUUID());
    } catch (err: any) {
      setError(err?.status === 400 ? feedback.questionsUnavailable : feedback.loadError);
    } finally { setBusy(false); }
  }

  async function submitPractice() {
    if (!questions?.length || busy) return;
    setBusy(true);
    setError(null);
    try {
    const res = await apiFetch<{ submissionId: string; correctCount: number; total: number; feedback: Feedback[] }>("/practice/submit", {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: submissionKey, answers: questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? null })) }),
    });
    setResults(res);
    } catch { setError(feedback.submitError); }
    finally { setBusy(false); }
  }

  if (notOnboarded) {
    return (
      <>
        <Navbar locale={locale} copy={navCopy} />
        <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center text-neutral-600">
          <p role="alert">{feedback.noSubjects}</p>
          <Link className="underline" href={`/${locale}/onboarding/profile`}>{feedback.onboarding}</Link>
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar locale={locale} copy={navCopy} />
      <main className="py-12">
        <SmartifyContainer className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-bold text-navy-900">{copy.title}</h1>
          {(!subjects && !error || topicsLoading) && <p role="status" className="mt-4">{feedback.loading}</p>}
          {(error || (subjects && !topicsLoading && topicsFor === subjectId && topics.length === 0)) && (
            <div role="alert" className="mt-4 rounded-sf-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
              <p>{error ?? feedback.topicsUnavailable}</p>
              <div className="mt-3 flex items-center gap-4">
                {!questions && <SmartifyButton variant="secondary" disabled={busy} onClick={() => setRetry((n) => n + 1)}>{feedback.retry}</SmartifyButton>}
                <Link className="underline" href={`/${locale}/dashboard`}>{feedback.dashboard}</Link>
              </div>
            </div>
          )}

          {!questions && subjects && (
            <div className="mt-8 space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.subjectLabel}</span>
                <select
                  value={subjectId}
                  disabled={busy}
                  onChange={(e) => setSubjectId(e.target.value)}
                  className="w-full rounded-sf border border-neutral-300 bg-white px-4 py-2"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {isAr ? s.nameAr : s.nameEn}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.topicLabel}</span>
                <select
                  value={topicId}
                  onChange={(e) => setTopicId(e.target.value)}
                  className="w-full rounded-sf border border-neutral-300 bg-white px-4 py-2"
                >
                  <option value="">{copy.allTopics}</option>
                  {topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {isAr ? t.nameAr : t.nameEn} —{" "}
                      {t.accuracyPercent !== null ? copy.accuracyBadge(t.accuracyPercent) : copy.newTopicBadge}
                    </option>
                  ))}
                </select>
              </label>

              <SmartifyButton variant="ai" className="w-full" disabled={busy || topicsLoading || topicsFor !== subjectId || !subjectId || topics.length === 0} onClick={startPractice}>
                {copy.startLabel}
              </SmartifyButton>
            </div>
          )}

          {questions && !results && (
            <div className="mt-8 space-y-6">
              {questions.map((q, i) => (
                <div key={q.id} className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                  <p className="font-medium text-navy-900">
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
                        {(isAr || forceArabicOptions) && q.optionsAr?.[oi] ? q.optionsAr[oi] : getQuestionOptionLabel(opt, locale)}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <SmartifyButton variant="ai" className="w-full" disabled={busy} onClick={submitPractice}>
                {copy.submitLabel}
              </SmartifyButton>
            </div>
          )}

          {results && questions && (
            <div className="mt-8 space-y-6">
              <div className="rounded-sf-lg bg-[--sf-bg-subtle] p-6 text-center">
                <h2 className="text-lg font-semibold text-navy-900">{copy.resultsTitle}</h2>
                <p className="mt-1 text-3xl font-bold text-navy-900">
                  {results.correctCount}/{results.total}
                </p>
              </div>

              {results.feedback.map((f) => {
                const q = questions.find((qq) => qq.id === f.questionId);
                return (
                  <div key={f.questionId} className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                    <p className="font-medium text-navy-900">{isAr && q?.promptAr ? q.promptAr : q?.promptEn}</p>
                    <span
                      className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-medium ${
                        f.isCorrect ? "bg-success-100 text-success-500" : "bg-error-100 text-error-500"
                      }`}
                    >
                      {f.isCorrect ? copy.correctLabel : copy.incorrectLabel}
                    </span>
                    {!f.isCorrect && (
                      <p className="mt-2 text-sm text-neutral-600">
                        {copy.correctAnswer}: {answerOptionLabel(q, f.correctAnswer, forceArabicOptions, locale)}
                      </p>
                    )}
                    {getLocalizedExplanation(f.explanationEn, f.explanationAr, locale) && (
                      <p className="mt-2 text-sm text-neutral-500">
                        <strong>{copy.explanationLabel}:</strong> {getLocalizedExplanation(f.explanationEn, f.explanationAr, locale)}
                      </p>
                    )}
                  </div>
                );
              })}

              <SmartifyButton
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setQuestions(null);
                  setResults(null);
                }}
              >
                {copy.practiceAgain}
              </SmartifyButton>
            </div>
          )}
        </SmartifyContainer>
      </main>
    </>
  );
}
