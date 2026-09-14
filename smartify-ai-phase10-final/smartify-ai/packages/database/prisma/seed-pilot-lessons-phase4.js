// Phase 4 pilot content: adds exactly TWO new small Grade 1 Mathematics
// topics (Subtraction, Comparing Numbers) alongside the existing validated
// Addition pilot, under the SAME Grade/Subject rows Phase 2 already
// created. Purely data/content work — no backend or frontend code is
// required for these to work, since the Interactive Lesson engine, the
// deterministic answer validators (add/subtract/equals/compare), and the
// AI prompts are all already fully generic across topics.
//
// Content origin: curriculum-map.json documents Unit 4 "الطرح" (Subtraction,
// page 44) and Unit 1 "الأعداد حتى ١٠" (Numbers up to 10, page 6) as real
// units in this curriculum, at title-only depth (their own lesson-level
// breakdown was never extracted). The lesson names, objectives, and
// teaching steps below are ORIGINAL Smartify planning content — no
// sentence, exercise, or illustration description is copied from the
// source book. "Comparing Numbers (Greater/Less)" is a Smartify-authored
// placement of a standard Grade-1 number-sense sub-topic under Unit 1
// (which covers "Numbers up to 10") — it is NOT a verified extraction of
// that unit's own lesson list, since that lesson-level detail was never
// extracted from the source. This is disclosed here rather than presented
// as a confirmed curriculum fact.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// NOTE (2026-09-13, post-incident reconstruction): this ID was regenerated
// by re-running prisma/seed.ts after the 2026-09-12 database reset (see
// docs/incident-2026-09-12-database-reset.md) — cuids are generated at
// insert time, not fixed, so the old hardcoded value here no longer refers
// to any existing row. No curriculum/unit/lesson content below changed.
const EG_NATIONAL_CURRICULUM_ID = "cmtyw8hn1000zuk62jeoyx33g";

async function ensureGradeAndSubject() {
  const grade = await prisma.grade.findFirst({ where: { curriculumId: EG_NATIONAL_CURRICULUM_ID, nameEn: "Grade 1" } });
  if (!grade) throw new Error("Grade 1 not found — Phase 2 seed must run first.");
  const subject = await prisma.subject.findFirst({ where: { gradeId: grade.id, nameEn: "Mathematics" } });
  if (!subject) throw new Error("Mathematics subject not found — Phase 2 seed must run first.");
  return { grade, subject };
}

async function ensureUnit(subjectId, { nameEn, nameAr, order }) {
  const existing = await prisma.unit.findFirst({ where: { subjectId, nameEn } });
  if (existing) return existing;
  return prisma.unit.create({ data: { subjectId, nameEn, nameAr, order, term: "TERM_1" } });
}

async function ensureTopicWithLesson(unitId, { nameEn, nameAr, order, teachingStepsJson, objectives }) {
  const existing = await prisma.topic.findFirst({ where: { unitId, nameEn } });
  if (existing) {
    console.log(`Topic "${nameEn}" already exists — skipping.`);
    return existing;
  }
  const topic = await prisma.topic.create({ data: { unitId, nameEn, nameAr, order, teachingStepsJson } });
  const lesson = await prisma.lesson.create({
    data: { topicId: topic.id, nameEn, nameAr, order: 1, isAiGenerated: false, isPlaceholder: false },
  });
  await prisma.learningObjective.createMany({
    data: objectives.map((o) => ({ lessonId: lesson.id, descriptionEn: o.en, descriptionAr: o.ar })),
  });
  return topic;
}

const SUBTRACTION_STEPS = [
  { id: "s1", type: "INTRO", order: 1, objective: "Give one brief, personal opening merged directly into starting the lesson — no filler question, no 'are you ready'.", conceptKey: "greeting_framing", required: true },
  { id: "s2", type: "EXPLAIN", order: 2, objective: "Explain what subtraction means (taking away some objects from a group to find how many are left) and introduce the '-' sign, using one simple worked example read aloud end-to-end.", conceptKey: "subtraction_meaning_sign", required: true },
  { id: "s3", type: "CHECK", order: 3, objective: "Verify the student understands what '-' means (taking away, finding what's left) before moving on to computing differences.", conceptKey: "subtraction_meaning_sign", required: true, checkType: "conceptual" },
  { id: "s4", type: "EXAMPLE", order: 4, objective: "Show one new original applied example of finding a difference within 10, demonstrating counting-back or crossing out objects.", conceptKey: "computing_differences_to_10", required: true },
  { id: "s5", type: "CHECK", order: 5, objective: "Verify the student can compute or recognize a simple subtraction (difference within 10) themselves.", conceptKey: "computing_differences_to_10", required: true, checkType: "applied" },
  { id: "s6", type: "REVIEW", order: 6, objective: "Give a very short recap of what subtraction means and what the '-' sign represents.", conceptKey: "subtraction_meaning_sign", required: true },
  { id: "s7", type: "COMPLETE", order: 7, objective: "Briefly acknowledge that the lesson is complete.", required: true },
];

