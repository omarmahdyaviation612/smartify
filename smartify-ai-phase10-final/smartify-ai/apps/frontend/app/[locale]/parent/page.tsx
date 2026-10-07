"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { ApiError, useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";
import { getMarketingCopy } from "@/content/marketing";

type RecentActivity = { isCorrect: boolean; attemptedAt: string };
type CompletedLesson = {
  id: string;
  completedAt: string | null;
  topic: { nameEn: string; nameAr: string; unit: { subject: { nameEn: string; nameAr: string } } };
};
type ExamResult = {
  id: string;
  quizType: string;
  score: number;
  correctCount: number;
  totalQuestions: number;
  createdAt: string;
  topic: { nameEn: string; nameAr: string } | null;
};
type LocalizedName = { nameEn: string; nameAr: string };
type ParentSubject = LocalizedName & { id: string };
type SubjectUsage = LocalizedName & { subjectId: string; used: number; limit: number; remaining: number };
type WeakTopic = LocalizedName & {
  topicId: string;
  subjectNameEn: string;
  subjectNameAr: string;
  correct: number;
  total: number;
  percent: number;
};
type Student = {
  id: string;
  fullName: string;
  attempts: number;
  quizzes: number;
  completedLessonsCount: number;
  completedLessons: CompletedLesson[];
  examResults: ExamResult[];
  recentActivity: RecentActivity[];
  curriculum: LocalizedName;
  grade: LocalizedName;
  subjects: ParentSubject[];
  subjectUsage: SubjectUsage[];
  weakTopics: WeakTopic[];
};
type AccessState = "checking" | "authorized" | "unauthorized" | "error";

