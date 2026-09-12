import type { Locale } from "./marketing";

export type InstapaySubmissionStatus = "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED";

export interface InstapayCopy {
  payWithInstapay: string;
  openingInstapay: string;
  notConfigured: string;
  instructionsTitle: string;
  recipientLabel: string;
  referenceLabel: string;
  expectedAmountLabel: string;
  referenceHint: string;
  amountLabel: string;
  senderNameLabel: string;
  noteLabel: string;
  receiptLabel: string;
  receiptHint: string;
  submitLabel: string;
  submittingLabel: string;
  submitSuccessTitle: string;
  submitSuccessBody: string;
  status: Record<InstapaySubmissionStatus, string>;
  statusBody: Record<InstapaySubmissionStatus, string>;
  invalidFile: string;
  fileTooLarge: string;
  amountRequired: string;
  genericError: string;
  backToBilling: string;
}

const en: InstapayCopy = {
  payWithInstapay: "Pay with InstaPay",
  openingInstapay: "Preparing InstaPay instructions...",
  notConfigured: "InstaPay isn't configured on this environment yet.",
  instructionsTitle: "Pay with InstaPay",
  recipientLabel: "Send to",
  referenceLabel: "Payment reference",
  expectedAmountLabel: "Amount to transfer",
  referenceHint: "Include this reference in your transfer note if possible, then submit your receipt below.",
  amountLabel: "Amount you transferred (EGP)",
  senderNameLabel: "Sender name (optional)",
  noteLabel: "Note (optional)",
  receiptLabel: "Receipt screenshot (JPEG or PNG)",
  receiptHint: "Max 5 MB. A screenshot of the InstaPay confirmation screen works well.",
  submitLabel: "Submit for verification",
  submittingLabel: "Submitting...",
  submitSuccessTitle: "Payment submitted and awaiting verification.",
  submitSuccessBody: "An admin will review your receipt and confirm it. This can take some time — nothing is activated until then.",
  status: {
    PENDING_VERIFICATION: "Pending verification",
    VERIFIED: "Payment confirmed",
    REJECTED: "Payment rejected",
  },
  statusBody: {
    PENDING_VERIFICATION: "Your receipt was submitted and is waiting for admin review.",
    VERIFIED: "Your payment was confirmed and your purchase is active.",
    REJECTED: "Your payment could not be verified. Contact support or try again with a new payment.",
  },
  invalidFile: "Only JPEG or PNG receipt images are supported.",
  fileTooLarge: "Receipt image must be smaller than 5 MB.",
  amountRequired: "Enter the amount you actually transferred.",
  genericError: "Something went wrong. Please try again.",
  backToBilling: "Back to Billing",
};

const ar: InstapayCopy = {
  payWithInstapay: "الدفع عبر إنستاباي",
  openingInstapay: "جاري تجهيز تعليمات إنستاباي...",
  notConfigured: "إنستاباي غير مُفعّل في هذه البيئة حاليًا.",
  instructionsTitle: "الدفع عبر إنستاباي",
  recipientLabel: "التحويل إلى",
  referenceLabel: "رمز مرجع الدفع",
  expectedAmountLabel: "المبلغ المطلوب تحويله",
  referenceHint: "أضف هذا الرمز في ملاحظة التحويل إن أمكن، ثم أرسل صورة الإيصال أدناه.",
  amountLabel: "المبلغ الذي حوّلته (جنيه)",
  senderNameLabel: "اسم المُرسل (اختياري)",
  noteLabel: "ملاحظة (اختياري)",
  receiptLabel: "صورة الإيصال (JPEG أو PNG)",
  receiptHint: "الحد الأقصى 5 ميجابايت. لقطة شاشة لتأكيد إنستاباي كافية.",
  submitLabel: "إرسال للتحقق",
  submittingLabel: "جاري الإرسال...",
  submitSuccessTitle: "تم إرسال الدفع وهو بانتظار التحقق.",
  submitSuccessBody: "سيقوم أحد المشرفين بمراجعة الإيصال وتأكيده. قد يستغرق ذلك بعض الوقت — لن يتم تفعيل أي شيء قبل ذلك.",
  status: {
    PENDING_VERIFICATION: "قيد التحقق",
    VERIFIED: "تم تأكيد الدفع",
    REJECTED: "تم رفض الدفع",
  },
  statusBody: {
    PENDING_VERIFICATION: "تم إرسال إيصالك وهو بانتظار مراجعة المشرف.",
    VERIFIED: "تم تأكيد دفعتك وأصبح طلبك مفعّلاً.",
    REJECTED: "تعذّر التحقق من دفعتك. تواصل مع الدعم أو حاول مجددًا بدفعة جديدة.",
  },
  invalidFile: "يُسمح فقط بصور الإيصال بصيغة JPEG أو PNG.",
  fileTooLarge: "يجب ألا تتجاوز صورة الإيصال 5 ميجابايت.",
  amountRequired: "أدخل المبلغ الذي حوّلته بالفعل.",
  genericError: "حدث خطأ ما. حاول مرة أخرى.",
  backToBilling: "العودة للفواتير",
};

const copyByLocale: Record<Locale, InstapayCopy> = { en, ar };
export function getInstapayCopy(locale: Locale): InstapayCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
