"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { useApiClient } from "@/lib/api-client";
import { fmtDate } from "@/components/admin/AnalyticsCharts";
import { displayPhone, whatsappUrl } from "@/lib/phone";
import type { Locale } from "@/content/marketing";

// Customer follow-up (2026-10-13): students worth a WhatsApp call — who
// didn't finish onboarding, never tried, tried but didn't pay, or paid and
// went quiet — with the parent's mobile and a feedback note per account.

type Stage = "onboarding" | "registered" | "trial" | "paid_inactive";

interface Item {
  userId: string;
  studentId: string | null;
  name: string | null;
  email: string;
  phone: string | null;
  stage: Stage;
  detail: string | null;
  joinedAt: string;
  lastActiveAt: string | null;
  note: string | null;
  contactedAt: string | null;
}

interface FollowUpResponse {
  inactiveDays: number;
  total: number;
  withPhone: number;
  counts: Record<Stage, number>;
  items: Item[];
}

const STAGES: Stage[] = ["onboarding", "registered", "trial", "paid_inactive"];

const STEP_AR: Record<string, string> = {
  welcome: "صفحة الترحيب",
  profile: "البيانات الشخصية",
  curriculum: "اختيار المنهج",
  "grade-subjects": "الصف والمواد",
  diagnostic: "الاختبار التشخيصي",
  "plan-ready": "الخطة",
};

function copy(ar: boolean, inactiveDays: number) {
  return {
    title: ar ? "متابعة العملاء" : "Customer follow-up",
    subtitle: ar
      ? "كلّم أولياء الأمور على واتساب، اعرف وقفوا ليه، واكتب الفيدباك هنا."
      : "Message parents on WhatsApp, find out why they stopped, and write the feedback here.",
    stage: {
      onboarding: ar ? "ما كمّلش التسجيل" : "Didn't finish sign-up",
      registered: ar ? "سجّل وما جرّبش" : "Signed up, never tried",
      trial: ar ? "جرّب وما دفعش" : "Tried, didn't pay",
      paid_inactive: ar ? `دفع وواقف من ${inactiveDays}+ يوم` : `Paid, inactive ${inactiveDays}+ days`,
    } as Record<Stage, string>,
    all: ar ? "الكل" : "All",
    onlyPhone: ar ? "اللي ليهم رقم بس" : "With phone only",
    hideContacted: ar ? "إخفاء اللي اتكلّموا" : "Hide contacted",
    search: ar ? "ابحث بالاسم أو الإيميل أو الرقم…" : "Search name, email or phone…",
    stoppedAt: ar ? "وقف عند" : "Stopped at",
    noPhone: ar ? "مفيش رقم (سجّل قبل ما الرقم يبقى إجباري)" : "No phone (signed up before it was required)",
    joined: ar ? "سجّل" : "Joined",
    lastActive: ar ? "آخر نشاط" : "Last active",
    notePlaceholder: ar ? "الفيدباك: قالوا إيه؟" : "Feedback: what did they say?",
    save: ar ? "حفظ" : "Save",
    saved: ar ? "اتحفظ" : "Saved",
    contacted: ar ? "اتكلّمت معاه" : "Contacted",
    markContacted: ar ? "علّم إنه اتكلّم" : "Mark contacted",
    undo: ar ? "تراجع" : "Undo",
    empty: ar ? "مفيش حد في القائمة دي." : "Nobody in this list.",
    loading: ar ? "جاري التحميل…" : "Loading…",
    error: ar ? "مقدرناش نحمّل القائمة." : "Couldn't load the list.",
    waText: (name: string | null) =>
      ar
        ? `أهلاً، معاك فريق Smartify${name ? ` بخصوص ${name}` : ""}. حابين نطمن عليكم ونعرف رأيكم في المنصة، وهل في حاجة نقدر نساعد فيها؟`
        : `Hi, this is the Smartify team${name ? ` about ${name}` : ""}. We'd love to hear how it's going and whether we can help with anything.`,
  };
}

