import type { Locale } from "./marketing";

export interface LessonCopy {
  startLesson: string;
  starting: string;
  startingFirstTime: string;
  preparing: string;
  waitingForLesson: string;
  waitingQuotes: string[];
  preparingTextbook: string;
  understandingLesson: string;
  creatingLesson: string;
  almostReady: string;
  continueLabel: string;
  answerPlaceholder: string;
  askPlaceholder: string;
  sendLabel: string;
  micStart: string;
  micStop: string;
  listening: string;
  micPermissionDenied: string;
  micNoSpeech: string;
  micUnavailable: string;
  micNetworkError: string;
  micServiceUnavailable: string;
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
  checkTitle: string;
  checkSubmit: string;
  checkSubmitting: string;
  checkResult: (correct: number, total: number) => string;
  checkResultSaved: string;
  checkError: string;
}

const en: LessonCopy = {
  preparing: "Preparing your lesson...",
  waitingForLesson: "Your lesson is getting ready",
  waitingQuotes: [
    "Every question you ask is a step toward understanding.",
    "Mistakes are clues that help your brain learn.",
    "Small steps every day lead to big discoveries.",
    "Take your time—understanding matters more than speed.",
  ],
  preparingTextbook: "Preparing textbook...",
  understandingLesson: "Understanding this lesson...",
  creatingLesson: "Creating your lesson...",
  almostReady: "Almost ready...",
  startLesson: "Start Lesson",
  starting: "Starting...",
  startingFirstTime: "Getting your lesson ready for the first time — almost there!",
  continueLabel: "Continue",
  answerPlaceholder: "Type your answer or ask a question...",
  askPlaceholder: "Ask a question, or tap Continue...",
  sendLabel: "Send",
  micStart: "Start voice input",
  micStop: "Stop voice input",
  listening: "Listening...",
  micPermissionDenied: "Microphone access was denied.",
  micNoSpeech: "No speech was detected — please try again.",
  micUnavailable: "The microphone isn't available. Check that it's connected and allowed in your browser.",
  micNetworkError: "Speech recognition couldn't connect. Check your internet connection and try again.",
  micServiceUnavailable: "This browser can't start speech recognition right now. Try Chrome or type your answer instead.",
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
  checkTitle: "Quick check — let's see what stuck!",
  checkSubmit: "Submit",
  checkSubmitting: "Checking...",
  checkResult: (correct: number, total: number) => `You got ${correct} out of ${total}.`,
  checkResultSaved: "Your result is saved. Your parent can view it from the parent dashboard.",
  checkError: "Couldn't submit the check — please try again.",
};

const ar: LessonCopy = {
  preparing: "بنجهز لك الدرس...",
  waitingForLesson: "بنجهز درسك دلوقتي",
  waitingQuotes: [
    "كل سؤال بتسأله بيقربك من الفهم.",
    "الغلط بيدلّك على الطريق الصح للتعلّم.",
    "خطوات صغيرة كل يوم توصّلك لاكتشافات كبيرة.",
    "خد وقتك؛ الفهم أهم من السرعة.",
  ],
  preparingTextbook: "بنجهز الكتاب المدرسي...",
  understandingLesson: "بنفهم محتوى الدرس...",
  creatingLesson: "بنجهز درسك...",
  almostReady: "خلصنا تقريبًا...",
  startLesson: "ابدأ الدرس",
  starting: "جاري البدء...",
  startingFirstTime: "بنجهز درسك لأول مرة — تقريبًا خلصنا!",
  continueLabel: "متابعة",
  answerPlaceholder: "اكتب إجابتك أو اسأل سؤالًا...",
  askPlaceholder: "اسأل سؤالًا، أو اضغط متابعة...",
  sendLabel: "إرسال",
  micStart: "بدء الإدخال الصوتي",
  micStop: "إيقاف الإدخال الصوتي",
  listening: "جاري الاستماع...",
  micPermissionDenied: "تم رفض الوصول إلى الميكروفون.",
  micNoSpeech: "لم يتم رصد أي صوت — حاول مرة أخرى.",
  micUnavailable: "الميكروفون غير متاح. تأكد من توصيله والسماح باستخدامه في المتصفح.",
  micNetworkError: "تعذر الاتصال بخدمة التعرّف على الكلام. تحقق من الإنترنت وحاول مرة أخرى.",
  micServiceUnavailable: "تعذر بدء التعرّف على الكلام في هذا المتصفح الآن. جرّب Chrome أو اكتب إجابتك.",
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
  checkTitle: "تأكيد سريع — يلا نشوف قد إيه فاهم!",
  checkSubmit: "إرسال",
  checkSubmitting: "جاري التحقق...",
  checkResult: (correct: number, total: number) => `إجابتك صح في ${correct} من ${total}.`,
  checkResultSaved: "تم حفظ نتيجتك، ويمكن لولي أمرك الاطلاع عليها من لوحة ولي الأمر.",
  checkError: "تعذر إرسال التحقق — حاول مرة أخرى.",
};

export function getLessonCopy(locale: Locale): LessonCopy {
  return locale === "ar" ? ar : en;
}
