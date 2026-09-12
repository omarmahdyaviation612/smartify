import type { Locale } from "./marketing";

export interface LessonCopy {
  startLesson: string;
  starting: string;
  continueLabel: string;
  answerPlaceholder: string;
  askPlaceholder: string;
  sendLabel: string;
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
  completedTitle: string;
  completedBody: string;
  resumedNotice: string;
  genericError: string;
  notAvailable: string;
  backToDashboard: string;
  visualComingSoon: string;
  visualAlt: string;
}

const en: LessonCopy = {
  startLesson: "Start Lesson",
  starting: "Starting...",
  continueLabel: "Continue",
  answerPlaceholder: "Type your answer or ask a question...",
  askPlaceholder: "Ask a question, or tap Continue...",
  sendLabel: "Send",
  micStart: "Start voice input",
  micStop: "Stop voice input",
  listening: "Listening...",
  micPermissionDenied: "Microphone access was denied.",
  micNoSpeech: "No speech was detected — please try again.",
  transcriptionFailed: "Couldn't understand that — please try again or type instead.",
  autoPlayOn: "Voice: on",
  autoPlayOff: "Voice: off",
  playReply: "Play",
  replayReply: "Replay",
  pauseReply: "Pause",
  resumeReply: "Resume",
  stopReply: "Stop",
  loadingReply: "Loading voice...",
  ttsUnavailable: "Voice playback unavailable.",
  completedTitle: "Lesson complete! 🎉",
  completedBody: "Great work — you've finished this lesson.",
  resumedNotice: "Picking up where you left off.",
  genericError: "Something went wrong. Please try again.",
  notAvailable: "This lesson isn't available yet.",
  backToDashboard: "Back to Dashboard",
  visualComingSoon: "A picture for this part of the lesson is on its way.",
  visualAlt: "An illustration showing today's math idea using pictures instead of numbers.",
};

const ar: LessonCopy = {
  startLesson: "ابدأ الدرس",
  starting: "جاري البدء...",
  continueLabel: "متابعة",
  answerPlaceholder: "اكتب إجابتك أو اسأل سؤالًا...",
  askPlaceholder: "اسأل سؤالًا، أو اضغط متابعة...",
  sendLabel: "إرسال",
  micStart: "بدء الإدخال الصوتي",
  micStop: "إيقاف الإدخال الصوتي",
  listening: "جاري الاستماع...",
  micPermissionDenied: "تم رفض الوصول إلى الميكروفون.",
  micNoSpeech: "لم يتم رصد أي صوت — حاول مرة أخرى.",
  transcriptionFailed: "تعذر فهم ذلك — حاول مرة أخرى أو اكتب بدلاً من ذلك.",
  autoPlayOn: "الصوت: مفعّل",
  autoPlayOff: "الصوت: متوقف",
  playReply: "تشغيل",
  replayReply: "إعادة التشغيل",
  pauseReply: "إيقاف مؤقت",
  resumeReply: "استئناف",
  stopReply: "إيقاف",
  loadingReply: "جاري تجهيز الصوت...",
  ttsUnavailable: "تعذر تشغيل الصوت.",
  completedTitle: "أتممت الدرس! 🎉",
  completedBody: "أحسنت — لقد أنهيت هذا الدرس.",
  resumedNotice: "أكمل من حيث توقفت.",
  genericError: "حدث خطأ ما. حاول مرة أخرى.",
  notAvailable: "هذا الدرس غير متاح بعد.",
  backToDashboard: "العودة إلى لوحة التحكم",
  visualComingSoon: "الصورة الخاصة بهذا الجزء من الدرس في الطريق.",
  visualAlt: "رسم توضيحي يشرح فكرة الرياضيات في هذا الدرس باستخدام الصور بدلاً من الأرقام.",
};

export function getLessonCopy(locale: Locale): LessonCopy {
  return locale === "ar" ? ar : en;
}