function FollowUpRow({ item, t, ar, onSaved }: { item: Item; t: ReturnType<typeof copy>; ar: boolean; onSaved: (next: Item) => void }) {
  const { locale } = useParams<{ locale: Locale }>();
  const { apiFetch } = useApiClient();
  const [note, setNote] = useState(item.note ?? "");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const dirty = note !== (item.note ?? "");

  async function update(body: { note?: string; contacted?: boolean }) {
    setBusy(true);
    try {
      const r = await apiFetch<{ followUpNote: string | null; followUpContactedAt: string | null }>(`/admin/student-analytics/follow-up/${item.userId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      onSaved({ ...item, note: r.followUpNote, contactedAt: r.followUpContactedAt });
      setFlash(true);
      window.setTimeout(() => setFlash(false), 1500);
    } finally {
      setBusy(false);
    }
  }

  const stepLabel = item.stage === "onboarding" ? (item.detail ? (ar ? STEP_AR[item.detail] ?? item.detail : item.detail) : "—") : null;

  return (
    <li className={`rounded-sf-lg border bg-white p-4 ${item.contactedAt ? "border-success-500/40" : "border-neutral-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-navy-900">
            {item.studentId ? (
              <Link href={`/${locale}/admin/students/${item.studentId}`} className="hover:underline">{item.name}</Link>
            ) : (
              item.name ?? item.email
            )}
          </p>
          <p className="text-xs text-neutral-500">{item.email}</p>
          <p className="mt-1 text-sm text-neutral-700">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium">{t.stage[item.stage]}</span>
            {stepLabel && <span className="ms-2 text-xs text-neutral-500">{t.stoppedAt}: {stepLabel}</span>}
            {item.stage !== "onboarding" && item.detail && <span className="ms-2 text-xs text-neutral-500">{item.detail}</span>}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {t.joined}: {fmtDate(item.joinedAt)}
            {item.stage !== "onboarding" && <> · {t.lastActive}: {fmtDate(item.lastActiveAt)}</>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {item.phone ? (
            <a
              href={whatsappUrl(item.phone, t.waText(item.name))}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-sf bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700"
            >
              WhatsApp <span dir="ltr">{displayPhone(item.phone)}</span>
            </a>
          ) : (
            <span className="text-xs text-neutral-400">{t.noPhone}</span>
          )}
          {item.phone && <a href={`tel:${item.phone}`} className="text-xs text-sf-blue-500 hover:underline" dir="ltr">{displayPhone(item.phone)} ☎</a>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t.notePlaceholder}
          maxLength={2000}
          rows={2}
          className="min-w-[14rem] flex-1 rounded-sf border border-neutral-300 px-3 py-2 text-sm"
        />
        <div className="flex flex-col gap-2">
          <button type="button" disabled={busy || !dirty} onClick={() => update({ note })} className="rounded-sf border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40">
            {flash ? t.saved : t.save}
          </button>
          {item.contactedAt ? (
            <button type="button" disabled={busy} onClick={() => update({ contacted: false })} className="text-xs text-neutral-500 hover:underline">
              ✓ {t.contacted} {fmtDate(item.contactedAt)} · {t.undo}
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => update({ contacted: true, ...(dirty ? { note } : {}) })} className="rounded-sf bg-navy-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
              {t.markContacted}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function FollowUpList() {
  const { locale } = useParams<{ locale: Locale }>();
  const ar = locale !== "en";
  const { apiFetch } = useApiClient();
  const [data, setData] = useState<FollowUpResponse | null>(null);
  const [error, setError] = useState(false);
  const [stage, setStage] = useState<Stage | "all">("all");
  const [onlyPhone, setOnlyPhone] = useState(true);
  const [hideContacted, setHideContacted] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    apiFetch<FollowUpResponse>("/admin/student-analytics/follow-up").then(setData).catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = copy(ar, data?.inactiveDays ?? 7);
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "").replace(/^0/, "");
    return (data?.items ?? []).filter((i) =>
      (stage === "all" || i.stage === stage) &&
      (!onlyPhone || !!i.phone) &&
      (!hideContacted || !i.contactedAt) &&
      (!needle || [i.name, i.email].some((v) => v?.toLowerCase().includes(needle)) || (digits.length >= 3 && (i.phone ?? "").includes(digits))),
    );
  }, [data, stage, onlyPhone, hideContacted, q]);

  if (error) return <p className="mt-6 text-sm text-error-500">{t.error}</p>;
  if (!data) return <p className="mt-6 text-neutral-500">{t.loading}</p>;

  const tab = (key: Stage | "all", label: string, count: number) => (
    <button
      key={key}
      type="button"
      onClick={() => setStage(key)}
      className={`rounded-full border px-3 py-1.5 text-sm ${stage === key ? "border-navy-900 bg-navy-900 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
    >
      {label} <span className="opacity-70">({count})</span>
    </button>
  );

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-2">
        {tab("all", t.all, data.total)}
        {STAGES.map((s) => tab(s, t.stage[s], data.counts[s]))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} className="min-w-[14rem] flex-1 rounded-sf border border-neutral-300 px-3 py-1.5 text-sm" />
        <label className="flex items-center gap-1.5 text-sm text-neutral-600"><input type="checkbox" checked={onlyPhone} onChange={(e) => setOnlyPhone(e.target.checked)} /> {t.onlyPhone} ({data.withPhone})</label>
        <label className="flex items-center gap-1.5 text-sm text-neutral-600"><input type="checkbox" checked={hideContacted} onChange={(e) => setHideContacted(e.target.checked)} /> {t.hideContacted}</label>
      </div>
      {items.length === 0 ? (
        <p className="mt-6 text-neutral-500">{t.empty}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <FollowUpRow
              key={item.userId}
              item={item}
              t={t}
              ar={ar}
              onSaved={(next) => setData((d) => (d ? { ...d, items: d.items.map((i) => (i.userId === next.userId ? next : i)) } : d))}
            />
          ))}
        </ul>
      )}
    </>
  );
}

export default function AdminFollowUpPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const ar = locale !== "en";
  const t = copy(ar, 7);
  return (
    <AdminGuard allowedRoles={["SUPER_ADMIN", "ADMIN"]}>
      <main className="py-12">
        <SmartifyContainer>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-navy-900">{t.title}</h1>
              <p className="mt-2 text-sm text-neutral-500">{t.subtitle}</p>
            </div>
            <Link href={`/${locale}/admin/students`} className="text-sm text-sf-blue-500 hover:underline">{ar ? "كل الطلاب ←" : "All students →"}</Link>
          </div>
          <FollowUpList />
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
