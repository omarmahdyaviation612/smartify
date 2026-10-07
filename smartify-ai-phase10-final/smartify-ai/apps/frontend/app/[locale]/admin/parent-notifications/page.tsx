"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AdminGuard } from "@/components/AdminGuard";
import { SmartifyContainer } from "@smartify/ui";
import { useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";

type FailedNotification = {
  id: string;
  studentName: string;
  completedAt: string;
  channels: Array<{ channel: "email"; status: string }>;
};

export default function AdminParentNotificationsPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const isAr = locale === "ar";
  const { apiFetch } = useApiClient();
  const [items, setItems] = useState<FailedNotification[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = () => apiFetch<FailedNotification[]>("/admin/parent-notifications/failed").then(setItems).catch(() => setError(isAr ? "تعذر تحميل الإشعارات." : "Could not load notifications."));
  useEffect(() => { void load(); /* load once on mount */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function retry(id: string, channel: "email") {
    const key = `${id}:${channel}`; setBusy(key); setError("");
    try { await apiFetch(`/admin/parent-notifications/${id}/retry/${channel}`, { method: "POST" }); await load(); }
    catch { setError(isAr ? "تعذرت إعادة الإرسال." : "Retry failed."); }
    finally { setBusy(null); }
  }
  return <AdminGuard allowedRoles={["SUPER_ADMIN", "ADMIN"]}><main className="py-10"><SmartifyContainer>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold text-navy-900">{isAr ? "إشعارات نتائج أولياء الأمور" : "Parent result notifications"}</h1><button onClick={() => void load()} className="rounded border px-4 py-2 text-sm">{isAr ? "تحديث" : "Refresh"}</button></div>
    <p className="mt-2 text-sm text-neutral-600">{isAr ? "تظهر هنا رسائل البريد الإلكتروني الفاشلة فقط. لن يُعرض البريد أو إجابات الطلاب." : "Only failed email notifications appear here. Parent addresses and student answers are never shown."}</p>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    {items.length === 0 ? <p className="mt-6 rounded border bg-white p-5 text-sm text-neutral-600">{isAr ? "لا توجد إشعارات فاشلة." : "No failed notifications."}</p> : <ul className="mt-6 space-y-3">{items.map(item => <li key={item.id} className="rounded border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold text-navy-900">{item.studentName}</p><p className="text-sm text-neutral-500">{new Date(item.completedAt).toLocaleString(isAr ? "ar-EG" : "en-GB", { timeZone: "Africa/Cairo" })}</p></div><div className="flex flex-wrap gap-2">{item.channels.map(({ channel, status }) => { const key = `${item.id}:${channel}`; return <button key={channel} disabled={busy !== null} onClick={() => void retry(item.id, channel)} className="rounded border border-sf-blue-300 px-3 py-2 text-sm disabled:opacity-50">{busy === key ? (isAr ? "جارٍ الإرسال…" : "Sending…") : `${isAr ? "البريد" : channel} · ${status} · ${isAr ? "إعادة المحاولة" : "Retry"}`}</button>; })}</div></div></li>)}</ul>}
  </SmartifyContainer></main></AdminGuard>;
}
