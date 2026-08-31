"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getQuizzesCopy } from "@/content/quizzes";
import { getMarketingCopy } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import { useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";

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
  }>;
}

type QuizType = "topic_assessment" | "mock_exam";

export default function QuizzesPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const isAr = locale === "ar";
  const copy = getQuizzesCopy(locale);
  const navCopy = getMarketingCopy(locale);
  const { apiFetch } = useApiClient();

  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [quizType, setQuizType] = useState<QuizType>("topic_assessment");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState("");
  const [notOnboarded, setNotOnboarded] = useState(false);

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);

  useEffect(() => {
    apiFetch<{ subjects: Subject[] }>("/dashboard/summary")
      .then((data) => {
        setSubjects(data.subjects);
        if (data.subjects[0]) setSubjectId(data.subjects[0].id);
      })
      .catch(() => setNotOnboarded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!subjectId) return;
    apiFetch<Topic[]>(`/practice/topics?subjectId=${subjectId}`)
      .then((data) => {
        setTopics(data);
        if (data[0]) setTopicId(data[0].id);
      })
      .catch(() => setTopics([]));
  }, [subjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startQuiz() {
    const query = new URLSearchParams({ subjectId, type: quizType });
    if (quizType === "topic_assessment") query.set("topicId", topicId);
    const data = await apiFetch<{ questions: Question[] }>(`/quizzes/questions?${query.toString()}`);
    setQuestions(data.questions);
    setAnswers({});
    setResult(null);
  }

  async function submitQuiz() {
    if (!questions) return;
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
  }

  if (notOnboarded) {
    return (
      <>
        <Navbar locale={locale} copy={navCopy} />
        <main className="flex min-h-[60vh] items-center justify-center text-center text-neutral-600">{copy.noSubjects}</main>
      </>
    );
  }

  return (
    <>
      <Navbar locale={locale} copy={navCopy} />
      <main className="py-12">
        <SmartifyContainer className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-bold text-navy-900">{copy.title}</h1>

          {!questions && subjects && (
            <div className="mt-8 space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.subjectLabel}</span>
                <select
                  value={subjectId}
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

              <SmartifyButton variant="ai" className="w-full" onClick={startQuiz}>
                {copy.startLabel}
              </SmartifyButton>
            </div>
          )}

          {questions && !result && (
            <div className="mt-8 space-y-6">
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
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <SmartifyButton variant="ai" className="w-full" onClick={submitQuiz}>
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
                    {b.isCorrect ? "✓" : "✗"} {copy.yourAnswer}: {b.yourAnswer}
                  </span>
                  {!b.isCorrect && (
                    <p className="mt-2 text-sm text-neutral-600">
                      {copy.correctAnswer}: {b.correctAnswer}
                    </p>
                  )}
                  {b.explanationEn && (
                    <p className="mt-2 text-sm text-neutral-500">
                      <strong>{copy.explanationLabel}:</strong> {b.explanationEn}
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
