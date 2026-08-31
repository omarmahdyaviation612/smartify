"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getTutorCopy } from "@/content/tutor";
import { getMarketingCopy } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import { useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";

interface Subject {
  id: string;
  nameEn: string;
  nameAr: string;
}
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function TutorPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const isAr = locale === "ar";
  const copy = getTutorCopy(locale);
  const navCopy = getMarketingCopy(locale);
  const searchParams = useSearchParams();
  const router = useRouter();
  const { apiFetch } = useApiClient();

  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [subjectId, setSubjectId] = useState(searchParams.get("subjectId") ?? "");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [remaining, setRemaining] = useState<{
    dailyRemaining: number;
    extraRemaining: number;
    totalRemaining: number;
    packPriceEGP: number;
    packSize: number;
    isFreeTrial?: boolean;
    trialSubjectId?: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [notOnboarded, setNotOnboarded] = useState(false);
  const trialFinished = Boolean(remaining?.isFreeTrial && remaining.totalRemaining === 0);

  useEffect(() => {
    apiFetch<{ subjects: Subject[] }>("/dashboard/summary")
      .then((data) => {
        setSubjects(data.subjects);
        if (!subjectId && data.subjects[0]) setSubjectId(data.subjects[0].id);
      })
      .catch(() => setNotOnboarded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!subjectId) return;
    apiFetch<{ dailyRemaining: number; extraRemaining: number; totalRemaining: number; packPriceEGP: number; packSize: number }>(`/tutor/question-pack/remaining?subjectId=${subjectId}`)
      .then(setRemaining)
      .catch(() => setRemaining(null));
  }, [subjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !subjectId) return;

    const userMessage = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const res = await apiFetch<{ conversationId: string; reply: string }>(
        "/tutor/message",
        { method: "POST", body: JSON.stringify({ subjectId, conversationId, message: userMessage }) },
      );
      setConversationId(res.conversationId);
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
      const updated = await apiFetch<typeof remaining>(`/tutor/question-pack/remaining?subjectId=${subjectId}`);
      setRemaining(updated);
    } catch (err: any) {
      const msg = err?.message ?? "";
      if (msg.includes("free trial")) setError(copy.freeTrialLimitReached);
      else if (msg.includes("not configured")) setError(copy.notConfigured);
      else if (msg.includes("used today")) setError(copy.limitReached);
      else setError(copy.genericError);
    } finally {
      setSending(false);
    }

  }

  async function handleBuyPack() {
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch<{ checkoutUrl: string }>("/tutor/question-pack/purchase", {
        method: "POST",
        body: JSON.stringify({ subjectId }),
      });
      window.location.href = res.checkoutUrl;
    } catch (err: any) {
      setError(err?.message?.includes("not integrated") || err?.message?.includes("No payment provider") ? copy.notConfigured : copy.genericError);
    } finally {
      setSending(false);
    }
  }

  if (notOnboarded) {
    return (
      <>
        <Navbar locale={locale} copy={navCopy} />
        <main className="flex min-h-[60vh] items-center justify-center text-center text-neutral-600">
          {copy.noSubjects}
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar locale={locale} copy={navCopy} />
      <main className="flex min-h-[80vh] flex-col py-8">
        <SmartifyContainer className="flex flex-1 flex-col">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold text-navy-900">{copy.title}</h1>
            {subjects && subjects.length > 0 && (
              <select
                value={subjectId}
                disabled={Boolean(remaining?.isFreeTrial && remaining.trialSubjectId)}
                onChange={(e) => {
                  setSubjectId(e.target.value);
                  setConversationId(undefined);
                  setMessages([]);
                  router.replace(`/${locale}/tutor?subjectId=${e.target.value}`);
                }}
                className="rounded-sf border border-neutral-300 bg-white px-4 py-2 text-sm"
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {isAr ? s.nameAr : s.nameEn}
                  </option>
                ))}
              </select>
            )}
          </div>

          {remaining && (
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <p className="text-xs text-neutral-500">
                {remaining.isFreeTrial
                  ? copy.freeTrialRemaining(remaining.totalRemaining)
                  : copy.remainingToday(remaining.dailyRemaining, remaining.extraRemaining)}
              </p>
              {remaining.isFreeTrial && remaining.totalRemaining === 0 ? (
                <Link href={`/${locale}/pricing`}>
                  <SmartifyButton type="button" variant="secondary">{copy.subscribeToContinue}</SmartifyButton>
                </Link>
              ) : remaining.totalRemaining === 0 && (
                <SmartifyButton type="button" variant="secondary" onClick={handleBuyPack} disabled={sending}>
                  {sending ? copy.buyingPack : copy.buyPack}
                </SmartifyButton>
              )}
            </div>
          )}

          <div className="flex-1 space-y-4 overflow-y-auto rounded-sf-lg border border-neutral-200 bg-white p-6">
            {messages.length === 0 && <p className="text-sm text-neutral-400">{copy.emptyState}</p>}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-sf-lg px-4 py-3 text-sm ${
                    m.role === "user" ? "bg-sf-blue-500 text-white" : "bg-neutral-100 text-navy-900"
                  }`}
                >
                  {m.role === "assistant" && (
                    <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-sf-purple-600">
                      {copy.aiGeneratedBadge}
                    </span>
                  )}
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ))}
          </div>

          {error && <p className="mt-3 text-sm text-error-500">{error}</p>}

          <form onSubmit={handleSend} className="mt-4 flex gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={copy.inputPlaceholder}
              className="flex-1 rounded-sf border border-neutral-300 px-4 py-3"
              disabled={sending || !subjectId || trialFinished}
            />
            <SmartifyButton type="submit" variant="ai" disabled={sending || !input.trim() || !subjectId || trialFinished}>
              {copy.sendLabel}
            </SmartifyButton>
          </form>
        </SmartifyContainer>
      </main>
    </>
  );
}
