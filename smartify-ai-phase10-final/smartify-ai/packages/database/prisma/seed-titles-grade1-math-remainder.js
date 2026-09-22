// Egypt Primary, Grade 1, Mathematics, Term 1 — title-only seeding for the
// six units never touched by the original pilot (which only covered
// Addition/Subtraction/Numbers-up-to-10). Titles + page numbers come
// straight from curriculum-pilot/egypt-primary/grade1-math-term1/curriculum-map.json's
// own table-of-contents-derived unit list (order 2,5,6,7,8,9) — no lesson-
// level breakdown was ever recorded for these units (recorded
// "detailExtracted: false"), so each gets exactly one title-only Topic
// (teachingStepsJson: null) matching its own unit title — the lazy-
// generation path fills real content in the first time a student opens it.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const MATH_SUBJECT_ID_QUERY = { gradeId: "cmtyw9x6d00019youemjroiml", nameEn: "Mathematics" }; // Grade 1 EG_NATIONAL

const UNITS = [
  { order: 2, nameEn: "What is Position?", nameAr: "ما هو الموقع؟" },
  { order: 5, nameEn: "Comparing Lengths", nameAr: "مقارنة الأطوال" },
  { order: 6, nameEn: "Representing Data", nameAr: "تمثيل البيانات" },
  { order: 7, nameEn: "Numbers greater than 10", nameAr: "الأعداد الأكبر من ١٠" },
  { order: 8, nameEn: "Reading the Clock", nameAr: "قراءة الساعة" },
  { order: 9, nameEn: "Operations involving 3 numbers", nameAr: "العمليات التي تتضمن ٣ أعداد" },
];

async function main() {
  const subject = await prisma.subject.findFirst({ where: MATH_SUBJECT_ID_QUERY });
  if (!subject) throw new Error("Grade 1 Mathematics subject not found.");

  const created = [];
  for (const u of UNITS) {
    let unit = await prisma.unit.findFirst({ where: { subjectId: subject.id, nameEn: u.nameEn } });
    if (!unit) {
      unit = await prisma.unit.create({ data: { subjectId: subject.id, nameEn: u.nameEn, nameAr: u.nameAr, order: u.order, term: "TERM_1" } });
    }
    let topic = await prisma.topic.findFirst({ where: { unitId: unit.id } });
    if (!topic) {
      topic = await prisma.topic.create({ data: { unitId: unit.id, nameEn: u.nameEn, nameAr: u.nameAr, order: 1 } }); // teachingStepsJson stays null — title-only
    }
    created.push({ unitId: unit.id, topicId: topic.id, nameEn: u.nameEn });
  }
  console.log(JSON.stringify(created, null, 2));
}

main()
  .catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