export default function ParentDashboardPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const searchParams = useSearchParams();
  const isAr = locale === "ar";
  const { apiFetch } = useApiClient();
  const invitationCode = searchParams.get("code")?.trim() ?? "";
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [students, setStudents] = useState<Student[]>([]);
  const [errorMessage, setErrorMessage] = useState("");

  const loadErrorMessage = isAr
    ? "حدث خطأ أثناء تحميل لوحة ولي الأمر. حاول مرة أخرى."
    : "Something went wrong loading your parent dashboard. Please try again.";
  const invitationErrorMessage = isAr
    ? "رابط الدعوة غير صالح أو منتهي الصلاحية. اطلب من ابنك إرسال رابط جديد."
    : "This invitation link is invalid or expired. Ask your child to send a new link.";

  async function load() {
    try {
      const data = await apiFetch<{ students: Student[] }>("/parent/dashboard/summary");
      setStudents(data.students);
      setAccessState("authorized");
    } catch (error) {
      setAccessState(error instanceof ApiError && error.status === 403 ? "unauthorized" : "error");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      if (invitationCode) {
        try {
          await apiFetch("/parent/links/accept", {
            method: "POST",
            body: JSON.stringify({ code: invitationCode }),
          });
          // Reload so the shared role hook sees the newly activated parent
          // role before any role-aware navigation renders.
          if (!cancelled) window.location.replace(`/${locale}/parent`);
        } catch (error) {
          if (cancelled) return;
          setErrorMessage(error instanceof ApiError && error.status === 400 ? invitationErrorMessage : loadErrorMessage);
          setAccessState(error instanceof ApiError && error.status === 403 ? "unauthorized" : "error");
        }
        return;
      }
      await load();
    }
    void initialize();
    return () => { cancelled = true; };
    // The invitation should only be consumed once when this URL is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitationCode, locale]);

  const quizTypeLabel = (type: string) => {
    if (type === "mock_exam") return isAr ? "امتحان تجريبي" : "Mock exam";
    if (type === "topic_assessment") return isAr ? "تقييم موضوع" : "Topic assessment";
    return isAr ? "اختبار" : "Quiz";
  };
  const formatDate = (value: string | null) => value
    ? new Date(value).toLocaleDateString(isAr ? "ar-EG" : "en-GB")
    : "—";
  const isAlwaysArabicSubject = (nameEn: string, nameAr: string) =>
    /arabic|social studies/i.test(nameEn) || /اللغة العربية|الدراسات الاجتماعية/.test(nameAr);
  const localizedSubject = (nameEn: string, nameAr: string) =>
    isAlwaysArabicSubject(nameEn, nameAr) || isAr ? nameAr : nameEn;
  const localizedTopic = (topic: LocalizedName, subject: LocalizedName) =>
    isAlwaysArabicSubject(subject.nameEn, subject.nameAr) || isAr ? topic.nameAr : topic.nameEn;

  return <><Navbar locale={locale} copy={getMarketingCopy(locale)} /><main className="min-h-[70vh] bg-neutral-50 py-10"><SmartifyContainer>
    <h1 className="mb-8 text-3xl font-bold text-navy-900">{isAr ? "لوحة ولي الأمر" : "Parent dashboard"}</h1>

    {accessState === "checking" && <p role="status" className="mb-6 text-sm text-neutral-500">{isAr ? "جاري تحميل بيانات الأبناء..." : "Loading your children's progress..."}</p>}

    {accessState === "unauthorized" && <div className="rounded-sf-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      {isAr ? "افتح رابط الدعوة الذي أرسله لك ابنك لتفعيل لوحة ولي الأمر." : "Open the invitation link sent by your child to activate the parent dashboard."}
    </div>}

    {accessState === "error" && <div role="alert" className="rounded-sf-lg border border-error-200 bg-white p-5 text-sm text-error-600">
      <p>{errorMessage || loadErrorMessage}</p>
      {!invitationCode && <SmartifyButton variant="secondary" className="mt-3" onClick={() => { setAccessState("checking"); void load(); }}>{isAr ? "إعادة المحاولة" : "Try again"}</SmartifyButton>}
    </div>}

    {accessState === "authorized" && students.length === 0 && <p className="rounded-sf-lg border border-neutral-200 bg-white p-5 text-neutral-600">
      {isAr ? "لا يوجد أبناء مرتبطون بهذا الحساب حتى الآن. اطلب من ابنك إرسال رابط دعوة جديد." : "No children are linked to this account yet. Ask your child to send a new invitation link."}
    </p>}

    {accessState === "authorized" && <div className="space-y-6">{students.map((student) => <article key={student.id} className="rounded-sf-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold text-navy-900">{student.fullName}</h2>
      <p className="mt-2 text-sm text-neutral-600">{isAr ? "المنهج والصف:" : "Curriculum and grade:"} {isAr ? student.curriculum.nameAr : student.curriculum.nameEn} · {isAr ? student.grade.nameAr : student.grade.nameEn}</p>
      <section className="mt-5" aria-label={isAr ? "المواد المسجلة" : "Enrolled subjects"}>
        <h3 className="mb-2 text-lg font-semibold text-navy-900">{isAr ? "المواد" : "Subjects"}</h3>
        {student.subjects.length === 0 ? <p className="text-sm text-neutral-500">{isAr ? "لا توجد مواد مسجلة حتى الآن." : "No subjects selected yet."}</p> : <ul className="flex flex-wrap gap-2">{student.subjects.map((subject) => <li key={subject.id} className="rounded-full bg-neutral-100 px-3 py-1 text-sm text-neutral-700">{localizedSubject(subject.nameEn, subject.nameAr)}</li>)}</ul>}
      </section>
      <section className="mt-5 grid gap-3 sm:grid-cols-3" aria-label={isAr ? "ملخص الأداء" : "Performance summary"}>
        <div className="rounded-sf-lg bg-neutral-50 p-4"><p className="text-sm text-neutral-600">{isAr ? "الإجابات المسجلة" : "Answers recorded"}</p><p className="mt-1 text-2xl font-bold text-navy-900">{student.attempts}</p></div>
        <div className="rounded-sf-lg bg-neutral-50 p-4"><p className="text-sm text-neutral-600">{isAr ? "الدروس المكتملة" : "Lessons completed"}</p><p className="mt-1 text-2xl font-bold text-navy-900">{student.completedLessonsCount}</p></div>
        <div className="rounded-sf-lg bg-neutral-50 p-4"><p className="text-sm text-neutral-600">{isAr ? "الاختبارات" : "Assessments"}</p><p className="mt-1 text-2xl font-bold text-navy-900">{student.quizzes}</p></div>
      </section>

      {student.recentActivity.length > 0 && <p className="mt-4 text-sm text-neutral-600">
        {isAr ? "دقة آخر الإجابات:" : "Recent answer accuracy:"} {Math.round(student.recentActivity.filter((attempt) => attempt.isCorrect).length / student.recentActivity.length * 100)}%
      </p>}

      <div className="mt-7 grid gap-7 lg:grid-cols-2">
        <section><h3 className="mb-3 text-lg font-semibold text-navy-900">{isAr ? "الدروس التي أكملها" : "Completed lessons"}</h3>
          {student.completedLessons.length === 0 ? <p className="text-sm text-neutral-500">{isAr ? "لم يُكمل أي درس بعد." : "No lessons completed yet."}</p> : <ul className="divide-y divide-neutral-100">{student.completedLessons.map((lesson) => <li key={lesson.id} className="py-3">
            <p className="font-medium text-navy-900">{localizedTopic(lesson.topic, lesson.topic.unit.subject)}</p>
            <p className="mt-1 text-sm text-neutral-500">{localizedSubject(lesson.topic.unit.subject.nameEn, lesson.topic.unit.subject.nameAr)} · {formatDate(lesson.completedAt)}</p>
          </li>)}</ul>}
        </section>

        <section><h3 className="mb-3 text-lg font-semibold text-navy-900">{isAr ? "نتائج الاختبارات والامتحانات" : "Quiz and exam results"}</h3>
          {student.examResults.length === 0 ? <p className="text-sm text-neutral-500">{isAr ? "لا توجد نتائج اختبارات بعد." : "No quiz or exam results yet."}</p> : <ul className="divide-y divide-neutral-100">{student.examResults.map((result) => <li key={result.id} className="flex items-center justify-between gap-3 py-3">
            <div><p className="font-medium text-navy-900">{result.topic ? (isAr ? result.topic.nameAr : result.topic.nameEn) : quizTypeLabel(result.quizType)}</p><p className="mt-1 text-sm text-neutral-500">{quizTypeLabel(result.quizType)} · {formatDate(result.createdAt)}</p></div>
            <p className="shrink-0 font-semibold text-navy-900">{result.score}% <span className="text-xs font-normal text-neutral-500">({result.correctCount}/{result.totalQuestions})</span></p>
          </li>)}</ul>}
        </section>
      </div>
      <div className="mt-7 grid gap-7 lg:grid-cols-2">
        <section><h3 className="mb-3 text-lg font-semibold text-navy-900">{isAr ? "استخدام المساعد اليوم" : "AI tutor usage today"}</h3>
          {student.subjectUsage.length === 0 ? <p className="text-sm text-neutral-500">{isAr ? "لا توجد مواد لحساب الاستخدام بعد." : "Usage will appear after subjects are selected."}</p> : <ul className="space-y-2">{student.subjectUsage.map((usage) => <li key={usage.subjectId} className="flex items-center justify-between gap-3 rounded-sf-lg bg-neutral-50 p-3 text-sm"><span className="font-medium text-navy-900">{localizedSubject(usage.nameEn, usage.nameAr)}</span><span className="text-neutral-600">{isAr ? `${usage.remaining} من ${usage.limit} سؤال متبقٍ اليوم` : `${usage.remaining} of ${usage.limit} questions remaining today`}</span></li>)}</ul>}
        </section>
        <section><h3 className="mb-3 text-lg font-semibold text-navy-900">{isAr ? "موضوعات مقترحة للمراجعة" : "Topics to review"}</h3>
          {student.attempts === 0 ? <p className="text-sm text-neutral-500">{isAr ? "لا توجد محاولات مسجلة بعد لتحديد موضوعات للمراجعة." : "There are no recorded attempts yet to suggest review topics."}</p> : student.weakTopics.length === 0 ? <p className="text-sm text-neutral-500">{isAr ? "لا توجد موضوعات بحاجة إلى مراجعة بناءً على المحاولات المسجلة." : "No topics need review based on recorded attempts."}</p> : <ul className="space-y-2">{student.weakTopics.map((topic) => <li key={topic.topicId} className="rounded-sf-lg bg-amber-50 p-3"><p className="font-medium text-navy-900">{localizedTopic(topic, { nameEn: topic.subjectNameEn, nameAr: topic.subjectNameAr })}</p><p className="mt-1 text-sm text-neutral-600">{localizedSubject(topic.subjectNameEn, topic.subjectNameAr)} · {isAr ? `${topic.percent}% دقة (${topic.correct} من ${topic.total})` : `${topic.percent}% accuracy (${topic.correct} of ${topic.total})`}</p></li>)}</ul>}
        </section>
      </div>
    </article>)}</div>}
  </SmartifyContainer></main></>;
}
