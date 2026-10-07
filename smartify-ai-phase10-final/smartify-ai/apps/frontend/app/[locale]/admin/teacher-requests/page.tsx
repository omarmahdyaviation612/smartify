"use client";
import { useEffect, useState } from "react";
import { AdminGuard } from "@/components/AdminGuard";
import { SmartifyContainer } from "@smartify/ui";
import { useApiClient } from "@/lib/api-client";
type RequestItem = { id: string; status: string; student: { fullName: string }; subject: { nameEn: string; nameAr: string }; preferredTimes: string; contactNote: string | null; createdAt: string };
export default function AdminTeacherRequestsPage() {
  const { apiFetch } = useApiClient(); const [items, setItems] = useState<RequestItem[]>([]); const [note, setNote] = useState<Record<string, string>>({}); const [error, setError] = useState("");
  const load = () => apiFetch<RequestItem[]>("/admin/teacher-requests").then(setItems).catch(() => setError("Could not load teacher requests."));
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function changeStatus(item: RequestItem, status: string) { try { await apiFetch(`/admin/teacher-requests/${item.id}/status`, { method: "POST", body: JSON.stringify({ status, adminNote: note[item.id] }) }); await load(); } catch { setError("Could not update request. Refresh and try again."); } }
  return <AdminGuard allowedRoles={["SUPER_ADMIN", "ADMIN"]}><main className="py-10"><SmartifyContainer><h1 className="text-2xl font-bold text-navy-900">Teacher session requests</h1><p className="mt-2 text-sm text-neutral-600">Requests remain unconfirmed until you mark one confirmed.</p>{error && <p role="alert" className="mt-4 text-red-700">{error}</p>}{items.map(item => <article key={item.id} className="mt-4 rounded border bg-white p-5"><h2 className="font-semibold">{item.student.fullName} · {item.subject.nameEn}</h2><p className="mt-2 text-sm">{item.status} · {item.preferredTimes}</p>{item.contactNote && <p className="mt-1 text-sm text-neutral-600">{item.contactNote}</p>}<input className="mt-3 w-full rounded border p-2" maxLength={1000} placeholder="Internal note" value={note[item.id] ?? ""} onChange={e => setNote(v => ({ ...v, [item.id]: e.target.value }))}/><div className="mt-3 flex gap-2">{["CONTACTED", "CONFIRMED", "DECLINED"].map(status => <button key={status} onClick={() => void changeStatus(item, status)} className="rounded border px-3 py-2 text-sm">{status}</button>)}</div></article>)}{items.length === 0 && <p className="mt-5 text-neutral-600">No requests.</p>}</SmartifyContainer></main></AdminGuard>;
}