const COMPARISON_STEPS = [
  { id: "s1", type: "INTRO", order: 1, objective: "Give one brief, personal opening merged directly into starting the lesson — no filler question, no 'are you ready'.", conceptKey: "greeting_framing", required: true },
  { id: "s2", type: "EXPLAIN", order: 2, objective: "Explain what it means for one number/group to be greater than, less than, or equal to another, using one simple worked example comparing two small groups read aloud end-to-end.", conceptKey: "comparison_meaning", required: true },
  { id: "s3", type: "CHECK", order: 3, objective: "Verify the student understands what 'greater than' and 'less than' mean (not yet comparing new numbers themselves) before moving on.", conceptKey: "comparison_meaning", required: true, checkType: "conceptual" },
  { id: "s4", type: "EXAMPLE", order: 4, objective: "Show one new original applied example comparing two small numbers/groups within 10 and stating which is greater and which is less.", conceptKey: "comparing_numbers_to_10", required: true },
  { id: "s5", type: "CHECK", order: 5, objective: "Verify the student can compare two given numbers within 10 themselves and correctly say which is greater or less.", conceptKey: "comparing_numbers_to_10", required: true, checkType: "applied" },
  { id: "s6", type: "REVIEW", order: 6, objective: "Give a very short recap of what greater than and less than mean.", conceptKey: "comparison_meaning", required: true },
  { id: "s7", type: "COMPLETE", order: 7, objective: "Briefly acknowledge that the lesson is complete.", required: true },
];

async function main() {
  const { subject } = await ensureGradeAndSubject();

  const subtractionUnit = await ensureUnit(subject.id, { nameEn: "Subtraction", nameAr: "الطرح", order: 4 });
  const subtractionTopic = await ensureTopicWithLesson(subtractionUnit.id, {
    nameEn: "Subtraction (Part 1)",
    nameAr: "الطرح (الجزء الأول)",
    order: 1,
    teachingStepsJson: SUBTRACTION_STEPS,
    objectives: [
      { en: "Explain what it means to take away objects from a group to find how many remain.", ar: "شرح معنى إزالة أشياء من مجموعة لمعرفة كم تبقى." },
      { en: "Read and write a simple subtraction sentence using '-' for differences within 10.", ar: "قراءة وكتابة جملة طرح بسيطة باستخدام '-' لناتج حتى 10." },
      { en: "Compute a simple subtraction within 10 given a small group of objects.", ar: "حساب عملية طرح بسيطة حتى 10 بالاعتماد على مجموعة صغيرة من الأشياء." },
    ],
  });

  const numbersUnit = await ensureUnit(subject.id, { nameEn: "Numbers up to 10", nameAr: "الأعداد حتى ١٠", order: 1 });
  const comparisonTopic = await ensureTopicWithLesson(numbersUnit.id, {
    nameEn: "Comparing Numbers (Greater/Less)",
    nameAr: "مقارنة الأعداد (أكبر / أصغر)",
    order: 1,
    teachingStepsJson: COMPARISON_STEPS,
    objectives: [
      { en: "Explain what it means for one number to be greater than or less than another.", ar: "شرح معنى أن يكون عدد أكبر أو أصغر من عدد آخر." },
      { en: "Compare two groups of objects and state which group has more and which has fewer.", ar: "مقارنة مجموعتين من الأشياء وتحديد أيهما أكثر وأيهما أقل." },
      { en: "Compare two numbers within 10 and correctly say which is greater or less.", ar: "مقارنة عددين حتى 10 وتحديد الأكبر والأصغر بشكل صحيح." },
    ],
  });

  console.log(JSON.stringify({
    subtractionUnitId: subtractionUnit.id, subtractionTopicId: subtractionTopic.id,
    numbersUnitId: numbersUnit.id, comparisonTopicId: comparisonTopic.id,
  }, null, 2));
}

main()
  .catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
