import type { Locale } from "./marketing";

/**
 * Privacy Policy and Terms of Service copy — Phase 9.3.
 *
 * Written to reflect ONLY what Smartify AI actually does today: Clerk
 * authentication, student/curriculum/progress data in Postgres, an AI tutor
 * and TTS backed by OpenAI, and a manual InstaPay payment flow (receipt
 * upload + admin verification). No compliance certifications, government
 * approvals, or curriculum partnerships are claimed anywhere below because
 * none exist in the repository. No enumerated retention period or refund
 * guarantee is stated because no such policy exists yet — see the
 * conservative, reviewed-case-by-case wording instead.
 */

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalCopy {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
}

export interface LegalPageCopy {
  privacy: LegalCopy;
  terms: LegalCopy;
}

const LAST_UPDATED = "2026-09-16";

const en: LegalPageCopy = {
  privacy: {
    title: "Privacy Policy",
    lastUpdated: LAST_UPDATED,
    intro:
      "This Privacy Policy explains what information Smartify AI collects, why, and how it is used. It describes the platform as it actually operates today, for the educational service Smartify AI currently provides in Egypt.",
    sections: [
      {
        heading: "Information we collect",
        paragraphs: [
          "Account and authentication information: your name and email address, managed through our authentication provider (Clerk), and an account identifier used to link your activity across the platform.",
          "Student profile information: age, country, and the curriculum, grade, and subjects you or your child are enrolled in.",
          "Parent/student relationship information: if a parent or guardian links to a student's account using an invitation code, we store that link and, if the student or account owner has enabled it, whether the linked parent may also view the student's AI tutor conversation history. A linked parent can see the student's progress and activity through their own parent dashboard.",
          "Learning activity: lessons viewed, practice and quiz attempts, answers submitted, topic mastery, and related progress data used to personalize what is taught next.",
          "AI tutor interactions: the questions and messages you send to the AI tutor and the responses generated for you, which are necessary to provide tutoring within your current lesson and topic.",
          "Audio generated for lessons: where text-to-speech is used to read lesson content aloud, the underlying lesson text is processed to generate that audio.",
          "Voice input: where you use the microphone to speak to the AI tutor instead of typing, your speech is converted to text by your own device's or browser's built-in speech recognition — we do not receive or process the raw audio of your voice. Only the resulting text is sent to Smartify AI, the same as if you had typed it.",
          "Subscription and payment information: the plan and subjects you select, and billing amounts. For manual InstaPay payments specifically, we collect the payment reference code, the amount and sender name you submit, and the receipt image you upload, along with the outcome of our review of that receipt.",
          "Administrative and security records: logs of administrative actions (such as verifying or rejecting a payment) and technical/service logs used to operate and secure the platform.",
        ],
      },
      {
        heading: "How we use this information",
        paragraphs: [
          "To operate your account, curriculum, and subscription; to personalize lessons, practice, and AI tutoring to your current level and progress; to generate AI tutor responses and lesson audio; to process and verify manual InstaPay payments; and to secure the platform and investigate misuse.",
        ],
      },
      {
        heading: "AI processing",
        paragraphs: [
          "Smartify AI's tutor, explanations, and lesson audio are generated using OpenAI's models. The content needed to generate a response — such as your question, the current lesson context, and lesson text for audio — is sent to OpenAI for that purpose. We do not use this processing to make decisions about you beyond providing the tutoring and audio features you requested.",
        ],
      },
      {
        heading: "Manual InstaPay payments",
        paragraphs: [
          "Smartify AI currently supports subscription payment only through manual InstaPay transfer. You transfer funds outside the platform and submit a receipt image, sender name, and the amount transferred. This submission is reviewed by an administrator before any subscription is activated. The receipt image and submission details are retained as part of that verification record.",
        ],
      },
      {
        heading: "Sharing of information",
        paragraphs: [
          "Smartify AI does not sell your personal information. We share information only with the service providers needed to operate the platform — currently Clerk for authentication and OpenAI for AI tutoring and audio generation — and, for payment submissions, with the administrators who review and verify them.",
        ],
      },
      {
        heading: "Cookies and essential technical data",
        paragraphs: [
          "Smartify AI uses a small number of cookies needed for the platform to work: an authentication session cookie set by our authentication provider (Clerk) to keep you signed in, and a language-preference cookie (sf_locale) that remembers whether you use the site in Arabic or English, stored for up to one year. We do not currently use advertising or third-party tracking cookies.",
        ],
      },
      {
        heading: "Data retention",
        paragraphs: [
          "We retain account, learning, and payment records for as long as your account is active, and for a further reasonable period afterward as needed for legal, security, or accounting purposes. We do not currently commit to a fixed retention period for every data type; if you request deletion, we will act on that request as described below.",
        ],
      },
      {
        heading: "Children and student data",
        paragraphs: [
          "Smartify AI is used by students, including children, studying under a parent's or guardian's supervision. We rely on the parent or guardian who creates or manages an account to ensure the information provided is accurate and that the account is used appropriately. If you are a parent or guardian and have concerns about a child's account or data, contact us using the details below.",
        ],
      },
      {
        heading: "Security",
        paragraphs: [
          "We take reasonable technical and organizational measures to protect the information we hold. No online service can guarantee absolute security, and we cannot promise that information will never be accessed, disclosed, or altered in violation of this policy.",
        ],
      },
      {
        heading: "Your choices and data requests",
        paragraphs: [
          "You may request access to, correction of, or deletion of your personal information by contacting Smartify AI support through the app. We do not yet publish a dedicated privacy contact address; this will be added as the platform matures. We will respond to reasonable requests concerning your own account.",
        ],
      },
      {
        heading: "Changes to this policy",
        paragraphs: [
          "We may update this Privacy Policy as Smartify AI's features change. We will update the date above when we do, and continued use of the platform after an update means you accept the revised policy.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    lastUpdated: LAST_UPDATED,
    intro:
      "These Terms of Service govern your use of Smartify AI. By creating an account or using the platform, you agree to these terms.",
    sections: [
      {
        heading: "The service",
        paragraphs: [
          "Smartify AI is an educational assistance platform that provides curriculum-aligned lessons, practice, an AI tutor, and progress tracking. Smartify AI is a learning aid — it does not replace teachers, schools, or official educational institutions, and is not an official curriculum or examination authority.",
          "Using Smartify AI does not guarantee any particular grade, exam result, or other educational outcome. Study results depend on many factors outside our control, including individual effort and official school assessment.",
        ],
      },
      {
        heading: "AI-generated content",
        paragraphs: [
          "Explanations, answers, hints, and audio produced by the AI tutor are generated automatically and may occasionally be incomplete or contain errors. Do not treat AI-generated output as guaranteed authoritative — verify important information, especially before an exam or assignment, with a teacher or official course material.",
        ],
      },
      {
        heading: "Curriculum and originality",
        paragraphs: [
          "Smartify AI uses curriculum structures, topics, and learning objectives as a map for what to teach. The explanations, examples, exercises, quizzes, hints, and tutor responses themselves are generated content, not reproductions of official textbooks. Smartify AI is not an official Ministry of Education platform, is not endorsed by any ministry or examination body, and does not claim any official textbook license or curriculum partnership.",
        ],
      },
      {
        heading: "Accounts",
        paragraphs: [
          "You are responsible for the accuracy of the information on your account and for keeping your sign-in credentials secure. If an account is created or used by or for a student under the supervision of a parent or guardian, that parent or guardian is responsible for the account and its use.",
        ],
      },
      {
        heading: "Acceptable use",
        paragraphs: [
          "You agree not to misuse the platform — including attempting to bypass access controls or payment verification, submitting false or fraudulent payment information, abusing the AI tutor for purposes unrelated to learning, or interfering with the service's normal operation. We may investigate suspected misuse.",
        ],
      },
      {
        heading: "Subscriptions and manual InstaPay payments",
        paragraphs: [
          "Subscription plans are billed per curriculum and subjects selected, as shown at checkout. Smartify AI currently supports subscription payment only through manual InstaPay transfer: you transfer funds and submit a receipt for review.",
          "Submitting a payment reference or receipt does NOT automatically activate your subscription or access. Access is granted only after an administrator manually reviews and verifies the submission. If a submission cannot be verified or is rejected, no subscription or entitlement is activated, and you should review the payment details or follow the resubmission option shown in the app.",
        ],
      },
      {
        heading: "Refunds and cancellations",
        paragraphs: [
          "Smartify AI does not currently operate an automated refund system. Refund requests are reviewed on a case-by-case basis according to the circumstances of the purchase; submitting a request does not guarantee a refund will be issued. You may cancel an active subscription at any time from your billing page; cancellation stops future renewal but does not itself constitute a refund for amounts already paid.",
        ],
      },
      {
        heading: "Intellectual property",
        paragraphs: [
          "Smartify AI and its original lesson content, software, and branding are owned by Smartify AI or its licensors. You retain responsibility for any material you upload, including InstaPay receipt images — do not upload a receipt or document belonging to someone else without their permission.",
        ],
      },
      {
        heading: "Availability",
        paragraphs: [
          "We aim to keep Smartify AI available, but the service may be interrupted for maintenance, technical issues, or circumstances outside our control, and features described as planned or in development may change before they are released.",
        ],
      },
      {
        heading: "Limitation of liability",
        paragraphs: [
          "To the fullest extent permitted by law, Smartify AI is provided on an \"as is\" and \"as available\" basis, and Smartify AI is not liable for indirect, incidental, or consequential damages arising from your use of the platform, including reliance on AI-generated content or interruptions to the service.",
        ],
      },
      {
        heading: "Suspension and termination",
        paragraphs: [
          "We may suspend or terminate access to an account that violates these terms, misuses the AI tutor or payment system, or submits fraudulent payment information.",
        ],
      },
      {
        heading: "Changes to the service or these terms",
        paragraphs: [
          "We may update these Terms of Service or change, add, or remove features as Smartify AI develops. We will update the date above when the terms change, and continued use of the platform after an update means you accept the revised terms.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: [
          "For questions about these terms, contact Smartify AI support through the app. A dedicated support contact address will be published as the platform matures.",
        ],
      },
    ],
  },
};

const ar: LegalPageCopy = {
  privacy: {
    title: "سياسة الخصوصية",
    lastUpdated: LAST_UPDATED,
    intro:
      "توضح سياسة الخصوصية هذه ما هي المعلومات التي تجمعها سمارتيفاي AI، ولماذا، وكيف يتم استخدامها. وهي تصف المنصة كما تعمل فعليًا اليوم، للخدمة التعليمية التي تقدمها سمارتيفاي AI حاليًا في مصر.",
    sections: [
      {
        heading: "المعلومات التي نجمعها",
        paragraphs: [
          "معلومات الحساب والتحقق من الهوية: اسمك وبريدك الإلكتروني، تتم إدارتهما عبر مزوّد المصادقة الخاص بنا (Clerk)، بالإضافة إلى معرّف حساب يُستخدم لربط نشاطك عبر المنصة.",
          "معلومات الملف الدراسي للطالب: العمر والدولة، والمنهج والصف والمواد التي أنت أو طفلك مسجّل بها.",
          "معلومات العلاقة بين ولي الأمر والطالب: إذا قام أحد الوالدين أو ولي الأمر بربط حسابه بحساب الطالب باستخدام رمز دعوة، فإننا نحتفظ بسجل هذا الربط، وبما إذا كان الطالب أو صاحب الحساب قد فعّل السماح لولي الأمر المرتبط بالاطلاع على سجل محادثات المعلم الذكي. يمكن لولي الأمر المرتبط الاطلاع على تقدم الطالب ونشاطه من خلال لوحة تحكم ولي الأمر الخاصة به.",
          "نشاط التعلم: الدروس التي تمت مشاهدتها، محاولات التدريب والاختبارات، الإجابات المُرسلة، ومستوى الإتقان في كل موضوع، وبيانات التقدم المرتبطة بها والمستخدمة لتخصيص ما يتم تدريسه لاحقًا.",
          "التفاعل مع المعلم الذكي: الأسئلة والرسائل التي ترسلها إلى المعلم الذكي والردود التي يتم توليدها لك، وهي ضرورية لتقديم الشرح ضمن درسك وموضوعك الحالي.",
          "الصوت المُولَّد للدروس: عند استخدام تحويل النص إلى صوت لقراءة محتوى الدرس، تتم معالجة نص الدرس لتوليد ذلك الصوت.",
          "الإدخال الصوتي: عند استخدامك للميكروفون للتحدث إلى المعلم الذكي بدلًا من الكتابة، يتم تحويل كلامك إلى نص بواسطة ميزة التعرف على الكلام المدمجة في جهازك أو متصفحك — نحن لا نستقبل أو نعالج التسجيل الصوتي الخام لصوتك. يتم إرسال النص الناتج فقط إلى سمارتيفاي AI، تمامًا كما لو كنت قد كتبته.",
          "معلومات الاشتراك والدفع: الخطة والمواد التي تختارها، ومبالغ الفوترة. وبالنسبة لعمليات الدفع اليدوي عبر إنستاباي تحديدًا، نجمع رمز مرجع الدفع، والمبلغ واسم المُرسل اللذين تُرسلهما، وصورة الإيصال التي ترفعها، إلى جانب نتيجة مراجعتنا لهذا الإيصال.",
          "سجلات إدارية وأمنية: سجلات الإجراءات الإدارية (مثل تأكيد أو رفض عملية دفع) وسجلات تقنية/تشغيلية تُستخدم لتشغيل المنصة وحمايتها.",
        ],
      },
      {
        heading: "كيف نستخدم هذه المعلومات",
        paragraphs: [
          "لتشغيل حسابك ومنهجك واشتراكك؛ لتخصيص الدروس والتدريب والمعلم الذكي حسب مستواك الحالي وتقدمك؛ لتوليد ردود المعلم الذكي وصوت الدروس؛ لمعالجة ومراجعة عمليات الدفع اليدوي عبر إنستاباي؛ ولحماية المنصة والتحقق من أي إساءة استخدام.",
        ],
      },
      {
        heading: "معالجة الذكاء الاصطناعي",
        paragraphs: [
          "يتم توليد شرح المعلم الذكي وإجاباته وصوت الدروس في سمارتيفاي AI باستخدام نماذج OpenAI. يتم إرسال المحتوى اللازم لتوليد الرد — مثل سؤالك وسياق الدرس الحالي ونص الدرس المطلوب تحويله إلى صوت — إلى OpenAI لهذا الغرض فقط. لا نستخدم هذه المعالجة لاتخاذ قرارات بشأنك تتجاوز تقديم ميزات الشرح والصوت التي طلبتها.",
        ],
      },
      {
        heading: "الدفع اليدوي عبر إنستاباي",
        paragraphs: [
          "تدعم سمارتيفاي AI حاليًا دفع الاشتراك فقط عبر التحويل اليدوي بواسطة إنستاباي. تقوم بتحويل المبلغ خارج المنصة ثم إرسال صورة الإيصال واسم المُرسل والمبلغ المُحوَّل. تتم مراجعة هذا الإرسال من قِبل أحد المشرفين قبل تفعيل أي اشتراك. يتم الاحتفاظ بصورة الإيصال وتفاصيل الإرسال كجزء من سجل تلك المراجعة.",
        ],
      },
      {
        heading: "مشاركة المعلومات",
        paragraphs: [
          "لا تبيع سمارتيفاي AI معلوماتك الشخصية. نشارك المعلومات فقط مع مزودي الخدمة اللازمين لتشغيل المنصة — حاليًا Clerk للمصادقة وOpenAI لتشغيل المعلم الذكي وتوليد الصوت — وبالنسبة لعمليات الدفع، مع المشرفين الذين يراجعونها ويؤكدونها.",
        ],
      },
      {
        heading: "ملفات تعريف الارتباط والبيانات التقنية الأساسية",
        paragraphs: [
          "تستخدم سمارتيفاي AI عددًا محدودًا من ملفات تعريف الارتباط (الكوكيز) اللازمة لعمل المنصة: ملف جلسة مصادقة يضبطه مزوّد المصادقة الخاص بنا (Clerk) لإبقائك مسجّل الدخول، وملف تفضيل اللغة (sf_locale) الذي يتذكر ما إذا كنت تستخدم الموقع بالعربية أو الإنجليزية، ويُحفظ لمدة تصل إلى سنة واحدة. لا نستخدم حاليًا ملفات تعريف ارتباط إعلانية أو لتتبع طرف ثالث.",
        ],
      },
      {
        heading: "الاحتفاظ بالبيانات",
        paragraphs: [
          "نحتفظ بسجلات الحساب والتعلم والدفع طوال فترة نشاط حسابك، ولفترة إضافية معقولة بعد ذلك عند الحاجة لأغراض قانونية أو أمنية أو محاسبية. لا نلتزم حاليًا بمدة احتفاظ ثابتة لكل نوع من البيانات؛ وإذا طلبت حذف بياناتك، سنتعامل مع هذا الطلب كما هو موضح أدناه.",
        ],
      },
      {
        heading: "الأطفال وبيانات الطلاب",
        paragraphs: [
          "تُستخدم سمارتيفاي AI من قِبل طلاب، من بينهم أطفال، يدرسون تحت إشراف أحد الوالدين أو ولي الأمر. نعتمد على ولي الأمر الذي يُنشئ الحساب أو يديره للتأكد من دقة المعلومات المُقدَّمة ومن استخدام الحساب بشكل مناسب. إذا كنت وليًا للأمر ولديك استفسار بخصوص حساب طفلك أو بياناته، تواصل معنا عبر التفاصيل أدناه.",
        ],
      },
      {
        heading: "الأمان",
        paragraphs: [
          "نتخذ إجراءات تقنية وتنظيمية معقولة لحماية المعلومات التي نحتفظ بها. لا يمكن لأي خدمة إلكترونية أن تضمن أمانًا مطلقًا، ولا يمكننا التعهد بأن المعلومات لن يتم الوصول إليها أو الكشف عنها أو تعديلها أبدًا بشكل مخالف لهذه السياسة.",
        ],
      },
      {
        heading: "خياراتك وطلبات البيانات",
        paragraphs: [
          "يمكنك طلب الاطلاع على معلوماتك الشخصية أو تصحيحها أو حذفها عبر التواصل مع دعم سمارتيفاي AI من داخل التطبيق. لا يوجد حاليًا بريد إلكتروني مخصص للخصوصية، وسيتم إضافته مع تطور المنصة. سنستجيب للطلبات المعقولة الخاصة بحسابك.",
        ],
      },
      {
        heading: "التعديلات على هذه السياسة",
        paragraphs: [
          "قد نُحدّث سياسة الخصوصية هذه مع تطور ميزات سمارتيفاي AI. سنقوم بتحديث التاريخ أعلاه عند ذلك، واستمرارك في استخدام المنصة بعد أي تحديث يعني موافقتك على السياسة المُعدَّلة.",
        ],
      },
    ],
  },
  terms: {
    title: "شروط الخدمة",
    lastUpdated: LAST_UPDATED,
    intro:
      "تحكم شروط الخدمة هذه استخدامك لسمارتيفاي AI. بإنشائك حسابًا أو استخدامك للمنصة، فإنك توافق على هذه الشروط.",
    sections: [
      {
        heading: "الخدمة",
        paragraphs: [
          "سمارتيفاي AI منصة مساعدة تعليمية تقدم دروسًا متوافقة مع المنهج، وتدريبًا، ومعلمًا ذكيًا، ومتابعة للتقدم. سمارتيفاي AI أداة مساعدة في التعلم — ولا تحل محل المعلمين أو المدارس أو الجهات التعليمية الرسمية، وليست جهة رسمية للمناهج أو الامتحانات.",
          "لا يضمن استخدام سمارتيفاي AI الحصول على درجة أو نتيجة امتحان معينة أو أي نتيجة تعليمية أخرى. تعتمد نتائج الدراسة على عوامل عديدة خارجة عن سيطرتنا، منها الجهد الفردي والتقييم المدرسي الرسمي.",
        ],
      },
      {
        heading: "المحتوى المُولَّد بالذكاء الاصطناعي",
        paragraphs: [
          "الشروحات والإجابات والتلميحات والصوت التي ينتجها المعلم الذكي تُولَّد تلقائيًا وقد تكون أحيانًا غير مكتملة أو تحتوي على أخطاء. لا تعتبر مخرجات الذكاء الاصطناعي مرجعًا مضمون الصحة دائمًا — تحقق من المعلومات المهمة، خاصة قبل امتحان أو واجب، مع معلم أو مصدر دراسي رسمي.",
        ],
      },
      {
        heading: "المنهج والأصالة",
        paragraphs: [
          "تستخدم سمارتيفاي AI هياكل المناهج والموضوعات والأهداف التعليمية كخريطة لما يجب تدريسه. أما الشروحات والأمثلة والتمارين والاختبارات والتلميحات وردود المعلم الذكي نفسها فهي محتوى مُولَّد، وليست نسخًا من الكتب الدراسية الرسمية. سمارتيفاي AI ليست منصة رسمية تابعة لوزارة التربية والتعليم، وليست معتمدة من أي وزارة أو جهة امتحانات، ولا تدّعي أي ترخيص رسمي لكتاب دراسي أو شراكة مع أي منهج.",
        ],
      },
      {
        heading: "الحسابات",
        paragraphs: [
          "أنت مسؤول عن دقة المعلومات الموجودة في حسابك وعن الحفاظ على سرية بيانات تسجيل الدخول الخاصة بك. إذا تم إنشاء الحساب أو استخدامه من قِبل أو لصالح طالب تحت إشراف أحد الوالدين أو ولي الأمر، فإن ذلك الوالد أو ولي الأمر يتحمل مسؤولية الحساب واستخدامه.",
        ],
      },
      {
        heading: "الاستخدام المقبول",
        paragraphs: [
          "توافق على عدم إساءة استخدام المنصة — بما في ذلك محاولة تجاوز ضوابط الوصول أو التحقق من الدفع، أو إرسال معلومات دفع مزيفة أو احتيالية، أو إساءة استخدام المعلم الذكي لأغراض غير متعلقة بالتعلم، أو التأثير على التشغيل الطبيعي للخدمة. يجوز لنا التحقيق في أي إساءة استخدام مشتبه بها.",
        ],
      },
      {
        heading: "الاشتراكات والدفع اليدوي عبر إنستاباي",
        paragraphs: [
          "يتم احتساب خطط الاشتراك حسب المنهج والمواد المختارة، كما تظهر عند الدفع. تدعم سمارتيفاي AI حاليًا دفع الاشتراك فقط عبر التحويل اليدوي بواسطة إنستاباي: تقوم بتحويل المبلغ ثم إرسال إيصال للمراجعة.",
          "إرسال رمز مرجع الدفع أو الإيصال لا يُفعّل اشتراكك أو وصولك تلقائيًا. يُمنح الوصول فقط بعد مراجعة يدوية وتأكيد من أحد المشرفين للإرسال. إذا تعذر التحقق من الإرسال أو تم رفضه، فلن يتم تفعيل أي اشتراك أو صلاحية، وعليك مراجعة تفاصيل الدفع أو استخدام خيار إعادة الإرسال الموضح في التطبيق.",
        ],
      },
      {
        heading: "الاسترداد والإلغاء",
        paragraphs: [
          "لا تُشغّل سمارتيفاي AI حاليًا نظام استرداد تلقائي. تتم مراجعة طلبات الاسترداد حالة بحالة وفقًا لظروف عملية الشراء؛ وتقديم الطلب لا يضمن صدور استرداد. يمكنك إلغاء اشتراك نشط في أي وقت من صفحة الفواتير الخاصة بك؛ ويوقف الإلغاء التجديد المستقبلي لكنه لا يشكل بحد ذاته استردادًا للمبالغ المدفوعة بالفعل.",
        ],
      },
      {
        heading: "الملكية الفكرية",
        paragraphs: [
          "سمارتيفاي AI ومحتوى الدروس الأصلي والبرمجيات والعلامة التجارية مملوكة لسمارتيفاي AI أو للجهات المرخِّصة لها. تظل مسؤولًا عن أي مواد ترفعها، بما في ذلك صور إيصالات إنستاباي — لا ترفع إيصالًا أو مستندًا يخص شخصًا آخر دون إذنه.",
        ],
      },
      {
        heading: "توفر الخدمة",
        paragraphs: [
          "نسعى للحفاظ على توفر سمارتيفاي AI، إلا أن الخدمة قد تنقطع بسبب الصيانة أو مشكلات تقنية أو ظروف خارجة عن إرادتنا، وقد تتغير الميزات الموصوفة بأنها مخطط لها أو قيد التطوير قبل إطلاقها.",
        ],
      },
      {
        heading: "حدود المسؤولية",
        paragraphs: [
          "إلى أقصى حد يسمح به القانون، تُقدَّم سمارتيفاي AI \"كما هي\" و\"كما هي متاحة\"، ولا تتحمل سمارتيفاي AI مسؤولية أي أضرار غير مباشرة أو عرضية أو تبعية ناتجة عن استخدامك للمنصة، بما في ذلك الاعتماد على محتوى مُولَّد بالذكاء الاصطناعي أو انقطاعات الخدمة.",
        ],
      },
      {
        heading: "الإيقاف والإنهاء",
        paragraphs: [
          "يجوز لنا إيقاف أو إنهاء الوصول إلى حساب يخالف هذه الشروط، أو يسيء استخدام المعلم الذكي أو نظام الدفع، أو يُرسل معلومات دفع احتيالية.",
        ],
      },
      {
        heading: "التعديلات على الخدمة أو هذه الشروط",
        paragraphs: [
          "يجوز لنا تحديث شروط الخدمة هذه أو تغيير أو إضافة أو إزالة ميزات مع تطور سمارتيفاي AI. سنقوم بتحديث التاريخ أعلاه عند تغيير الشروط، واستمرارك في استخدام المنصة بعد أي تحديث يعني موافقتك على الشروط المُعدَّلة.",
        ],
      },
      {
        heading: "التواصل",
        paragraphs: [
          "للاستفسار عن هذه الشروط، تواصل مع دعم سمارتيفاي AI من داخل التطبيق. سيتم نشر بريد إلكتروني مخصص للدعم مع تطور المنصة.",
        ],
      },
    ],
  },
};

const copyByLocale: Record<Locale, LegalPageCopy> = { en, ar };
export function getLegalCopy(locale: Locale): LegalPageCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
