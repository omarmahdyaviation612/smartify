"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getQuizzesCopy } from "@/content/quizzes";
import { getMarketingCopy } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import { useApiClient } from "@/lib/api-client";
import { getQuestionOptionLabel } from "@/lib/question-option-label";
import { getLocalizedExplanation } from "@/lib/localized-explanation";
import type { Locale } from "@/content/marketing";
import Link from "next/link";
import { getLearningFeedback } from "@/content/learning-feedback";

interface Subject {
  id: string;
  nameEn: string;
  nameAr: string;
}
interface Topic {
  id: string;
  nameEn: string;
  nameAr: string;
}
interface Question {
  id: string;
  promptEn: string;
  promptAr: string | null;
  optionsJson: string[] | null;
}
interface QuizResult {
  id: string;
  score: number;
  correctCount: number;
  total: number;
  weakTopicsInQuiz: Array<{ nameEn: string; nameAr: string; percent: number }>;
  recommendedNextSteps: string[];
  breakdown: Array<{
    questionId: string;
    promptEn: string;
    isCorrect: boolean;
    yourAnswer: string;
    correctAnswer: string;
    explanationEn: string | null;
    explanationAr: string | null;
  }>;
}

type QuizType = "topic_assessment" | "mock_exam";

export default function QuizzesPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const isAr = locale === "ar";
  const copy = getQuizzesCopy(locale);
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
  const [quizType, setQuizType] = useState<QuizType>("topic_assessment");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState("");
  const [notOnboarded, setNotOnboarded] = useState(false);

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [assessmentMeta, setAssessmentMeta] = useState<{ requestedCount: number; returnedCount: number; isFullAssessment: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    apiFetch<{ subjects: Subject[] }>("/dashboard/summary")
      .then((data) => {
        if (!active) return;
        setSubjects(data.subjects);
        if (data.subjects[0]) setSubjectId(data.subjects[0].id);
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
    setTopicId("");
    setTopicsLoading(true);
    setError(null);
    setQuestions(null);
    setResult(null);
    apiFetch<Topic[]>(`/practice/topics?subjectId=${subjectId}`)
      .then((data) => {
        if (!active) return;
        setTopics(data);
        if (data[0]) setTopicId(data[0].id);
      })
      .catch(() => { if (active) setError(feedback.loadError); })
      .finally(() => { if (active) { setTopicsLoading(false); setTopicsFor(subjectId); } });
    return () => { active = false; };
  }, [subjectId, retry, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startQuiz() {
    if (busy || topicsLoading || topicsFor !== subjectId || !subjectId || topics.length === 0 ||
        (quizType === "topic_assessment" && !topics.some((topic) => topic.id === topicId))) return;
    setBusy(true);
    setError(null);
    try {
    const query = new URLSearchParams({ subjectId, type: quizType });
    if (quizType === "topic_assessment") query.set("topicId", topicId);
    const data = await apiFetch<{ questions: Question[]; requestedCount: number; returnedCount: number; isFullAssessment: boolean }>(
      `/quizzes/questions?${query.toString()}`,
    );
    if (!data.questions.length) { setError(feedback.questionsUnavailable); return; }
    setQuestions(data.questions);
    setAssessmentMeta({ requestedCount: data.requestedCount, returnedCount: data.returnedCount, isFullAssessment: data.isFullAssessment });
    setAnswers({});
    setResult(null);
    } catch (err: any) {
      setError(err?.status === 400 ? feedback.questionsUnavailable : feedback.loadError);
    } finally { setBusy(false); }
  }

  async function submitQuiz() {
    if (!questions?.length || busy) return;
    setBusy(true);
    setError(null);
    try {
    const res = await apiFetch<QuizResult>("/quizzes/submit", {
      method: "POST",
      body: JSON.stringify({
        subjectId,
        type: quizType,
        topicId: quizType === "topic_assessment" ? topicId : undefined,
        answers: questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? null })),
      }),
    });
    setResult(res);
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
                <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.typeLabel}</span>
                <select
                  value={quizType}
                  disabled={busy}
                  onChange={(e) => setQuizType(e.target.value as QuizType)}
                  className="w-full rounded-sf border border-neutral-300 bg-white px-4 py-2"
                >
                  <option value="topic_assessment">{copy.topicAssessment}</option>
                  <option value="mock_exam">{copy.mockExam}</option>
                </select>
              </label>

              {quizType === "topic_assessment" && (
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.topicLabel}</span>
                  <select
                    value={topicId}
                    onChange={(e) => setTopicId(e.target.value)}
                    className="w-full rounded-sf border border-neutral-300 bg-white px-4 py-2"
                  >
                    {topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {isAr ? t.nameAr : t.nameEn}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <SmartifyButton variant="ai" className="w-full" disabled={busy || topicsLoading || topicsFor !== subjectId || !subjectId || topics.length === 0 || (quizType === "topic_assessment" && !topics.some((topic) => topic.id === topicId))} onClick={startQuiz}>
                {copy.startLabel}
              </SmartifyButton>
            </div>
          )}

          {questions && !result && (
            <div className="mt-8 space-y-6">
              {quizType === "mock_exam" && assessmentMeta && !assessmentMeta.isFullAssessment && (
                <p role="status" className="rounded-sf-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  {copy.incompleteMockNotice(assessmentMeta.returnedCount, assessmentMeta.requestedCount)}
                </p>
              )}
              {questions.map((q, i) => (
                <div key={q.id} className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                  <p className="font-medium text-navy-900">
                    {i + 1}. {isAr && q.promptAr ? q.promptAr : q.promptEn}
                  </p>
                  <div className="mt-4 space-y-2">
                    {(q.optionsJson ?? []).map((opt) => (
                      <label key={opt} className="flex items-center gap-3 text-sm text-neutral-700">
                        <input
                          type="radio"
                          name={q.id}
                          value={opt}
                          checked={answers[q.id] === opt}
                          onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                        />
                        {getQuestionOptionLabel(opt, locale)}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <SmartifyButton variant="ai" className="w-full" disabled={busy} onClick={submitQuiz}>
                {copy.submitLabel}
              </SmartifyButton>
            </div>
          )}

          {result && (
            <div className="mt-8 space-y-6">
              <div className="rounded-sf-lg bg-[--sf-bg-subtle] p-6 text-center">
                <h2 className="text-lg font-semibold text-navy-900">{copy.scoreLabel}</h2>
                <p className="mt-1 text-3xl font-bold text-navy-900">{result.score}%</p>
                <p className="mt-1 text-sm text-neutral-500">
                  {result.correctCount}/{result.total}
                </p>
              </div>

              <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                <h3 className="mb-3 font-semibold text-navy-900">{copy.weakTopicsTitle}</h3>
                {result.weakTopicsInQuiz.length > 0 ? (
                  <ul className="space-y-2 text-sm">
                    {result.weakTopicsInQuiz.map((t) => (
                      <li key={t.nameEn} className="flex justify-between">
                        <span className="text-neutral-700">{isAr ? t.nameAr : t.nameEn}</span>
                        <span className="text-error-500">{t.percent}%</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-neutral-500">{copy.weakTopicsEmpty}</p>
                )}
              </div>

              <div className="rounded-sf-lg bg-navy-900 p-6 text-white">
                <h3 className="mb-3 font-semibold">{copy.nextStepsTitle}</h3>
                <ul className="list-inside list-disc space-y-1 text-sm text-neutral-200">
                  {result.recommendedNextSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>

              {result.breakdown.map((b) => (
                <div key={b.questionId} className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                  <p className="font-medium text-navy-900">{b.promptEn}</p>
                  <span
                    className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-medium ${
                      b.isCorrect ? "bg-success-100 text-success-500" : "bg-error-100 text-error-500"
                    }`}
                  >
                    {b.isCorrect ? "✓" : "✗"} {copy.yourAnswer}: {getQuestionOptionLabel(String(b.yourAnswer), locale)}
                  </span>
                  {!b.isCorrect && (
                    <p className="mt-2 text-sm text-neutral-600">
                      {copy.correctAnswer}: {getQuestionOptionLabel(String(b.correctAnswer), locale)}
                    </p>
                  )}
                  {getLocalizedExplanation(b.explanationEn, b.explanationAr, locale) && (
                    <p className="mt-2 text-sm text-neutral-500">
                      <strong>{copy.explanationLabel}:</strong> {getLocalizedExplanation(b.explanationEn, b.explanationAr, locale)}
                    </p>
                  )}
                </div>
              ))}

              <SmartifyButton
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setQuestions(null);
                  setResult(null);
                }}
              >
                {copy.takeAnother}
              </SmartifyButton>
            </div>
          )}
        </SmartifyContainer>
      </main>
    </>
  );
}
