import type { Locale } from "./marketing";

export interface TutorCopy {
  title: string;
  subjectLabel: string;
  inputPlaceholder: string;
  sendLabel: string;
  remainingToday: (dailyRemaining: number, extraRemaining: number) => string;
  buyPack: string;
  buyingPack: string;
  limitReached: string;
  freeTrialLimitReached: string;
  freeTrialRemaining: (remaining: number) => string;
  subscribeToContinue: string;
  notConfigured: string;
  genericError: string;
  emptyState: string;
  noSubjects: string;
  micStart: string;
  micStop: string;
  listening: string;
  micPermissionDenied: string;
  micNoSpeech: string;
  transcriptionFailed: string;
  autoPlayOn: string;
  autoPlayOff: string;
  playReply: string;
  replayReply: string;
  pauseReply: string;
  resumeReply: string;
  stopReply: string;
  loadingReply: string;
  ttsUnavailable: string;
}

const en: TutorCopy = {
  title: "AI Tutor",
  subjectLabel: "Subject",
  inputPlaceholder: "Ask about your current topic...",
  sendLabel: "Send",
  remainingToday: (daily, extra) => `${daily} daily + ${extra} extra questions left for this subject`,
  buyPack: "Buy 10 extra questions - 50 EGP",
  buyingPack: "Opening payment...",
  limitReached: "You've used all questions for this subject.",
  freeTrialLimitReached: "Your free trial is complete. Subscribe to continue learning.",
  freeTrialRemaining: (remaining) => `${remaining} free trial questions remaining`,
  subscribeToContinue: "Subscribe to continue",
  notConfigured: "The AI Tutor isn't fully configured yet on this environment. Please try again later.",
  genericError: "Something went wrong. Please try again.",
  emptyState: "Ask a question about your current lesson to get started.",
  noSubjects: "You haven't selected any subjects yet — complete onboarding first.",
  micStart: "Speak your question",
  micStop: "Stop recording",
  listening: "Listening...",
  micPermissionDenied: "Microphone access was denied. You can still type your question.",
  micNoSpeech: "No speech detected. Try again or type your question.",
  transcriptionFailed: "Couldn't recognize speech. Try again or type your question.",
  autoPlayOn: "Voice replies: on",
  autoPlayOff: "Voice replies: off",
  playReply: "Play",
  replayReply: "Replay",
  pauseReply: "Pause",
  resumeReply: "Resume",
  stopReply: "Stop",
  loadingReply: "Loading voice...",
  ttsUnavailable: "Voice playback isn't available right now.",
};

const ar: TutorCopy = {
  title: "المعلم الذكي",
  subjectLabel: "المادة",
  inputPlaceholder: "اسأل عن موضوعك الحالي...",
  sendLabel: "إرسال",
  remainingToday: (daily, extra) => `${daily} يومية + ${extra} إضافية متبقية لهذه المادة`,
  buyPack: "شراء 10 أسئلة إضافية - 50 جنيه",
  buyingPack: "جاري فتح الدفع...",
  limitReached: "لقد استخدمت كل الأسئلة المتاحة لهذه المادة.",
  freeTrialLimitReached: "انتهت الجلسة التجريبية. اشترك للمتابعة والتعلم.",
  freeTrialRemaining: (remaining) => `متبقي ${remaining} سؤال تجريبي`,
  subscribeToContinue: "اشترك للمتابعة",
  notConfigured: "المعلم الذكي غير مُفعّل بالكامل في هذه البيئة حاليًا. حاول مرة أخرى لاحقًا.",
  genericError: "حدث خطأ ما. حاول مرة أخرى.",
  emptyState: "اطرح سؤالًا عن درسك الحالي للبدء.",
  noSubjects: "لم تختر أي مواد بعد — أكمل التسجيل أولًا.",
  micStart: "اسأل بصوتك",
  micStop: "إيقاف التسجيل",
  listening: "جاري الاستماع...",
  micPermissionDenied: "تم رفض إذن الميكروفون. لا يزال بإمكانك كتابة سؤالك.",
  micNoSpeech: "لم يتم رصد أي كلام. حاول مرة أخرى أو اكتب سؤالك.",
  transcriptionFailed: "تعذّر التعرف على الكلام. حاول مرة أخرى أو اكتب سؤالك.",
  autoPlayOn: "الردود الصوتية: مفعّلة",
  autoPlayOff: "الردود الصوتية: متوقفة",
  playReply: "تشغيل",
  replayReply: "إعادة الاستماع",
  pauseReply: "إيقاف مؤقت",
  resumeReply: "متابعة",
  stopReply: "إيقاف",
  loadingReply: "جاري تجهيز الصوت...",
  ttsUnavailable: "تشغيل الصوت غير متاح حاليًا.",
};

const copyByLocale: Record<Locale, TutorCopy> = { en, ar };
export function getTutorCopy(locale: Locale): TutorCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
