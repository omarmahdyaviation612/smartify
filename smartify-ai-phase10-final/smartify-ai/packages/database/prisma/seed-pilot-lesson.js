// One-off pilot seeding script for the Interactive Lesson pilot
// (Egypt Primary, Grade 1, Mathematics, Term 1, Unit 3 "Addition", lesson
// 3-1 "Addition (Part 1)"). Run manually, NOT part of any automated
// migration or the general prisma seed — this intentionally persists only
// the single reviewed pilot lesson, never the other 8 units or any other
// grade/subject.
//
// Content origin: curriculum-pilot/egypt-primary/grade1-math-term1/*.json
// (Phase 1 artifacts). Every string below is either an official curriculum
// label (curriculum/grade/subject/unit/lesson title) or ORIGINAL Smartify
// planning text — no textbook prose, exercises, or illustrations are
// reproduced anywhere in this script.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// NOTE (2026-09-13, post-incident reconstruction): this ID was regenerated
// by re-running prisma/seed.ts after the 2026-09-12 database reset (see
// docs/incident-2026-09-12-database-reset.md) — cuids are generated at
// insert time, not fixed, so the old hardcoded value here no longer refers
// to any existing row. No curriculum/unit/lesson content below changed.
const EG_NATIONAL_CURRICULUM_ID = "cmtyw8hn1000zuk62jeoyx33g";

async function main() {
  const existingGrade = await prisma.grade.findFirst({ where: { curriculumId: EG_NATIONAL_CURRICULUM_ID, nameEn: "Grade 1" } });
  if (existingGrade) {
    console.log("Pilot data already seeded (Grade 1 exists under EG_NATIONAL). Nothing to do.");
    console.log(JSON.stringify({ gradeId: existingGrade.id }, null, 2));
    return;
  }

  const grade = await prisma.grade.create({
    data: {
      curriculumId: EG_NATIONAL_CURRICULUM_ID,
      nameEn: "Grade 1",
      nameAr: "الصف الأول الابتدائي",
      level: 1,
      isActive: false, // pilot-only: not yet shown in the public onboarding grade picker
    },
  });

  const subject = await prisma.subject.create({
    data: {
      gradeId: grade.id,
      nameEn: "Mathematics",
      nameAr: "الرياضيات",
      icon: "calculator",
      isActive: false, // pilot-only, same reasoning as the grade above
    },
  });

  const unit = await prisma.unit.create({
    data: {
      subjectId: subject.id,
      nameEn: "Addition",
      nameAr: "الجمع",
      order: 3, // matches the book's own Unit 3 position
      term: "TERM_1",
    },
  });

  const teachingStepsJson = [
    {
      id: "s1", type: "INTRO", order: 1,
      objective: "Give one brief, personal opening merged directly into starting the lesson — no filler question, no 'are you ready'.",
      conceptKey: "greeting_framing", required: true,
    },
    {
      id: "s2", type: "EXPLAIN", order: 2,
      objective: "Explain what addition means (combining two groups into one) and introduce the + and = signs, using one simple worked example read aloud end-to-end.",
      conceptKey: "addition_meaning_symbols", required: true,
    },
    {
      id: "s3", type: "CHECK", order: 3,
      objective: "Verify the student understands what + and = mean (not yet computing sums) before moving on.",
      conceptKey: "addition_meaning_symbols", required: true, checkType: "conceptual",
    },
    {
      id: "s4", type: "EXAMPLE", order: 4,
      objective: "Show one new original applied example of finding a sum within 10, demonstrating counting-on/counting-all.",
      conceptKey: "computing_sums_to_10", required: true,
      visual: {
        type: "VISUALIZE_LEARNING",
        status: "NOT_GENERATED",
        prompt: "A simple, warm, child-friendly flat illustration for a Grade 1 Egyptian Arabic math lesson: two small groups of the same friendly object (for example a few apples) shown separately on the left, an arrow or plus sign showing them combining, and the combined single group shown on the right with a small equals arrow. Bright, simple, minimal text, no textbook branding, no logos, no copyrighted characters.",
        url: null,
      },
    },
    {
      id: "s5", type: "CHECK", order: 5,
      objective: "Verify the student can compute or recognize a simple addition up to 10 themselves.",
      conceptKey: "computing_sums_to_10", required: true, checkType: "applied",
    },
    {
      id: "s6", type: "REVIEW", order: 6,
      objective: "Give a very short recap of what addition means and what + and = represent.",
      conceptKey: "addition_meaning_symbols", required: true,
    },
    {
      id: "s7", type: "COMPLETE", order: 7,
      objective: "Briefly acknowledge that the lesson is complete.",
      required: true,
    },
  ];

  const topic = await prisma.topic.create({
    data: {
      unitId: unit.id,
      nameEn: "Addition (Part 1)",
      nameAr: "الجمع (الجزء الأول)",
      order: 1,
      teachingStepsJson,
    },
  });

  // Thin compatibility shim: StudentProgress/LearningObjective both key off
  // Lesson, which nothing else in the app currently reads or writes (grep
  // confirmed zero usages outside the Prisma schema). Rather than silently
  // leaving those models meaningless for the pilot, one Lesson row mirrors
  // this Topic 1:1 purely so they have a valid target.
  const lesson = await prisma.lesson.create({
    data: {
      topicId: topic.id,
      nameEn: "Addition (Part 1)",
      nameAr: "الجمع (الجزء الأول)",
      order: 1,
      isAiGenerated: false,
      isPlaceholder: false,
    },
  });

  await prisma.learningObjective.createMany({
    data: [
      { lessonId: lesson.id, descriptionEn: "Explain what it means to add two groups of objects together.", descriptionAr: "شرح معنى جمع مجموعتين من الأشياء معًا." },
      { lessonId: lesson.id, descriptionEn: "Read and write a simple addition sentence using + and = for sums up to 10.", descriptionAr: "قراءة وكتابة جملة جمع بسيطة باستخدام + و = لناتج حتى 10." },
      { lessonId: lesson.id, descriptionEn: "Match a picture of two groups of objects to the addition sentence it represents.", descriptionAr: "مطابقة صورة مجموعتين من الأشياء بجملة الجمع التي تمثلها." },
    ],
  });

  console.log(JSON.stringify({ gradeId: grade.id, subjectId: subject.id, unitId: unit.id, topicId: topic.id, lessonId: lesson.id }, null, 2));
}

main()
  .catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
