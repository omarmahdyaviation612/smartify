"use client";

import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
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
  availableSubjects: Array<ParentSubject & { payable: boolean }>;
  subjectUsage: SubjectUsage[];
  weakTopics: WeakTopic[];
};
type TeacherRequest = { id: string; studentId: string; subjectId: string; status: string; createdAt: string; subject: LocalizedName };
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
  const [requiresSignIn, setRequiresSignIn] = useState(false);
  const [teacherRequests, setTeacherRequests] = useState<TeacherRequest[]>([]);
  const [requestSubject, setRequestSubject] = useState<Record<string, string>>({});
  const [requestTimes, setRequestTimes] = useState<Record<string, string>>({});
  const [requestNote, setRequestNote] = useState<Record<string, string>>({});
  const [requestFeedback, setRequestFeedback] = useState("");

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
      try { setTeacherRequests(await apiFetch<TeacherRequest[]>("/parent/teacher-requests")); } catch { setTeacherRequests([]); }
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
          setRequiresSignIn(error instanceof ApiError && error.status === 401);
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

  async function createTeacherRequest(student: Student) {
    const subjectId = requestSubject[student.id] || student.subjects[0]?.id;
    if (!subjectId || !requestTimes[student.id]?.trim()) { setRequestFeedback(isAr ? "اختر مادة واكتب الأوقات المناسبة." : "Choose a subject and preferred times."); return; }
    try {
      await apiFetch("/parent/teacher-requests", { method: "POST", body: JSON.stringify({ studentId: student.id, subjectId, preferredTimes: requestTimes[student.id], contactNote: requestNote[student.id] || undefined }) });
      setTeacherRequests(await apiFetch<TeacherRequest[]>("/parent/teacher-requests"));
      setRequestTimes(current => ({ ...current, [student.id]: "" })); setRequestNote(current => ({ ...current, [student.id]: "" }));
      setRequestFeedback(isAr ? "تم إرسال طلب الجلسة للفريق للمراجعة والتنسيق. لم يتم تأكيد حجز بعد." : "Your session request was sent for review and coordination. No booking is confirmed yet.");
    } catch { setRequestFeedback(isAr ? "تعذر إرسال الطلب. حاول مرة أخرى." : "Could not send the request. Please try again."); }
  }

  return <><Navbar locale={locale} copy={getMarketingCopy(locale)} /><main className="min-h-[70vh] bg-neutral-50 py-10"><SmartifyContainer>
    <h1 className="mb-8 text-3xl font-bold text-navy-900">{isAr ? "لوحة ولي الأمر" : "Parent dashboard"}</h1>

    {accessState === "checking" && <p role="status" className="mb-6 text-sm text-neutral-500">{isAr ? "جاري تحميل بيانات الأبناء..." : "Loading your children's progress..."}</p>}

    {accessState === "unauthorized" && <div className="rounded-sf-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      {isAr ? "افتح رابط الدعوة الذي أرسله لك ابنك لتفعيل لوحة ولي الأمر." : "Open the invitation link sent by your child to activate the parent dashboard."}
    </div>}

    {accessState === "error" && <div role="alert" className="rounded-sf-lg border border-error-200 bg-white p-5 text-sm text-error-600">
      <p>{errorMessage || loadErrorMessage}</p>
      {requiresSignIn && invitationCode && <Link
        href={`/${locale}/sign-in?redirect_url=${encodeURIComponent(`/${locale}/parent?code=${encodeURIComponent(invitationCode)}`)}`}
        className="mt-3 inline-flex rounded border border-sf-blue-300 px-4 py-2 font-medium text-sf-blue-700"
      >{isAr ? "سجّل الدخول ثم أكمل ربط الطفل" : "Sign in to finish linking this child"}</Link>}
      {!invitationCode && <SmartifyButton variant="secondary" className="mt-3" onClick={() => { setAccessState("checking"); void load(); }}>{isAr ? "إعادة المحاولة" : "Try again"}</SmartifyButton>}
    </div>}

    {accessState === "authorized" && students.length === 0 && <p className="rounded-sf-lg border border-neutral-200 bg-white p-5 text-neutral-600">
      {isAr ? "لا يوجد أبناء مرتبطون بهذا الحساب حتى الآن. اطلب من ابنك إرسال رابط دعوة جديد." : "No children are linked to this account yet. Ask your child to send a new invitation link."}
    </p>}

    {accessState === "authorized" && <section className="mb-6 rounded-sf-lg border border-neutral-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-navy-900">{isAr ? "إشعارات نتائج الأبناء" : "Children’s result notifications"}</h2>
      <p className="mt-1 text-sm text-neutral-600">{isAr ? "نرسل نتيجة كل اختبار أو تدريب إلى بريد ولي الأمر المسجل. تتضمن الرسالة اسم الطالب والمادة والنتيجة ووقت الإتمام فقط." : "Quiz and practice results are sent to the parent’s registered email. Each message includes only the student, subject, score, and completion time."}</p>
    </section>}

    {accessState === "authorized" && <div className="space-y-6">{students.map((student) => <article key={student.id} className="rounded-sf-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold text-navy-900">{student.fullName}</h2>
      <p className="mt-2 text-sm text-neutral-600">{isAr ? "المنهج والصف:" : "Curriculum and grade:"} {isAr ? student.curriculum.nameAr : student.curriculum.nameEn} · {isAr ? student.grade.nameAr : student.grade.nameEn}</p>
      <section className="mt-5" aria-label={isAr ? "المواد المسجلة" : "Enrolled subjects"}>
        <h3 className="mb-2 text-lg font-semibold text-navy-900">{isAr ? "المواد" : "Subjects"}</h3>
        {student.subjects.length === 0 ? <p className="text-sm text-neutral-500">{isAr ? "لا توجد مواد مسجلة حتى الآن." : "No subjects selected yet."}</p> : <ul className="flex flex-wrap gap-2">{student.subjects.map((subject) => <li key={subject.id} className="rounded-full bg-neutral-100 px-3 py-1 text-sm text-neutral-700">{localizedSubject(subject.nameEn, subject.nameAr)}</li>)}</ul>}
      </section>
      <Link href={`/${locale}/parent/payments?studentId=${encodeURIComponent(student.id)}`} className="mt-4 inline-flex rounded border border-sf-blue-300 px-4 py-2 text-sm font-medium text-sf-blue-700">{isAr ? "دفع اشتراك لهذا الابن" : "Pay for this child"}</Link>
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
      <section className="mt-7 border-t border-neutral-100 pt-5"><h3 className="text-lg font-semibold text-navy-900">{isAr ? "طلب جلسة مع معلم" : "Request a teacher session"}</h3>
        {student.subjects.length === 0 ? <p className="mt-2 text-sm text-neutral-500">{isAr ? "سجل مادة للطالب أولًا." : "Select a subject for this student first."}</p> : <div className="mt-3 grid gap-3 sm:grid-cols-2"><select aria-label={isAr ? "المادة" : "Subject"} className="rounded border p-2" value={requestSubject[student.id] ?? student.subjects[0]?.id ?? ""} onChange={event => setRequestSubject(v => ({ ...v, [student.id]: event.target.value }))}>{student.subjects.map(subject => <option key={subject.id} value={subject.id}>{localizedSubject(subject.nameEn, subject.nameAr)}</option>)}</select><input aria-label={isAr ? "الأوقات المناسبة" : "Preferred times"} className="rounded border p-2" maxLength={1000} placeholder={isAr ? "الأوقات المناسبة" : "Preferred times"} value={requestTimes[student.id] ?? ""} onChange={event => setRequestTimes(v => ({ ...v, [student.id]: event.target.value }))}/><input aria-label={isAr ? "ملاحظة أو وسيلة تواصل" : "Contact note"} className="rounded border p-2 sm:col-span-2" maxLength={1000} placeholder={isAr ? "ملاحظة أو وسيلة تواصل (اختياري)" : "Contact note (optional)"} value={requestNote[student.id] ?? ""} onChange={event => setRequestNote(v => ({ ...v, [student.id]: event.target.value }))}/><button type="button" onClick={() => void createTeacherRequest(student)} className="rounded bg-navy-900 px-4 py-2 text-sm text-white">{isAr ? "إرسال طلب" : "Send request"}</button></div>}
        {teacherRequests.filter(request => request.studentId === student.id).length > 0 && <ul className="mt-4 space-y-2">{teacherRequests.filter(request => request.studentId === student.id).map(request => <li key={request.id} className="rounded bg-neutral-50 p-3 text-sm">{localizedSubject(request.subject.nameEn, request.subject.nameAr)} · {request.status === "CONFIRMED" ? (isAr ? "تم تأكيد الحجز" : "Booking confirmed") : request.status === "DECLINED" ? (isAr ? "لم تتم الموافقة" : "Declined") : request.status === "CONTACTED" ? (isAr ? "سيتواصل معك الفريق" : "Team will contact you") : (isAr ? "قيد المراجعة — لم يتم تأكيد الحجز" : "Under review — not yet confirmed")}</li>)}</ul>}
        {requestFeedback && <p role="status" className="mt-2 text-sm text-neutral-600">{requestFeedback}</p>}
      </section>
    </article>)}</div>}
  </SmartifyContainer></main></>;
}
