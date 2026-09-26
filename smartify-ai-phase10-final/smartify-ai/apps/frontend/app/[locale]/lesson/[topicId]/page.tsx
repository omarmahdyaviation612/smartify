"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getLessonCopy } from "@/content/lesson";
import { getMarketingCopy } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import { ApiError, useApiClient } from "@/lib/api-client";
import { renderTutorMessage } from "@/lib/render-tutor-message";
import type { Locale } from "@/content/marketing";

// Production hotfix (2026-09-25): a raw browser-level transport failure
// (fetch() rejecting before any HTTP response exists — offline, DNS, CORS,
// etc.) surfaces as a plain Error whose message is the native string
// "Failed to fetch" (Chrome) / "NetworkError when attempting to fetch
// resource." (Firefox) — never something a student should see. Only an
// ApiError (see lib/api-client.ts) carries a message actually meant for
// display: it's always derived from a real HTTP response, either the
// backend's own localized/safe error message or apiFetch's own generic
// "Request failed (status)" fallback. Anything else falls back to the
// page's existing localized generic/transient copy instead.
function displayableErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

interface LessonTurn {
  role: "student" | "teacher";
  content: string;
}

interface LessonState {
  started?: boolean;
  sessionId?: string;
  conversationId?: string;
  topicId?: string;
  subjectId?: string;
  status?: string;
  currentStepIndex?: number;
  totalSteps?: number;
  stepType?: string;
  isCheckPending?: boolean;
  readyToContinue?: boolean;
  content?: string | null;
  completed?: boolean;
  visual?: { type: string; status: "NOT_GENERATED" | "GENERATED"; url: string | null } | null;
  preparation?: { status: "PREPARING" | "READY" | "CONFIGURATION_ERROR"; retryAfterMs?: number; stage?: "grounding" | "authoring" };
  retryAfterMs?: number;
  stage?: "grounding" | "authoring";
}

interface LessonCheckQuestion {
  id: string;
  promptEn: string;
  promptAr: string | null;
  optionsJson: string[] | null;
}

