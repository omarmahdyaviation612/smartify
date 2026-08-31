"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getPracticeCopy } from "@/content/practice";
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
  accuracyPercent: number | null;
}
interface Question {
  id: string;
  type: string;
  promptEn: string;
  promptAr: string | null;
  optionsJson: string[] | null;
}
interface Feedback {
  questionId: string;
  isCorrect: boolean;
  correctAnswer: string;
  explanationEn: string | null;
}

export default function PracticePage() {
  const { locale } = useParams<{ locale: Locale }>();
  const isAr = locale === "ar";
  const copy = getPracticeCopy(locale);
  const navCopy = getMarketingCopy(locale);
  const { apiFetch } = useApiClient();

  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState<string>("");
  const [notOnboarded, setNotOnboarded] = useState(false);

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<{ correctCount: number; total: number; feedback: Feedback[] } | null>(null);

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
    apiFetch<Topic[]>(`/practice/topics?subjectId=${subjectId}`).then(setTopics).catch(() => setTopics([]));
    setTopicId("");
    setQuestions(null);
    setResults(null);
  }, [subjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startPractice() {
    const query = topicId ? `subjectId=${subjectId}&topicId=${topicId}` : `subjectId=${subjectId}`;
    const data = await apiFetch<{ questions: Question[] }>(`/practice/questions?${query}`);
    setQuestions(data.questions);
    setAnswers({});
    setResults(null);
  }

  async function submitPractice() {
    if (!questions) return;
    const res = await apiFetch<{ correctCount: number; total: number; feedback: Feedback[] }>("/practice/submit", {
      method: "POST",
      body: JSON.stringify({ answers: questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? null })) }),
    });
    setResults(res);
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

              <SmartifyButton variant="ai" className="w-full" onClick={startPractice}>
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
              <SmartifyButton variant="ai" className="w-full" onClick={submitPractice}>
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
                    {!f.isCorrect && <p className="mt-2 text-sm text-neutral-600">{copy.correctAnswer}: {String(f.correctAnswer)}</p>}
                    {f.explanationEn && (
                      <p className="mt-2 text-sm text-neutral-500">
                        <strong>{copy.explanationLabel}:</strong> {f.explanationEn}
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
