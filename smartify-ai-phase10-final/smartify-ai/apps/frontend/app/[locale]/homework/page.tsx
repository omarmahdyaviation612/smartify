"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { Navbar } from "@/components/Navbar";
import { useApiClient } from "@/lib/api-client";
import { getMarketingCopy, type Locale } from "@/content/marketing";
import { homeworkCopy } from "@/content/homework";
import { renderTutorMessage } from "@/lib/render-tutor-message";

type Topic = { id: string; nameAr: string; nameEn: string; unitNameAr?: string; unitNameEn?: string };
type Session = { id: string; status: string; extractedQuestion: string; incorrectAttemptCount: number; solutionRevealed: boolean; subject: Topic; topic?: Topic | null; messages: Array<{ id: string; role: string; content: string }> };
type Status = { addonActive: boolean; remaining: number; monthlyLimit: number; eligibleSubjects: Topic[]; available: boolean };
export default function HomeworkPage() {
  const { locale } = useParams<{ locale: Locale }>(); const router = useRouter(); const isAr = locale === "ar";
  const c = homeworkCopy(locale); const { apiFetch } = useApiClient(); const nav = getMarketingCopy(locale);
  const [status, setStatus] = useState<Status | null>(null); const [subjectId, setSubjectId] = useState(""); const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(""); const [session, setSession] = useState<Session | null>(null); const [candidates, setCandidates] = useState<Topic[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]); const [answer, setAnswer] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  async function refresh() { const s = await apiFetch<Status>("/homework/status"); setStatus(s); setSubjectId((old) => old || s.eligibleSubjects[0]?.id || ""); setSessions(await apiFetch<Session[]>("/homework/sessions")); }
  // Load the initial status once; subsequent refreshes follow explicit user actions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh().catch(() => setError(c.error)); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  function clearPhoto() { if (preview) URL.revokeObjectURL(preview); setPreview(""); setFile(null); if (inputRef.current) inputRef.current.value = ""; }
  async function upload() {
    if (!file || !subjectId) return; setBusy(true); setError("");
    const data = new FormData(); data.append("photo", file); data.append("subjectId", subjectId);
    try { const result = await apiFetch<any>("/homework/sessions", { method: "POST", body: data }); setSession({ id: result.sessionId, status: result.status, extractedQuestion: result.extractedQuestion, incorrectAttemptCount: 0, solutionRevealed: false, subject: status!.eligibleSubjects.find(s => s.id === subjectId)!, messages: [] }); setCandidates(result.candidates ?? []); await refresh(); }
    catch { setError(c.error); } finally { clearPhoto(); setBusy(false); }
  }
  async function confirmTopic(topicId: string) { if (!session) return; setBusy(true); try { setSession(await apiFetch<Session>(`/homework/sessions/${session.id}/topic`, { method: "POST", body: JSON.stringify({ topicId }) })); await refresh(); } catch { setError(c.error); } finally { setBusy(false); } }
  async function send(kind: "ANSWER" | "HELP" | "REVEAL_SOLUTION", message = answer) { if (!session) return; setBusy(true); setError(""); try { await apiFetch(`/homework/sessions/${session.id}/turn`, { method: "POST", body: JSON.stringify({ kind, message }) }); setSession(await apiFetch<Session>(`/homework/sessions/${session.id}`)); setAnswer(""); await refresh(); } catch { setError(c.error); } finally { setBusy(false); } }
  async function resume(id: string) { try { setSession(await apiFetch<Session>(`/homework/sessions/${id}`)); setCandidates([]); clearPhoto(); } catch { setError(c.error); } }
  return <><Navbar locale={locale} copy={nav}/><main className="py-10"><SmartifyContainer className="mx-auto max-w-3xl">
    <h1 className="text-3xl font-bold text-navy-900">{c.title}</h1><p className="mt-2 text-neutral-600">{c.subtitle}</p>
    {status && <p className="mt-4 rounded-sf bg-ai-50 p-3 text-sm">{c.remaining}: {status.remaining} / {status.monthlyLimit}</p>}
    {error && <p role="alert" className="mt-3 text-error-500">{error}</p>}
    {!status ? <p className="mt-6">{c.loading}</p> : !status.addonActive ? <section className="mt-6 rounded-sf-lg border p-6"><p>{c.locked}</p><SmartifyButton className="mt-4" onClick={() => router.push(`/${locale}/billing`)}>{c.upgrade}</SmartifyButton></section> : <>
      {!session && <section className="mt-6 rounded-sf-lg border p-6"><label className="block font-medium">{c.subject}<select className="mt-2 block w-full rounded border p-3" value={subjectId} onChange={e => setSubjectId(e.target.value)}>{status.eligibleSubjects.map(s=><option key={s.id} value={s.id}>{isAr?s.nameAr:s.nameEn}</option>)}</select></label>
        {!status.eligibleSubjects.length && <p className="mt-2">{c.noSubjects}</p>}<label className="mt-5 block font-medium">{c.photo}<input ref={inputRef} className="mt-2 block w-full" type="file" accept="image/jpeg,image/png" capture="environment" onChange={e=>{const f=e.target.files?.[0]??null;setFile(f);if(preview)URL.revokeObjectURL(preview);setPreview(f?URL.createObjectURL(f):"");}}/></label>
        {preview&&<img className="mt-3 max-h-64 rounded object-contain" src={preview} alt={c.photo}/>}<p className="mt-2 text-sm text-neutral-500">{c.privacy}</p><SmartifyButton className="mt-4" disabled={!file||!subjectId||busy||!status.remaining} onClick={upload}>{busy?c.loading:c.upload}</SmartifyButton></section>}
      {session&&<section className="mt-6 rounded-sf-lg border p-6"><div className="flex justify-between"><h2 className="font-semibold">{isAr?session.subject?.nameAr:session.subject?.nameEn}</h2><button className="underline" onClick={()=>setSession(null)}>{c.newSession}</button></div><p className="my-4 rounded bg-neutral-50 p-4">{session.extractedQuestion}</p>
        {session.status==="UNSUPPORTED"&&<p>{c.unsupported}</p>}
        {session.status==="AWAITING_TOPIC_CONFIRMATION"&&<><p>{c.topic}</p><div className="mt-3 flex flex-wrap gap-2">{candidates.map(t=><button key={t.id} disabled={busy} onClick={()=>confirmTopic(t.id)} className="rounded border px-4 py-2 text-start hover:border-ai-500"><span className="block">{isAr?t.nameAr:t.nameEn} · {c.confirm}</span><span className="mt-1 block text-xs text-neutral-500">{isAr?t.unitNameAr:t.unitNameEn}</span></button>)}</div></>}
        {session.messages?.map(m=><article key={m.id} className={`my-3 rounded p-3 ${m.role==="assistant"?"bg-ai-50":"bg-neutral-50"}`}>{renderTutorMessage(m.content)}</article>)}
        {session.status==="TUTORING"&&<><p className="text-sm text-neutral-500">{c.attempts}: {session.incorrectAttemptCount} / 3</p><textarea className="mt-3 w-full rounded border p-3" value={answer} onChange={e=>setAnswer(e.target.value)} aria-label={c.answer}/><div className="mt-3 flex flex-wrap gap-2"><SmartifyButton disabled={busy||!answer.trim()} onClick={()=>send("ANSWER")}>{c.send}</SmartifyButton><SmartifyButton variant="secondary" disabled={busy} onClick={()=>send("HELP", "Give me one hint.")}>{c.help}</SmartifyButton><SmartifyButton variant="secondary" disabled={busy} onClick={()=>send("REVEAL_SOLUTION", "Show me the full solution.")}>{c.reveal}</SmartifyButton></div></>}
        {session.status==="SOLVED"&&<p className="mt-4 font-medium">{c.solved}</p>}</section>}
      <section className="mt-8"><h2 className="font-semibold">{c.resume}</h2>{sessions.map(s=><button key={s.id} className="mt-2 block w-full rounded border p-3 text-start" onClick={()=>resume(s.id)}>{s.extractedQuestion || c.unsupported}</button>)}</section>
    </>}
  </SmartifyContainer></main></>;
}