// This page teaches ONE lesson step at a time — the database/lesson map
// decides what comes next and in what order; the AI only decides how to
// explain the current step. It is deliberately a SEPARATE page/UI from the
// free-form AI Tutor (/tutor) — the two serve different purposes and this
// page must never replace or duplicate the Tutor's own infrastructure; it
// only reuses the same authenticated API client and the same
// /tutor/speech TTS endpoint (via the shared AIConversation each lesson
// session owns).
export default function InteractiveLessonPage() {
  const { locale, topicId } = useParams<{ locale: Locale; topicId: string }>();
  const isAr = locale === "ar";
  const copy = getLessonCopy(locale);
  const navCopy = getMarketingCopy(locale);
  const { apiFetch, apiFetchBlob } = useApiClient();

  const [state, setState] = useState<LessonState | null>(null);
  const [turns, setTurns] = useState<LessonTurn[]>([]);
  const [resumed, setResumed] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  // Truthful, stage-aware waiting copy for first-time lazy generation
  // (2026-09-26): no fake percentage, just an honest label for whichever
  // REAL backend phase is actually happening — "grounding" (the textbook is
  // being read/understood, one durable chunk at a time) or "authoring" (the
  // lesson itself is being written, which happens synchronously right after
  // grounding finishes). Falls back to elapsed time only to rotate within
  // the (real, ongoing) grounding phase, never to claim a phase that isn't
  // actually happening.
  const [preparingStage, setPreparingStage] = useState<"grounding" | "authoring" | null>(null);
  const preparingSinceRef = useRef<number | null>(null);
  const [slowStart, setSlowStart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);
  const [visualFailed, setVisualFailed] = useState(false);

  // Post-lesson understanding check — a short (3-question) quiz offered
  // once the lesson itself is complete; submitting it is what triggers a
  // parent-notification email server-side (QuizzesService.submitQuiz,
  // type "lesson_check"). `checkQuestions === null` means "not fetched
  // yet"; `[]` means "fetched, nothing available" (e.g. question
  // generation is still catching up) — rendered differently.
  const [checkQuestions, setCheckQuestions] = useState<LessonCheckQuestion[] | null>(null);
  const [checkAnswers, setCheckAnswers] = useState<Record<string, string>>({});
  const [checkSubmitting, setCheckSubmitting] = useState(false);
  const [checkResult, setCheckResult] = useState<{ correctCount: number; total: number; parentsNotified: number } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [micSupported, setMicSupported] = useState(false);
  const recognitionInstance = useRef<any>(null);
  const micTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";
  const [autoPlay, setAutoPlay] = useState(true);
  const [playback, setPlayback] = useState<Record<number, PlaybackStatus>>({});
  const audioElements = useRef<Record<number, HTMLAudioElement>>({});
  const audioUrls = useRef<Record<number, string>>({});
  // GET /lesson/visuals/:id requires the same Bearer auth as every other
  // lesson endpoint, so a plain <img src> can never load it directly (an
  // <img> tag can't send an Authorization header) — fetched once as an
  // authenticated blob and cached by its path, exactly like TTS audio
  // above, so re-rendering/resuming never re-fetches an already-loaded
  // visual.
  const visualBlobUrls = useRef<Record<string, string>>({});
  const [visualObjectUrl, setVisualObjectUrl] = useState<string | null>(null);
  const preparationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preparationRunRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    setMicSupported(Boolean(SpeechRecognitionCtor));
    try {
      const stored = localStorage.getItem("smartify_lesson_autoplay");
      if (stored !== null) setAutoPlay(stored === "1");
    } catch { /* ignore */ }
    const elements = audioElements.current;
    const urls = audioUrls.current;
    const visualUrls = visualBlobUrls.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      preparationRunRef.current += 1;
      if (preparationTimerRef.current) clearTimeout(preparationTimerRef.current);
      Object.values(elements).forEach((audio) => audio.pause());
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
      Object.values(visualUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  function toggleAutoPlay() {
    setAutoPlay((prev) => {
      const next = !prev;
      try { localStorage.setItem("smartify_lesson_autoplay", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  async function playTurn(index: number, text: string, conversationId: string | undefined) {
    const cachedUrl = audioUrls.current[index];
    const existing = audioElements.current[index];
    if (cachedUrl && existing) {
      existing.currentTime = 0;
      try { await existing.play(); } catch { setPlayback((p) => ({ ...p, [index]: "idle" })); }
      return;
    }
    if (!conversationId) { setPlayback((p) => ({ ...p, [index]: "error" })); return; }
    setPlayback((p) => ({ ...p, [index]: "loading" }));
    try {
      const blob = await apiFetchBlob("/tutor/speech", { method: "POST", body: JSON.stringify({ text, conversationId }) });
      const url = URL.createObjectURL(blob);
      audioUrls.current[index] = url;
      const audio = new Audio(url);
      audio.onplay = () => setPlayback((p) => ({ ...p, [index]: "playing" }));
      audio.onpause = () => setPlayback((p) => (p[index] === "playing" ? { ...p, [index]: "paused" } : p));
      audio.onended = () => setPlayback((p) => ({ ...p, [index]: "idle" }));
      audio.onerror = () => setPlayback((p) => ({ ...p, [index]: "error" }));
      audioElements.current[index] = audio;
      try { await audio.play(); } catch { setPlayback((p) => ({ ...p, [index]: "idle" })); }
    } catch {
      setPlayback((p) => ({ ...p, [index]: "error" }));
    }
  }
  function pauseTurn(index: number) { audioElements.current[index]?.pause(); }
  function resumeTurn(index: number) { audioElements.current[index]?.play().catch(() => undefined); }
  function stopTurn(index: number) {
    const audio = audioElements.current[index];
    if (audio) { audio.pause(); audio.currentTime = 0; }
    setPlayback((p) => ({ ...p, [index]: "idle" }));
  }

  function toggleListening() {
    if (listening) { recognitionInstance.current?.stop(); return; }
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

  // Honest, stage-derived waiting copy — never a fake percentage. The
  // stage itself always comes from the backend's real, already-computed
  // state (see LessonState.preparation.stage); elapsed time only rotates
  // the wording WITHIN a real ongoing stage (grounding genuinely does take
  // longer the further in it is), never invents a stage that isn't
  // actually happening.
  function preparingMessage(): string {
    const elapsed = preparingSinceRef.current != null ? Date.now() - preparingSinceRef.current : 0;
    if (preparingStage === "authoring") return elapsed > 15_000 ? copy.almostReady : copy.creatingLesson;
    if (elapsed > 25_000) return copy.almostReady;
    if (elapsed > 8_000) return copy.understandingLesson;
    return copy.preparingTextbook;
  }

  function markPreparing(stage?: "grounding" | "authoring") {
    if (preparingSinceRef.current == null) preparingSinceRef.current = Date.now();
    setPreparing(true);
    if (stage) setPreparingStage(stage);
  }

  function clearPreparing() {
    preparingSinceRef.current = null;
    setPreparingStage(null);
    setPreparing(false);
  }

  useEffect(() => {
    const run = ++preparationRunRef.current;
    apiFetch<LessonState>(`/lesson/topics/${topicId}/state`)
      .then((data) => {
        if (!mountedRef.current || run !== preparationRunRef.current) return;
        setState(data);
        if (!data.started && data.preparation?.status === "PREPARING") {
          markPreparing(data.preparation.stage ?? "grounding");
          schedulePreparation(run, data.preparation.retryAfterMs);
          return;
        }
        if (!data.started && data.preparation?.status === "READY") {
          // Grounding just finished — lesson authoring runs next, synchronously,
          // inside the advance() call this immediately triggers.
          markPreparing(data.preparation.stage ?? "authoring");
          schedulePreparation(run, 0);
          return;
        }
        if (data.started && data.content) {
          setResumed(!data.completed);
          setTurns([{ role: "teacher", content: data.content }]);
          if (autoPlay && !data.completed) playTurn(0, data.content, data.conversationId);
        }
      })
      .catch(() => { if (mountedRef.current && run === preparationRunRef.current) setNotAvailable(true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId]);

  function schedulePreparation(run: number, retryAfterMs = 1500) {
    if (preparationTimerRef.current) clearTimeout(preparationTimerRef.current);
    const delay = Math.min(30_000, Math.max(500, Number.isFinite(retryAfterMs) ? retryAfterMs : 1500));
    preparationTimerRef.current = setTimeout(() => { void advancePreparation(run); }, delay);
  }

  async function advancePreparation(run: number) {
    if (!mountedRef.current || run !== preparationRunRef.current) return;
    try {
      const result = await apiFetch<LessonState>(`/lesson/topics/${topicId}/advance`, { method: "POST" });
      if (!mountedRef.current || run !== preparationRunRef.current) return;
      if (result.status === "PREPARING") {
        markPreparing(result.stage ?? "grounding");
        schedulePreparation(run, result.retryAfterMs);
        return;
      }
      clearPreparing();
      setState(result);
      if (result.content) {
        setTurns([{ role: "teacher", content: result.content }]);
        if (autoPlay) playTurn(0, result.content, result.conversationId);
      }
    } catch (err: any) {
      if (mountedRef.current && run === preparationRunRef.current) {
        clearPreparing();
        setError(displayableErrorMessage(err, copy.genericError));
      }
    }
  }

  // A load failure on one step's visual must not silently hide a later
  // step's own (different) visual — reset per-visual state whenever the
  // visual actually changes, then fetch it (as an authenticated blob) once
  // and cache it, so resuming/re-rendering the same step never re-fetches.
  useEffect(() => {
    setVisualFailed(false);
    const path = state?.visual?.status === "GENERATED" ? state.visual.url : null;
    if (!path) {
      setVisualObjectUrl(null);
      return;
    }
    const cached = visualBlobUrls.current[path];
    if (cached) {
      setVisualObjectUrl(cached);
      return;
    }
    let cancelled = false;
    apiFetchBlob(path)
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        visualBlobUrls.current[path] = objectUrl;
        setVisualObjectUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setVisualFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.visual?.url, state?.visual?.status]);

  // Fetched exactly once, the first time the lesson reaches `completed` —
  // never re-fetched on later re-renders (checkQuestions !== null guards
  // that), so resuming an already-completed lesson doesn't silently
  // re-offer a check the student may have already submitted this session.
  useEffect(() => {
    if (!state?.completed || !state.subjectId || checkQuestions !== null) return;
    apiFetch<{ questions: LessonCheckQuestion[] }>(
      `/quizzes/questions?subjectId=${state.subjectId}&type=lesson_check&topicId=${topicId}`,
    )
      .then((data) => setCheckQuestions(data.questions))
      .catch(() => setCheckQuestions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.completed, state?.subjectId]);

  async function handleCheckSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!checkQuestions || !state?.subjectId) return;
    setCheckSubmitting(true);
    setCheckError(null);
    try {
      const answers = checkQuestions.filter((q) => checkAnswers[q.id] !== undefined).map((q) => ({ questionId: q.id, answer: checkAnswers[q.id] }));
      const result = await apiFetch<{ correctCount: number; total: number; parentsNotified: number }>("/quizzes/submit", {
        method: "POST",
        body: JSON.stringify({ subjectId: state.subjectId, type: "lesson_check", topicId, answers }),
      });
      setCheckResult(result);
    } catch {
      setCheckError(copy.checkError);
    } finally {
      setCheckSubmitting(false);
    }
  }

  async function handleStart() {
    if (preparing || busy) return;
    setBusy(true);
    setError(null);
    // A never-opened Topic can trigger real, first-time content generation
    // (and, for a never-grounded Unit, real-textbook grounding first) —
    // both fully server-side and invisible to the student, but slower than
    // the normal cached-content case. No technical detail is exposed here;
    // this timer just swaps in a friendlier waiting message if the request
    // is still running after a few seconds, and self-resolves back to the
    // normal fast path on every later request to the same (now-cached) topic.
    const slowStartTimer = setTimeout(() => setSlowStart(true), 6000);
    try {
      const result = await apiFetch<LessonState>(`/lesson/topics/${topicId}/advance`, { method: "POST" });
      if (result.status === "PREPARING") {
        const run = ++preparationRunRef.current;
        markPreparing(result.stage ?? "grounding");
        schedulePreparation(run, result.retryAfterMs);
        return;
      }
      setState(result);
      if (result.content) {
        setTurns([{ role: "teacher", content: result.content }]);
        if (autoPlay) playTurn(0, result.content, result.conversationId);
      }
    } catch (err: any) {
      setError(displayableErrorMessage(err, copy.genericError));
    } finally {
      clearTimeout(slowStartTimer);
      setSlowStart(false);
      setBusy(false);
    }
  }

  async function handleContinue() {
    setBusy(true);
    setError(null);
    try {
      const nextIndex = turns.length;
      const result = await apiFetch<LessonState>(`/lesson/topics/${topicId}/advance`, { method: "POST" });
      setState(result);
      if (result.content) {
        setTurns((prev) => [...prev, { role: "teacher", content: result.content! }]);
        if (autoPlay) playTurn(nextIndex, result.content, result.conversationId);
      }
    } catch (err: any) {
      setError(displayableErrorMessage(err, copy.genericError));
    } finally {
      setBusy(false);
    }
  }

  async function handleRespond(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    const message = input.trim();
    setInput("");
    setBusy(true);
    setError(null);
    const studentIndex = turns.length;
    setTurns((prev) => [...prev, { role: "student", content: message }]);
    try {
      const teacherIndex = studentIndex + 1;
      const result = await apiFetch<LessonState>(`/lesson/topics/${topicId}/respond`, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      setState(result);
      if (result.content) {
        setTurns((prev) => [...prev, { role: "teacher", content: result.content! }]);
        if (autoPlay) playTurn(teacherIndex, result.content, result.conversationId);
      }
    } catch (err: any) {
      setError(displayableErrorMessage(err, copy.genericError));
    } finally {
      setBusy(false);
    }
  }

  if (notAvailable) {
    return (
      <>
        <Navbar locale={locale} copy={navCopy} />
        <main className="flex min-h-[60vh] items-center justify-center text-center text-neutral-600">{copy.notAvailable}</main>
      </>
    );
  }

  const totalSteps = state?.totalSteps ?? 0;
  const currentStepIndex = state?.currentStepIndex ?? 0;
  const completed = Boolean(state?.completed);
  // advance()'s response never carries `started` (only getState() does on
  // page load) — a delivered teacher turn is itself proof the lesson has
  // started, regardless of which endpoint produced the current state.
  const started = Boolean(state?.started) || turns.length > 0;

  return (
    <>
      <Navbar locale={locale} copy={navCopy} />
      <main className="flex min-h-[80vh] flex-col py-8">
        <SmartifyContainer className="flex flex-1 flex-col">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              {totalSteps > 0 && (
                <div className="mb-2 flex gap-1" aria-label={`${currentStepIndex + 1} / ${totalSteps}`}>
                  {Array.from({ length: totalSteps }).map((_, i) => (
                    <span
                      key={i}
                      className={`h-2 w-6 rounded-full ${i <= currentStepIndex ? "bg-sf-purple-600" : "bg-neutral-200"}`}
                    />
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={toggleAutoPlay}
              className={`rounded-full border px-3 py-1 text-xs ${autoPlay ? "border-sf-purple-600 text-sf-purple-600" : "border-neutral-300 text-neutral-500"}`}
            >
              {autoPlay ? copy.autoPlayOn : copy.autoPlayOff}
            </button>
          </div>

          {resumed && !completed && <p className="mb-3 text-xs text-neutral-400">{copy.resumedNotice}</p>}

          <div className="flex-1 space-y-4 overflow-y-auto rounded-sf-lg border border-neutral-200 bg-white p-6">
            {turns.length === 0 && !started && (
              <div className="flex h-full flex-col items-center justify-center gap-4">
                {preparing ? (
                  <p role="status" aria-live="polite" className="text-sm text-neutral-500">{preparingMessage()}</p>
                ) : (
                  <SmartifyButton type="button" variant="ai" onClick={handleStart} disabled={busy}>
                    {busy ? (slowStart ? copy.startingFirstTime : copy.starting) : copy.startLesson}
                  </SmartifyButton>
                )}
              </div>
            )}
            {turns.map((t, i) => {
              const status = playback[i] ?? "idle";
              const hasAudio = Boolean(audioUrls.current[i]);
              return (
                <div key={i} className={`flex ${t.role === "student" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-sf-lg px-4 py-3 text-sm ${
                      t.role === "student" ? "bg-sf-blue-500 text-white" : "bg-neutral-100 text-navy-900"
                    }`}
                  >
                    {t.role === "teacher" ? renderTutorMessage(t.content) : <p className="whitespace-pre-wrap">{t.content}</p>}
                    {t.role === "teacher" && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-medium text-sf-purple-600">
                        {status === "loading" && <span className="text-neutral-400">{copy.loadingReply}</span>}
                        {status === "error" && (
                          <>
                            <span className="text-error-500">{copy.ttsUnavailable}</span>
                            <button type="button" onClick={() => playTurn(i, t.content, state?.conversationId)} className="hover:underline">{copy.playReply}</button>
                          </>
                        )}
                        {status === "idle" && (
                          <button type="button" onClick={() => playTurn(i, t.content, state?.conversationId)} className="hover:underline">
                            {hasAudio ? copy.replayReply : copy.playReply}
                          </button>
                        )}
                        {status === "playing" && (
                          <>
                            <button type="button" onClick={() => pauseTurn(i)} className="hover:underline">{copy.pauseReply}</button>
                            <button type="button" onClick={() => stopTurn(i)} className="hover:underline">{copy.stopReply}</button>
                          </>
                        )}
                        {status === "paused" && (
                          <>
                            <button type="button" onClick={() => resumeTurn(i)} className="hover:underline">{copy.resumeReply}</button>
                            <button type="button" onClick={() => stopTurn(i)} className="hover:underline">{copy.stopReply}</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {state?.visual && (
              <div className="flex justify-start">
                {state.visual.status === "GENERATED" && visualObjectUrl && !visualFailed ? (
                  <img
                    src={visualObjectUrl}
                    alt={copy.visualAlt}
                    className="max-h-64 rounded-sf-lg border border-neutral-200"
                    onError={() => setVisualFailed(true)}
                  />
                ) : (
                  // Also the fallback if a GENERATED image fails to load —
                  // the lesson itself (text/TTS/progression) never depends
                  // on this rendering successfully.
                  <div className="flex h-32 w-full max-w-sm items-center justify-center rounded-sf-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 text-center text-xs text-neutral-400">
                    {copy.visualComingSoon}
                  </div>
                )}
              </div>
            )}
            {completed && (
              <div className="rounded-sf-lg bg-[--sf-bg-subtle] p-5 text-center">
                <p className="font-semibold text-navy-900">{copy.completedTitle}</p>
                <p className="mt-1 text-sm text-neutral-600">{copy.completedBody}</p>
              </div>
            )}

            {completed && checkQuestions && checkQuestions.length > 0 && (
              <div className="rounded-sf-lg border border-neutral-200 bg-white p-5">
                <p className="mb-4 font-semibold text-navy-900">{copy.checkTitle}</p>
                {checkResult ? (
                  <div className="text-center text-sm">
                    <p className="font-medium text-navy-900">{copy.checkResult(checkResult.correctCount, checkResult.total)}</p>
                    <p className="mt-1 text-neutral-500">
                      {checkResult.parentsNotified > 0 ? copy.checkParentNotified(checkResult.parentsNotified) : copy.checkNoParentLinked}
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleCheckSubmit} className="space-y-5">
                    {checkQuestions.map((q, qi) => (
                      <fieldset key={q.id}>
                        <legend className="mb-2 text-sm text-neutral-700">
                          {qi + 1}. {isAr && q.promptAr ? q.promptAr : q.promptEn}
                        </legend>
                        <div className="space-y-1">
                          {(q.optionsJson ?? []).map((option) => (
                            <label key={option} className="flex items-center gap-2 text-sm text-neutral-600">
                              <input
                                type="radio"
                                name={q.id}
                                value={option}
                                checked={checkAnswers[q.id] === option}
                                onChange={() => setCheckAnswers((prev) => ({ ...prev, [q.id]: option }))}
                              />
                              {option}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    ))}
                    {checkError && <p className="text-sm text-error-500">{checkError}</p>}
                    <SmartifyButton
                      type="submit"
                      variant="ai"
                      className="w-full"
                      disabled={checkSubmitting || Object.keys(checkAnswers).length < checkQuestions.length}
                    >
                      {checkSubmitting ? copy.checkSubmitting : copy.checkSubmit}
                    </SmartifyButton>
                  </form>
                )}
              </div>
            )}
          </div>

          {listening && <p role="status" aria-live="polite" className="mt-3 text-sm font-medium text-sf-purple-600">{copy.listening}</p>}
          {micError && <p className="mt-3 text-sm text-error-500">{micError}</p>}
          {error && <p className="mt-3 text-sm text-error-500">{error}</p>}

          {started && !completed && (
            <div className="mt-4 flex flex-col gap-3">
              {state?.readyToContinue && (
                <SmartifyButton type="button" variant="ai" className="w-full" onClick={handleContinue} disabled={busy}>
                  {copy.continueLabel}
                </SmartifyButton>
              )}
              {/* Always available, not just while a check is pending — a
                  student can ask a mid-step question (an interruption)
                  without losing their place, even on a step that's already
                  ready to continue. */}
              <form onSubmit={handleRespond} className="flex flex-1 gap-3">
                {micSupported && (
                  <button
                    type="button"
                    onClick={toggleListening}
                    disabled={busy}
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
                  placeholder={state?.readyToContinue ? copy.askPlaceholder : copy.answerPlaceholder}
                  className="flex-1 rounded-sf border border-neutral-300 px-4 py-3"
                  disabled={busy}
                />
                <SmartifyButton type="submit" variant="ai" disabled={busy || !input.trim()}>
                  {copy.sendLabel}
                </SmartifyButton>
              </form>
            </div>
          )}
        </SmartifyContainer>
      </main>
    </>
  );
}
