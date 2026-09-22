"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SmartifyButton } from "@smartify/ui";
import { useApiClient } from "@/lib/api-client";

interface TrialSubjectState {
  subjectId: string;
  nameEn: string;
  nameAr: string;
  used: boolean;
  topicId: string | null;
}
interface TrialState {
  selected: boolean;
  subjects: TrialSubjectState[];
}
interface BillingSubject {
  id: string;
  nameEn: string;
  nameAr: string;
  priceEGP: number | null;
}
interface TrialTopic {
  id: string;
  nameEn: string;
  nameAr: string;
}

/**
 * Free Trial V1 (2026-09-20) — the student picks their two trial Subjects
 * ONCE (never replaceable), then, per unused Subject, browses its Topics
 * (GET /practice/topics — trial-browsable, see TrialService) and starts a
 * Lesson on the one they choose. The system never auto-picks a Subject or
 * a Topic. Reuses the existing /billing/subjects (grade-scoped pricing
 * list) purely as a subject catalog here — no purchase happens.
 */
export function FreeTrialCard({ isAr, locale }: { isAr: boolean; locale: string }) {
  const { apiFetch } = useApiClient();
  const [state, setState] = useState<TrialState | null>(null);
  const [subjects, setSubjects] = useState<BillingSubject[] | null>(null);
  const [pickedA, setPickedA] = useState("");
  const [pickedB, setPickedB] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expandedSubjectId, setExpandedSubjectId] = useState<string | null>(null);
  const [topicsBySubject, setTopicsBySubject] = useState<Record<string, TrialTopic[]>>({});

  function refetch() {
    apiFetch<TrialState>("/trial/state").then(setState).catch(() => {});
  }

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state && !state.selected && !subjects) {
      apiFetch<BillingSubject[]>("/billing/subjects").then(setSubjects).catch(() => setSubjects([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function submitSelection() {
    if (!pickedA || !pickedB || pickedA === pickedB) {
      setError(isAr ? "اختر مادتين مختلفتين." : "Choose two different subjects.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch("/trial/select-subjects", { method: "POST", body: JSON.stringify({ subjectIds: [pickedA, pickedB] }) });
      refetch();
    } catch (e: any) {
      setError(e?.message ?? (isAr ? "تعذر حفظ اختيارك." : "Could not save your selection."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleTopics(subjectId: string) {
    if (expandedSubjectId === subjectId) {
      setExpandedSubjectId(null);
      return;
    }
    setExpandedSubjectId(subjectId);
    if (!topicsBySubject[subjectId]) {
      try {
        const topics = await apiFetch<TrialTopic[]>(`/practice/topics?subjectId=${subjectId}`);
        setTopicsBySubject((prev) => ({ ...prev, [subjectId]: topics }));
      } catch {
        setTopicsBySubject((prev) => ({ ...prev, [subjectId]: [] }));
      }
    }
  }

  return (
    <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
      <h2 className="font-semibold text-navy-900">{isAr ? "التجربة المجانية" : "Free Trial"}</h2>
      <p className="my-2 text-sm text-neutral-600">
        {isAr ? "اختر مادتين وجرّب درسًا واحدًا مجانيًا من كل مادة." : "Choose 2 subjects and try one lesson from each for free."}
      </p>

      {!state && <p className="text-sm text-neutral-400">{isAr ? "جارٍ التحميل..." : "Loading..."}</p>}

      {state && !state.selected && (
        <div className="space-y-3">
          {!subjects && <p className="text-sm text-neutral-400">{isAr ? "جارٍ التحميل..." : "Loading..."}</p>}
          {subjects && subjects.length > 0 && (
            <>
              <select value={pickedA} onChange={(e) => setPickedA(e.target.value)} className="w-full rounded-sf border border-neutral-300 px-3 py-2 text-sm">
                <option value="">{isAr ? "المادة الأولى" : "First subject"}</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {isAr ? s.nameAr : s.nameEn}
                  </option>
                ))}
              </select>
              <select value={pickedB} onChange={(e) => setPickedB(e.target.value)} className="w-full rounded-sf border border-neutral-300 px-3 py-2 text-sm">
                <option value="">{isAr ? "المادة الثانية" : "Second subject"}</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {isAr ? s.nameAr : s.nameEn}
                  </option>
                ))}
              </select>
              <SmartifyButton onClick={submitSelection} disabled={busy}>
                {isAr ? "تأكيد الاختيار" : "Confirm selection"}
              </SmartifyButton>
              <p className="text-xs text-neutral-400">{isAr ? "لا يمكن تغيير هذا الاختيار لاحقًا." : "This choice cannot be changed later."}</p>
            </>
          )}
          {subjects && subjects.length === 0 && <p className="text-sm text-neutral-500">{isAr ? "لا توجد مواد متاحة." : "No subjects available."}</p>}
        </div>
      )}

      {state && state.selected && (
        <div className="space-y-3">
          {state.subjects.map((s) => (
            <div key={s.subjectId} className="rounded-sf border border-neutral-100 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-navy-900">{isAr ? s.nameAr : s.nameEn}</span>
                {s.used ? (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">{isAr ? "تم الاستخدام" : "Used"}</span>
                ) : (
                  <button onClick={() => toggleTopics(s.subjectId)} className="text-xs text-sf-blue-500 underline">
                    {expandedSubjectId === s.subjectId ? (isAr ? "إخفاء" : "Hide") : (isAr ? "اختر درسًا" : "Choose a lesson")}
                  </button>
                )}
              </div>
              {s.used && s.topicId && (
                <Link href={`/${locale}/lesson/${s.topicId}`} className="mt-1 inline-block text-xs text-sf-blue-500 underline">
                  {isAr ? "متابعة الدرس" : "Continue lesson"}
                </Link>
              )}
              {!s.used && expandedSubjectId === s.subjectId && (
                <ul className="mt-2 space-y-1">
                  {(topicsBySubject[s.subjectId] ?? []).map((t) => (
                    <li key={t.id}>
                      <Link href={`/${locale}/lesson/${t.id}`} className="text-xs text-sf-blue-500 underline">
                        {isAr ? t.nameAr : t.nameEn}
                      </Link>
                    </li>
                  ))}
                  {topicsBySubject[s.subjectId]?.length === 0 && (
                    <li className="text-xs text-neutral-400">{isAr ? "لا توجد دروس متاحة بعد." : "No lessons available yet."}</li>
                  )}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-error-500">{error}</p>}
    </div>
  );
}
