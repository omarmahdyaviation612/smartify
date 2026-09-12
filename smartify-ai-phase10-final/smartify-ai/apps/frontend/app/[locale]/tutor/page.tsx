"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getTutorCopy } from "@/content/tutor";
import { getInstapayCopy } from "@/content/instapay";
import { getMarketingCopy } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import { useApiClient } from "@/lib/api-client";
import { renderTutorMessage } from "@/lib/render-tutor-message";
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
  const instapayCopy = getInstapayCopy(locale);
  const navCopy = getMarketingCopy(locale);
  const searchParams = useSearchParams();
  const router = useRouter();
  const { apiFetch, apiFetchBlob } = useApiClient();

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
    freeTrialExhausted?: boolean;
    trialSubjectId?: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [notOnboarded, setNotOnboarded] = useState(false);
  const trialFinished = Boolean(remaining?.isFreeTrial && remaining.totalRemaining === 0);

  // --- Voice INPUT: browser-native SpeechRecognition only (no paid speech
  // API, no backend changes). Recognized text lands in the same `input`
  // state used for typing, so it goes through the exact same handleSend/
  // quota/auth path — voice is never a separate send path. ---
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [micSupported, setMicSupported] = useState(false);
  const recognitionInstance = useRef<any>(null);
  const micTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Voice OUTPUT: server-side OpenAI TTS via POST /tutor/speech (never
  // browser speechSynthesis for AI replies — that read raw Markdown symbols
  // aloud and sounded robotic). Audio is generated once per reply and
  // cached client-side by message index; replay/pause/resume/stop only
  // ever touch the cached <audio> element — no network call, so replay can
  // never consume a Tutor question or call /tutor/message. ---
  type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";
  const [autoPlay, setAutoPlay] = useState(true); // default ON per spec
  const [playback, setPlayback] = useState<Record<number, PlaybackStatus>>({});
  const audioElements = useRef<Record<number, HTMLAudioElement>>({});
  const audioUrls = useRef<Record<number, string>>({});

  useEffect(() => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    setMicSupported(Boolean(SpeechRecognitionCtor));
    try {
      const stored = localStorage.getItem("smartify_tutor_autoplay");
      if (stored !== null) setAutoPlay(stored === "1");
    } catch { /* localStorage unavailable (private mode etc.) — keep default ON */ }
    return () => {
      Object.values(audioElements.current).forEach((audio) => audio.pause());
      Object.values(audioUrls.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  function toggleAutoPlay() {
    setAutoPlay((prev) => {
      const next = !prev;
      try { localStorage.setItem("smartify_tutor_autoplay", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  function resetAudioState() {
    Object.values(audioElements.current).forEach((audio) => audio.pause());
    Object.values(audioUrls.current).forEach((url) => URL.revokeObjectURL(url));
    audioElements.current = {};
    audioUrls.current = {};
    setPlayback({});
  }

  async function playMessage(index: number, text: string, forConversationId: string | undefined) {
    const cachedUrl = audioUrls.current[index];
    const existing = audioElements.current[index];
    if (cachedUrl && existing) {
      // Replay of already-generated audio: no network call at all, so this
      // can never touch /tutor/message or Free Trial quota.
      existing.currentTime = 0;
      try {
        await existing.play();
      } catch {
        // Autoplay blocked by the browser — leave it ready for a manual tap.
        setPlayback((p) => ({ ...p, [index]: "idle" }));
      }
      return;
    }
    if (!forConversationId) {
      setPlayback((p) => ({ ...p, [index]: "error" }));
      return;
    }

    setPlayback((p) => ({ ...p, [index]: "loading" }));
    try {
      // The backend verifies `text` matches an actual assistant reply in
      // `conversationId` before generating any audio — this is not an
      // arbitrary text-to-speech proxy, see TutorSpeechService.synthesize.
      const blob = await apiFetchBlob("/tutor/speech", {
        method: "POST",
        body: JSON.stringify({ text, conversationId: forConversationId }),
      });
      const url = URL.createObjectURL(blob);
      audioUrls.current[index] = url;
      const audio = new Audio(url);
      audio.onplay = () => setPlayback((p) => ({ ...p, [index]: "playing" }));
      audio.onpause = () => setPlayback((p) => (p[index] === "playing" ? { ...p, [index]: "paused" } : p));
      audio.onended = () => setPlayback((p) => ({ ...p, [index]: "idle" }));
      audio.onerror = () => setPlayback((p) => ({ ...p, [index]: "error" }));
      audioElements.current[index] = audio;
      try {
        await audio.play();
      } catch {
        // Autoplay blocked — audio is generated and cached; a manual Play
        // tap will start it with no additional /tutor/speech call.
        setPlayback((p) => ({ ...p, [index]: "idle" }));
      }
    } catch {
      setPlayback((p) => ({ ...p, [index]: "error" }));
    }
  }

  function pauseMessage(index: number) {
    audioElements.current[index]?.pause();
  }

  function resumeMessage(index: number) {
    audioElements.current[index]?.play().catch(() => undefined);
  }

  function stopMessage(index: number) {
    const audio = audioElements.current[index];
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlayback((p) => ({ ...p, [index]: "idle" }));
  }

  function toggleListening() {
    if (listening) {
      recognitionInstance.current?.stop();
      return;
    }
    const SpeechRecognitionCtor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;
    setMicError(null);
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = isAr ? "ar-EG" : "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setListening(true);
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setInput(transcript);
    };
    recognition.onerror = (event: any) => {
      if (event.error === "not-allowed" || event.error === "permission-denied") setMicError(copy.micPermissionDenied);
      else if (event.error === "no-speech") setMicError(copy.micNoSpeech);
      else setMicError(copy.transcriptionFailed);
    };
    recognition.onend = () => {
      setListening(false);
      if (micTimeoutRef.current) { clearTimeout(micTimeoutRef.current); micTimeoutRef.current = null; }
    };

    recognitionInstance.current = recognition;
    recognition.start();
    micTimeoutRef.current = setTimeout(() => recognition.stop(), 30_000);
  }

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
    // /tutor/remaining is the single authoritative quota endpoint for both
    // free-trial and subscribed students (unlike /tutor/question-pack/
    // remaining, which has no concept of the free trial at all).
    apiFetch<typeof remaining>(`/tutor/remaining?subjectId=${subjectId}`)
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
      // `messages` here is this closure's snapshot from before either the
      // user or assistant message was appended in this handleSend call —
      // React does not run setState updater callbacks synchronously, so the
      // assistant's eventual index is this snapshot length + 1 (for the
      // user message appended above), not something read back from state.
      const assistantIndex = messages.length + 1;
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
      // Auto-play starts exactly once, right when the reply arrives — never
      // for the user's own message, and never re-triggered afterward.
      if (autoPlay) playMessage(assistantIndex, res.reply, res.conversationId);
      const updated = await apiFetch<typeof remaining>(`/tutor/remaining?subjectId=${subjectId}`);
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
                  resetAudioState();
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
              <p className={`text-xs ${remaining.isFreeTrial && remaining.freeTrialExhausted ? "font-medium text-error-500" : "text-neutral-500"}`}>
                {remaining.isFreeTrial
                  ? (remaining.freeTrialExhausted ? copy.freeTrialLimitReached : copy.freeTrialRemaining(remaining.totalRemaining))
                  : copy.remainingToday(remaining.dailyRemaining, remaining.extraRemaining)}
              </p>
              {remaining.isFreeTrial && remaining.totalRemaining === 0 ? (
                <Link href={`/${locale}/pricing`}>
                  <SmartifyButton type="button" variant="secondary">{copy.subscribeToContinue}</SmartifyButton>
                </Link>
              ) : remaining.totalRemaining === 0 && (
                <>
                  <SmartifyButton type="button" variant="secondary" onClick={handleBuyPack} disabled={sending}>
                    {sending ? copy.buyingPack : copy.buyPack}
                  </SmartifyButton>
                  <SmartifyButton
                    type="button"
                    variant="secondary"
                    disabled={sending}
                    onClick={() => router.push(`/${locale}/billing/instapay?kind=pack&subjectId=${subjectId}`)}
                  >
                    {instapayCopy.payWithInstapay}
                  </SmartifyButton>
                </>
              )}
              <button
                type="button"
                onClick={toggleAutoPlay}
                className={`rounded-full border px-3 py-1 text-xs ${autoPlay ? "border-sf-purple-600 text-sf-purple-600" : "border-neutral-300 text-neutral-500"}`}
              >
                {autoPlay ? copy.autoPlayOn : copy.autoPlayOff}
              </button>
            </div>
          )}

          <div className="flex-1 space-y-4 overflow-y-auto rounded-sf-lg border border-neutral-200 bg-white p-6">
            {messages.length === 0 && <p className="text-sm text-neutral-400">{copy.emptyState}</p>}
            {messages.map((m, i) => {
              const status = playback[i] ?? "idle";
              const hasAudio = Boolean(audioUrls.current[i]);
              return (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-sf-lg px-4 py-3 text-sm ${
                      m.role === "user" ? "bg-sf-blue-500 text-white" : "bg-neutral-100 text-navy-900"
                    }`}
                  >
                    {m.role === "assistant" ? renderTutorMessage(m.content) : <p className="whitespace-pre-wrap">{m.content}</p>}
                    {m.role === "assistant" && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-medium text-sf-purple-600">
                        {status === "loading" && <span className="text-neutral-400">{copy.loadingReply}</span>}
                        {status === "error" && (
                          <>
                            <span className="text-error-500">{copy.ttsUnavailable}</span>
                            <button type="button" onClick={() => playMessage(i, m.content, conversationId)} className="hover:underline">
                              {copy.playReply}
                            </button>
                          </>
                        )}
                        {status === "idle" && (
                          <button type="button" onClick={() => playMessage(i, m.content, conversationId)} className="hover:underline">
                            {hasAudio ? copy.replayReply : copy.playReply}
                          </button>
                        )}
                        {status === "playing" && (
                          <>
                            <button type="button" onClick={() => pauseMessage(i)} className="hover:underline">{copy.pauseReply}</button>
                            <button type="button" onClick={() => stopMessage(i)} className="hover:underline">{copy.stopReply}</button>
                          </>
                        )}
                        {status === "paused" && (
                          <>
                            <button type="button" onClick={() => resumeMessage(i)} className="hover:underline">{copy.resumeReply}</button>
                            <button type="button" onClick={() => stopMessage(i)} className="hover:underline">{copy.stopReply}</button>
                            <button type="button" onClick={() => playMessage(i, m.content, conversationId)} className="hover:underline">{copy.replayReply}</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {listening && <p role="status" aria-live="polite" className="mt-3 text-sm font-medium text-sf-purple-600">{copy.listening}</p>}
          {micError && <p className="mt-3 text-sm text-error-500">{micError}</p>}
          {error && <p className="mt-3 text-sm text-error-500">{error}</p>}

          <form onSubmit={handleSend} className="mt-4 flex gap-3">
            {micSupported && (
              <button
                type="button"
                onClick={toggleListening}
                disabled={sending || !subjectId || trialFinished}
                aria-pressed={listening}
                title={listening ? copy.micStop : copy.micStart}
                className={`shrink-0 rounded-sf border px-4 py-3 text-sm ${
                  listening ? "border-error-500 bg-error-50 text-error-600" : "border-neutral-300 text-neutral-600"
                } disabled:opacity-50`}
              >
                {listening ? "⏹" : "🎤"}
              </button>
            )}
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
