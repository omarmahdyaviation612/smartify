/**
 * Marketing copy for the homepage — Arabic and English, both production-
 * quality drafts (not lorem ipsum), pending final approval.
 *
 * This is the ONLY place homepage copy lives. Components read from the
 * object returned by getMarketingCopy(locale); they never contain literal
 * marketing strings. Swapping this for a DB-backed CMS later means
 * replacing the body of getMarketingCopy() — component code doesn't change.
 */

export type Locale = "ar" | "en";

export interface MarketingCopy {
  nav: {
    features: string;
    howItWorks: string;
    curricula: string;
    pricing: string;
    forParents: string;
    login: string;
    getStarted: string;
  };
  hero: {
    eyebrow: string;
    headline: string;
    subheadline: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  trustedLearning: {
    title: string;
    body: string;
  };
  curricula: {
    title: string;
    body: string;
    items: Array<{ title: string; description: string }>;
  };
  howItWorks: {
    title: string;
    steps: Array<{ title: string; description: string }>;
  };
  aiPersonalization: {
    title: string;
    body: string;
    points: string[];
  };
  practiceAssessment: {
    title: string;
    body: string;
  };
  progressTracking: {
    title: string;
    body: string;
  };
  parentInsights: {
    title: string;
    body: string;
    ctaLabel: string;
  };
  pricing: {
    title: string;
    body: string;
    note: string; // clarifies pricing is fetched live, this section just introduces it
    ctaLabel: string; // "Subscribe Now" — distinct from the generic nav "Pricing" label
  };
  // Alternative to fabricated testimonials — see Testimonials component notes.
  learningJourneys: {
    title: string;
    body: string;
    items: Array<{ title: string; description: string }>;
  };
  finalCta: {
    title: string;
    body: string;
    ctaLabel: string;
    signUpPrompt?: string;
  };
  footer: {
    tagline: string;
    rights: string;
    privacyPolicy: string;
    termsOfService: string;
  };
}

const en: MarketingCopy = {
  nav: {
    features: "Features",
    howItWorks: "How It Works",
    curricula: "Curricula",
    pricing: "Pricing",
    forParents: "For Parents",
    login: "Log In",
    getStarted: "Get Started",
  },
  hero: {
    eyebrow: "AI-Powered Learning",
    headline: "Smarter Learning. Powered by AI.",
    subheadline:
      "Smartify AI builds a personalized learning path for every student — aligned to their exact curriculum, grade, and subject, with an AI tutor that stays within the lesson and explains things clearly.",
    ctaPrimary: "Start Learning Free",
    ctaSecondary: "Explore Smartify AI",
  },
  trustedLearning: {
    title: "Built around how students actually learn",
    body:
      "Every explanation, question, and practice session is grounded in the student's real curriculum and current level — not a generic chatbot answering from anywhere.",
  },
  curricula: {
    title: "Choose Your Curriculum",
    body: "Smartify AI supports the systems Egyptian families actually study — each with its own grades, subjects, and pricing.",
    items: [
      { title: "Local / Custom Curriculum", description: "Flexible support for local and custom study tracks." },
      { title: "Egyptian National Curriculum", description: "Aligned to the official Egyptian national system." },
      { title: "British International Curriculum", description: "For students following the British international system." },
      { title: "American International Curriculum", description: "For students following the American international system." },
    ],
  },
  howItWorks: {
    title: "How Smartify AI Works",
    steps: [
      { title: "Tell us where the student is", description: "Curriculum, grade, and subjects — set once, refined by an adaptive diagnostic." },
      { title: "Get a personalized plan", description: "The AI identifies gaps and builds a learning path around them." },
      { title: "Learn, practice, get explained answers", description: "Step-by-step teaching, adaptive practice, and clear explanations of mistakes — always tied to the current lesson and topic." },
      { title: "Track real progress", description: "Mastery by topic, streaks, and weak-area alerts, visible to students and parents." },
    ],
  },
  aiPersonalization: {
    title: "AI That Stays On Topic",
    body: "The AI tutor is scoped to the student's current curriculum, grade, and lesson — it teaches within the topic instead of wandering off into unrelated territory.",
    points: [
      "Personalized to age, level, and learning speed",
      "Interactive, step-by-step explanations — not just answers",
      "Adapts difficulty based on how the student is actually doing",
      "Escalates to a real teacher session when a topic needs one",
    ],
  },
  practiceAssessment: {
    title: "Practice That Adapts",
    body: "Multiple question types, difficulty that adjusts automatically, and mock exams that mirror what students will actually face.",
  },
  progressTracking: {
    title: "See Real Progress, Not Just Activity",
    body: "Daily, weekly, and monthly views of mastery by topic — so it's clear what's actually improving, not just how much time was spent online.",
  },
  parentInsights: {
    title: "Built for Parents, Too",
    body: "Parents get visibility into strengths, weaknesses, and study time — without exposing a student's private AI conversations unless the family chooses to share them.",
    ctaLabel: "Learn more for parents",
  },
  pricing: {
    title: "Simple, Subject-Based Pricing",
    body: "Pricing is set per curriculum and education level, in Egyptian Pounds, with a set number of subjects included and clear pricing for each additional subject.",
    note: "Every subject includes a daily allowance of AI questions. Need more? Configurable question packages will be available soon.",
    ctaLabel: "Subscribe Now",
  },
  learningJourneys: {
    title: "Built for Every Learning Journey",
    body: "From a 7-year-old just starting the national curriculum to a Secondary Year 3 student prepping for finals — the experience adapts to where each student actually is.",
    items: [
      { title: "Younger students", description: "Simple language, short explanations, encouraging tone." },
      { title: "Advanced students", description: "Deeper reasoning, harder questions, less hand-holding." },
      { title: "Parents", description: "A clear window into progress, without needing to sit next to every lesson." },
      { title: "When AI isn't enough", description: "A path to a real teacher session for topics that need one." },
    ],
  },
  finalCta: {
    title: "Ready to learn smarter?",
    body: "Create a free account and get a personalized learning plan in minutes.",
    ctaLabel: "Start Learning Free",
    signUpPrompt: "You must sign up first",
  },
  footer: {
    tagline: "Learn • Practice • Achieve",
    rights: "All rights reserved.",
    privacyPolicy: "Privacy Policy",
    termsOfService: "Terms of Service",
  },
};

const ar: MarketingCopy = {
  nav: {
    features: "المميزات",
    howItWorks: "كيف تعمل المنصة",
    curricula: "المناهج",
    pricing: "الأسعار",
    forParents: "لأولياء الأمور",
    login: "تسجيل الدخول",
    getStarted: "ابدأ الآن",
  },
  hero: {
    eyebrow: "تعلّم مدعوم بالذكاء الاصطناعي",
    headline: "تعلّم أذكى. بقوة الذكاء الاصطناعي.",
    subheadline:
      "سمارتيفاي AI يبني رحلة تعلّم شخصية لكل طالب — متوافقة تمامًا مع منهجه وصفه ومادته، مع معلم ذكاء اصطناعي يلتزم بالدرس ويشرح بوضوح.",
    ctaPrimary: "ابدأ التعلم مجانًا",
    ctaSecondary: "اكتشف سمارتيفاي AI",
  },
  trustedLearning: {
    title: "مصمم حول الطريقة الحقيقية التي يتعلم بها الطلاب",
    body:
      "كل شرح وسؤال وجلسة تدريب مبني على منهج الطالب الفعلي ومستواه الحالي — وليس إجابات عامة من روبوت محادثة عادي.",
  },
  curricula: {
    title: "اختر منهجك الدراسي",
    body: "سمارتيفاي AI يدعم الأنظمة التي تدرسها العائلات المصرية فعليًا — لكل نظام صفوفه ومواده وأسعاره الخاصة.",
    items: [
      { title: "منهج محلي / مخصص", description: "دعم مرن للمسارات الدراسية المحلية والمخصصة." },
      { title: "المنهج المصري الوطني", description: "متوافق مع النظام الوطني المصري الرسمي." },
      { title: "المنهج البريطاني الدولي", description: "للطلاب الذين يدرسون النظام البريطاني الدولي." },
      { title: "المنهج الأمريكي الدولي", description: "للطلاب الذين يدرسون النظام الأمريكي الدولي." },
    ],
  },
  howItWorks: {
    title: "كيف تعمل سمارتيفاي AI",
    steps: [
      { title: "أخبرنا بمستوى الطالب", description: "المنهج والصف والمواد — تُحدد مرة واحدة ويتم تحسينها عبر تقييم تشخيصي تكيفي." },
      { title: "احصل على خطة شخصية", description: "يحدد الذكاء الاصطناعي نقاط الضعف ويبني خطة تعلم حولها." },
      { title: "تعلّم، تدرّب، واحصل على شرح للإجابات", description: "تعليم خطوة بخطوة، وتدريب تكيفي، وشرح واضح للأخطاء — مرتبط دائمًا بالدرس والموضوع الحالي." },
      { title: "تابع تقدمًا حقيقيًا", description: "إتقان لكل موضوع، وسلاسل إنجاز، وتنبيهات لنقاط الضعف، تظهر للطالب وولي الأمر." },
    ],
  },
  aiPersonalization: {
    title: "ذكاء اصطناعي يلتزم بالموضوع",
    body: "المعلم الذكي مقيّد بمنهج الطالب وصفه ودرسه الحالي — يعلّم داخل نطاق الموضوع بدلًا من الخروج عنه.",
    points: [
      "مخصص حسب العمر والمستوى وسرعة التعلم",
      "شرح تفاعلي خطوة بخطوة — وليس مجرد إجابات",
      "يُعدّل صعوبة الأسئلة حسب أداء الطالب الفعلي",
      "يحوّل الطالب لجلسة مع معلم حقيقي عند الحاجة",
    ],
  },
  practiceAssessment: {
    title: "تدريب يتكيّف مع مستواك",
    body: "أنواع أسئلة متعددة، وصعوبة تتغير تلقائيًا، واختبارات تجريبية تحاكي ما سيواجهه الطالب فعليًا.",
  },
  progressTracking: {
    title: "تابع تقدمًا حقيقيًا، لا مجرد نشاط",
    body: "عرض يومي وأسبوعي وشهري لمستوى الإتقان في كل موضوع — لتوضيح ما يتحسن فعليًا، لا فقط الوقت المستغرق على المنصة.",
  },
  parentInsights: {
    title: "مصمم لأولياء الأمور أيضًا",
    body: "يحصل أولياء الأمور على رؤية لنقاط القوة والضعف ووقت الدراسة — دون كشف محادثات الطالب الخاصة مع الذكاء الاصطناعي إلا إذا اختارت العائلة مشاركتها.",
    ctaLabel: "المزيد لأولياء الأمور",
  },
  pricing: {
    title: "أسعار بسيطة حسب المادة",
    body: "يتم تحديد السعر حسب المنهج والمرحلة التعليمية، بالجنيه المصري، مع عدد محدد من المواد المشمولة وسعر واضح لكل مادة إضافية.",
    note: "كل مادة تشمل عددًا يوميًا من أسئلة الذكاء الاصطناعي. تحتاج المزيد؟ باقات أسئلة إضافية قابلة للتفعيل ستكون متاحة قريبًا.",
    ctaLabel: "اشترك الآن",
  },
  learningJourneys: {
    title: "مصمم لكل رحلة تعلم",
    body: "من طالب عمره 7 سنوات يبدأ المنهج الوطني، إلى طالب في الصف الثالث الثانوي يستعد للامتحانات النهائية — تتكيف التجربة مع مستوى كل طالب فعليًا.",
    items: [
      { title: "الطلاب الأصغر سنًا", description: "لغة بسيطة، شرح مختصر، وأسلوب مشجع." },
      { title: "الطلاب المتقدمون", description: "تفكير أعمق، أسئلة أصعب، ودعم أقل تفصيلًا." },
      { title: "أولياء الأمور", description: "رؤية واضحة للتقدم دون الحاجة للجلوس مع كل درس." },
      { title: "عندما لا يكفي الذكاء الاصطناعي", description: "مسار للانتقال إلى جلسة مع معلم حقيقي عند الحاجة." },
    ],
  },
  finalCta: {
    title: "جاهز للتعلم بذكاء أكبر؟",
    body: "أنشئ حسابًا مجانيًا واحصل على خطة تعلم شخصية خلال دقائق.",
    ctaLabel: "ابدأ التعلم مجانًا",
    signUpPrompt: "يجب عليك التسجيل أولاً",
  },
  footer: {
    tagline: "تعلّم • تدرّب • حقق إنجازك",
    rights: "جميع الحقوق محفوظة.",
    privacyPolicy: "سياسة الخصوصية",
    termsOfService: "شروط الخدمة",
  },
};

const copyByLocale: Record<Locale, MarketingCopy> = { en, ar };

/**
 * Loader function — the one place that decides where copy comes from.
 * Replacing the static objects above with a CMS/database fetch later
 * only requires changing this function's implementation.
 */
export function getMarketingCopy(locale: Locale): MarketingCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
