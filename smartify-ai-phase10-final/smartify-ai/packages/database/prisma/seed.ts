/**
 * Smartify AI — placeholder seed data.
 *
 * This is NOT production curriculum content. It exists only so the
 * onboarding → dashboard → practice → quiz flows are testable end to end.
 * Every lesson/question is tagged isPlaceholder: true and titled with a
 * [PLACEHOLDER] prefix so it can never be mistaken for reviewed content.
 *
 * Replacing this with real curricula later means writing rows into the
 * same Curriculum → Grade → Subject → Unit → Topic → Lesson/Question
 * tables — no schema change required.
 */
import { PrismaClient, QuestionType, Difficulty } from "@prisma/client";
import { seedAiBudgetConfig } from "./seed-ai-budget-config";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding placeholder curricula...");

  const curricula = [
    { code: "LOCAL", nameEn: "Local Custom Curriculum (Languages)", nameAr: "منهج محلي مخصص (لغات)", country: null },
    { code: "EG_NATIONAL", nameEn: "Egyptian National Curriculum (Arabic)", nameAr: "المنهج المصري الوطني (عربي)", country: "EG" },
    { code: "BRITISH_INTL", nameEn: "British International Curriculum", nameAr: "المنهج البريطاني الدولي", country: "GB" },
    { code: "AMERICAN_INTL", nameEn: "American International Curriculum", nameAr: "المنهج الأمريكي الدولي", country: "US" },
  ];

  for (const c of curricula) {
    const curriculum = await prisma.curriculum.upsert({
      where: { code: c.code },
      update: { nameEn: c.nameEn, nameAr: c.nameAr, country: c.country },
      create: c,
    });

    // One representative grade per curriculum
    const grade =
      (await prisma.grade.findFirst({ where: { curriculumId: curriculum.id, level: 7 } })) ??
      (await prisma.grade.create({
        data: {
        curriculumId: curriculum.id,
        nameEn: `[PLACEHOLDER] Grade 7`,
        nameAr: `[نموذج] الصف السابع`,
        level: 7,
        },
      }));

    // Two subjects: Math and Science, present in every system for comparability
    const subjectDefs = [
      { nameEn: "[PLACEHOLDER] Mathematics", nameAr: "[نموذج] الرياضيات", icon: "calculator" },
      { nameEn: "[PLACEHOLDER] Science", nameAr: "[نموذج] العلوم", icon: "flask" },
    ];

    for (const s of subjectDefs) {
      const subject =
        (await prisma.subject.findFirst({ where: { gradeId: grade.id, nameEn: s.nameEn } })) ??
        (await prisma.subject.create({ data: { gradeId: grade.id, ...s } }));

      const unit =
        (await prisma.unit.findFirst({ where: { subjectId: subject.id, order: 1 } })) ??
        (await prisma.unit.create({
          data: {
          subjectId: subject.id,
          nameEn: `[PLACEHOLDER] Unit 1`,
          nameAr: `[نموذج] الوحدة الأولى`,
          order: 1,
          },
        }));

      const topicDefs =
        s.nameEn.includes("Mathematics")
          ? [
              { nameEn: "[PLACEHOLDER] Fractions", nameAr: "[نموذج] الكسور" },
              { nameEn: "[PLACEHOLDER] Linear Equations", nameAr: "[نموذج] المعادلات الخطية" },
            ]
          : [
              { nameEn: "[PLACEHOLDER] States of Matter", nameAr: "[نموذج] حالات المادة" },
              { nameEn: "[PLACEHOLDER] Forces and Motion", nameAr: "[نموذج] القوى والحركة" },
            ];

      for (const [i, t] of topicDefs.entries()) {
        const topic =
          (await prisma.topic.findFirst({ where: { unitId: unit.id, order: i + 1 } })) ??
          (await prisma.topic.create({ data: { unitId: unit.id, ...t, order: i + 1 } }));

        const lesson = await prisma.lesson.findFirst({ where: { topicId: topic.id, order: 1 } });
        if (!lesson) await prisma.lesson.create({
          data: {
            topicId: topic.id,
            nameEn: `[PLACEHOLDER] Introduction to ${t.nameEn.replace("[PLACEHOLDER] ", "")}`,
            nameAr: `[نموذج] مقدمة في ${t.nameAr.replace("[نموذج] ", "")}`,
            order: 1,
            contentEn: "Placeholder lesson content — replace via curriculum import pipeline.",
            contentAr: "محتوى درس تجريبي — سيتم استبداله عبر نظام استيراد المناهج.",
            isPlaceholder: true,
          },
        });

        // A couple of practice questions per topic so the practice engine is testable
        const question = await prisma.question.findFirst({ where: { topicId: topic.id, promptEn: { startsWith: "[PLACEHOLDER] Sample question" } } });
        if (!question) await prisma.question.create({
          data: {
            topicId: topic.id,
            type: QuestionType.MULTIPLE_CHOICE,
            difficulty: Difficulty.EASY,
            promptEn: `[PLACEHOLDER] Sample question about ${t.nameEn.replace("[PLACEHOLDER] ", "")}`,
            promptAr: `[نموذج] سؤال تجريبي عن ${t.nameAr.replace("[نموذج] ", "")}`,
            optionsJson: ["Option A", "Option B", "Option C", "Option D"],
            correctAnswerJson: "Option A",
            explanationEn: "Placeholder explanation.",
            isPlaceholder: true,
          },
        });
      }
    }
  }

  // British test curriculum: grades 1-6 with core subjects and optional
  // second-language choices for grades 4-6.
  const britishCurriculum = await prisma.curriculum.findUniqueOrThrow({ where: { code: "BRITISH_INTL" } });
  // Arabic and Social Studies are deliberately NOT seeded for this curriculum
  // (2026-10-06): they are shared subjects whose content home is the Egyptian
  // National curriculum's own grade, offered here through GradeSubject — see
  // docs/superpowers/specs/2026-10-06-shared-subjects-design.md. Seeding them
  // again would recreate the empty placeholders Phase 2 withdrew.
  const britishCoreSubjects = [
    { nameEn: "English", nameAr: "اللغة الإنجليزية", icon: "language" },
    { nameEn: "Mathematics", nameAr: "الرياضيات", icon: "calculator" },
    { nameEn: "Science", nameAr: "العلوم", icon: "flask" },
  ];
  const britishAdditionalSubjects = [
    { nameEn: "French", nameAr: "اللغة الفرنسية", icon: "language" },
    { nameEn: "German", nameAr: "اللغة الألمانية", icon: "language" },
  ];

  for (let level = 1; level <= 6; level += 1) {
    const grade =
      (await prisma.grade.findFirst({ where: { curriculumId: britishCurriculum.id, level } })) ??
      (await prisma.grade.create({
        data: {
          curriculumId: britishCurriculum.id,
          nameEn: `[PLACEHOLDER] Grade ${level}`,
          nameAr: `[نموذج] الصف ${level}`,
          level,
        },
      }));

    const subjects = level <= 3 ? britishCoreSubjects : [...britishCoreSubjects, ...britishAdditionalSubjects];
    for (const subject of subjects) {
      const existing = await prisma.subject.findFirst({ where: { gradeId: grade.id, nameEn: subject.nameEn } });
      if (!existing) {
        await prisma.subject.create({ data: { gradeId: grade.id, ...subject } });
      }
    }
  }

  // NOTE: the generic FREE/BASIC/PLUS/PREMIUM USD SubscriptionPlan tiers
  // from the Phase 1 draft are intentionally NOT seeded here anymore.
  // Real billing is per Curriculum × Level × subject count via
  // PricingPlan below (EGP, approved numbers). SubscriptionPlan may still
  // be useful later purely as an AI-credit-allowance concept layered on
  // top of a PricingPlan subscription — that mapping is a Phase 8
  // (payments) decision, not something to guess numbers for now.

  // ===== Real pricing (EGP) — approved structure, not placeholder =====
  console.log("Seeding approved EGP pricing...");

  const pricingByCurriculum: Record<string, Array<{
    levelCodeEn: string;
    levelCodeAr: string;
    monthlyPriceEGP: number;
    additionalSubjectPriceEGP: number;
  }>> = {
    LOCAL: [
      { levelCodeEn: "Primary", levelCodeAr: "المرحلة الابتدائية", monthlyPriceEGP: 300, additionalSubjectPriceEGP: 130 },
      { levelCodeEn: "Preparatory", levelCodeAr: "المرحلة الإعدادية", monthlyPriceEGP: 400, additionalSubjectPriceEGP: 170 },
      { levelCodeEn: "Secondary Year 1-2", levelCodeAr: "الثانوية (الصف الأول والثاني)", monthlyPriceEGP: 700, additionalSubjectPriceEGP: 270 },
      { levelCodeEn: "Secondary Year 3", levelCodeAr: "الثانوية (الصف الثالث)", monthlyPriceEGP: 1300, additionalSubjectPriceEGP: 490 },
    ],
    EG_NATIONAL: [
      { levelCodeEn: "Primary", levelCodeAr: "المرحلة الابتدائية", monthlyPriceEGP: 200, additionalSubjectPriceEGP: 100 },
      { levelCodeEn: "Preparatory", levelCodeAr: "المرحلة الإعدادية", monthlyPriceEGP: 300, additionalSubjectPriceEGP: 120 },
      { levelCodeEn: "Secondary Year 1-2", levelCodeAr: "الثانوية (الصف الأول والثاني)", monthlyPriceEGP: 400, additionalSubjectPriceEGP: 170 },
      { levelCodeEn: "Secondary Year 3", levelCodeAr: "الثانوية (الصف الثالث)", monthlyPriceEGP: 900, additionalSubjectPriceEGP: 270 },
    ],
    // British and American are kept as separate Curriculum rows (separate
    // pricing rows below) even though the numbers are currently identical —
    // this is a business decision, not a data-modeling shortcut.
    BRITISH_INTL: [
      { levelCodeEn: "Grade 1-5", levelCodeAr: "الصف 1-5", monthlyPriceEGP: 500, additionalSubjectPriceEGP: 200 },
      { levelCodeEn: "Grade 6-8", levelCodeAr: "الصف 6-8", monthlyPriceEGP: 900, additionalSubjectPriceEGP: 350 },
      { levelCodeEn: "Grade 9", levelCodeAr: "الصف 9", monthlyPriceEGP: 1200, additionalSubjectPriceEGP: 450 },
      { levelCodeEn: "Grade 10-12", levelCodeAr: "الصف 10-12", monthlyPriceEGP: 1500, additionalSubjectPriceEGP: 550 },
    ],
    AMERICAN_INTL: [
      { levelCodeEn: "Grade 1-5", levelCodeAr: "الصف 1-5", monthlyPriceEGP: 500, additionalSubjectPriceEGP: 200 },
      { levelCodeEn: "Grade 6-8", levelCodeAr: "الصف 6-8", monthlyPriceEGP: 900, additionalSubjectPriceEGP: 350 },
      { levelCodeEn: "Grade 9", levelCodeAr: "الصف 9", monthlyPriceEGP: 1200, additionalSubjectPriceEGP: 450 },
      { levelCodeEn: "Grade 10-12", levelCodeAr: "الصف 10-12", monthlyPriceEGP: 1500, additionalSubjectPriceEGP: 550 },
    ],
  };

  for (const [code, tiers] of Object.entries(pricingByCurriculum)) {
    const curriculum = await prisma.curriculum.findUniqueOrThrow({ where: { code } });
    for (const tier of tiers) {
      await prisma.pricingPlan.upsert({
        where: { curriculumId_levelCodeEn: { curriculumId: curriculum.id, levelCodeEn: tier.levelCodeEn } },
        update: {
          monthlyPriceEGP: tier.monthlyPriceEGP,
          additionalSubjectPriceEGP: tier.additionalSubjectPriceEGP,
        },
        create: {
          curriculumId: curriculum.id,
          levelCodeEn: tier.levelCodeEn,
          levelCodeAr: tier.levelCodeAr,
          monthlyPriceEGP: tier.monthlyPriceEGP,
          includedSubjects: 3,
          additionalSubjectPriceEGP: tier.additionalSubjectPriceEGP,
        },
      });
    }
  }

  // Question package pricing is genuinely TBD — seeded inactive with no
  // price so the admin panel has something to configure, not a guessed number.
  await prisma.questionPackage.upsert({
    where: { id: "placeholder-question-package" },
    update: {},
    create: {
      id: "placeholder-question-package",
      nameEn: "Extra Questions Package (price TBD)",
      nameAr: "باقة أسئلة إضافية (السعر غير محدد بعد)",
      questionCount: 50,
      priceEGP: null,
      isActive: false,
    },
  });

  // Tunable business rule, not hardcoded in application code.
  await prisma.systemConfig.upsert({
    where: { key: "default_daily_ai_questions_per_subject" },
    update: {},
    create: {
      key: "default_daily_ai_questions_per_subject",
      value: 10,
      description: "Included AI questions per subject per student per day, before Question Packages/AI Credits apply.",
    },
  });

  // Phase 9.4A found these two budget keys had never been created, so the
  // USD-denominated circuit breaker in AIUsageService.assertWithinBudget
  // was fully dormant. Phase 9.4B sets the owner-approved initial
  // soft-launch caps — editable afterward from Admin > Platform Config >
  // AI Spending Controls, never by editing this seed again. Extracted to
  // seed-ai-budget-config.ts (Phase 9.4B re-verification) so it's
  // unit-testable in isolation — same two upserts, same values, same
  // create-only-if-missing semantics as before.
  await seedAiBudgetConfig(prisma);

  // Phase 9.4B — owner-selected MVP voice (marin, on gpt-4o-mini-tts) from
  // the Stage A bake-off. See tts-config.util.ts for the canonical
  // DEFAULT_TTS_CONFIG/SMARTIFY_TTS_INSTRUCTIONS this mirrors; duplicated
  // here as a literal only because normalizeTtsConfig() already falls back
  // to those exact defaults on its own if this row is ever missing — this
  // upsert just makes the row's presence and description visible/editable
  // from the Admin Panel from day one, matching the AIProviderConfig seed
  // pattern just above.
  await prisma.systemConfig.upsert({
    where: { key: "tts_config" },
    update: {},
    create: {
      key: "tts_config",
      value: {
        provider: "openai",
        model: "gpt-4o-mini-tts",
        voice: "marin",
        speed: 0.94,
        instructions:
          "Speak in warm, natural Egyptian Arabic (Masri), not Modern Standard Arabic, unless the text itself is formal. " +
          "Personality: a kind, encouraging elementary-school teacher talking directly to a young child — human and " +
          "conversational, never an announcer or narrator. Warm and genuinely encouraging without sounding childish, " +
          "cartoonish, or exaggerated/theatrical. Pronounce Arabic words and numbers clearly and precisely. When " +
          "explaining a math step or reading an equation, slow down slightly and add a short natural pause right around " +
          "the numbers and the equals sign, as a real teacher would when making sure a child follows along. When the " +
          "text expresses praise for a correct answer, sound genuinely pleased and warm, not over-the-top. When the text " +
          "is calming/supportive after a mistake, sound patient and reassuring, never disappointed or flat. Avoid a " +
          "robotic, flat, or metronomic cadence — vary pacing and warmth like a real person speaking to a child they " +
          "care about. Do not change, add, or omit any words, numbers, or mathematical content from the given text — " +
          "speak exactly what is written.",
      },
      description: "Active TTS provider/model/voice/speaking-style config — see admin-ai-config.service.ts.",
    },
  });

  // AI provider config — approximate published OpenAI pricing for a
  // small/cheap model, meant to be corrected from the Admin Panel once
  // real usage data exists. Marked isActive so the AIProviderFactory has
  // something to resolve; actual calls still require OPENAI_API_KEY to
  // be set in the backend environment, or the tutor endpoint responds
  // with a clear "not configured yet" error instead of crashing.
  await prisma.aIProviderConfig.upsert({
    where: { providerKey: "openai" },
    update: {},
    create: {
      providerKey: "openai",
      model: "gpt-4o-mini",
      isActive: true,
      costPerInputToken: 0.00000015,
      costPerOutputToken: 0.0000006,
    },
  });

  // Payment provider config — seeded INACTIVE for all providers. Status
  // is recorded honestly in publicConfig for the admin panel to display:
  //  - stripe: development/test provider only (never intended for
  //    production) — becomes usable once real Stripe TEST credentials
  //    are set in STRIPE_SECRET_KEY, but is not a production payment path.
  //  - fawry: the intended PRODUCTION provider, not yet integrated —
  //    pending official Fawry integration docs, callback/webhook rules,
  //    auth details, and test credentials.
  //  - instapay: planned future provider, deliberately hidden from the
  //    admin panel's provider list until its integration requirements exist.
  //  - paymob: earlier-phase option, not the current production target.
  //  - paypal: reserved stub (PayPalProvider throws "not implemented yet"
  //    for every method) — see 08-phase8-decisions.md. Recognized by
  //    PaymentProviderFactory.getProviderByKey alongside the other four,
  //    so it needs a config row like the rest.
  // See 10-phase10-decisions.md for the full classification.
  const paymentProviders: Array<{ providerKey: string; publicConfig: Record<string, unknown> }> = [
    { providerKey: "stripe", publicConfig: { role: "development_test_only", productionApproved: false } },
    { providerKey: "fawry", publicConfig: { role: "planned_production_provider", productionApproved: false } },
    { providerKey: "instapay", publicConfig: { role: "planned_future_provider", hidden: true, productionApproved: false } },
    { providerKey: "paymob", publicConfig: { role: "not_current_target", productionApproved: false } },
    { providerKey: "paypal", publicConfig: { role: "not_current_target", productionApproved: false } },
  ];
  for (const p of paymentProviders) {
    await prisma.paymentProviderConfig.upsert({
      where: { providerKey: p.providerKey },
      update: {},
      create: { providerKey: p.providerKey, isActive: false, publicConfig: p.publicConfig as any },
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
