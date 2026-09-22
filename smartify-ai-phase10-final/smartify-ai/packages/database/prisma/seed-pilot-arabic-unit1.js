// One-off pilot seeding script: Egypt Primary, Grade 1, Arabic Language,
// Term 1, Unit 1 "أسرتي" (My Family). Creates the Subject + Unit only —
// no Topic/Lesson rows, those come from the LessonDraft generate -> review
// -> publish pipeline (see apps/backend/src/scripts/
// grade1-arabic-unit1-generate-drafts.ts).
//
// Content origin: curriculum-pilot/egypt-primary/grade1-arabic-term1/*.json.
// Every string below is an official curriculum label (grade/subject/unit
// title) taken from the book's own table of contents — no textbook prose.
//
// Grade 1 under EG_NATIONAL already exists and is isActive: true (it holds
// the live Mathematics pilot); this script only adds a sibling Subject to
// that same Grade.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const EG_NATIONAL_GRADE1_ID = "cmtyw9x6d00019youemjroiml";

async function main() {
  const existing = await prisma.subject.findFirst({ where: { gradeId: EG_NATIONAL_GRADE1_ID, nameEn: "Arabic Language" } });
  if (existing) {
    console.log("Arabic Language subject already exists under Grade 1. Nothing to do.");
    console.log(JSON.stringify({ subjectId: existing.id }, null, 2));
    return;
  }

  const subject = await prisma.subject.create({
    data: {
      gradeId: EG_NATIONAL_GRADE1_ID,
      nameEn: "Arabic Language",
      nameAr: "اللغة العربية",
      icon: "language",
      isActive: false, // pilot-only until Unit 1's lessons are reviewed and published
    },
  });

  const unit = await prisma.unit.create({
    data: {
      subjectId: subject.id,
      nameEn: "My Family",
      nameAr: "أسرتي",
      order: 1, // matches the book's own Unit 1 position
      term: "TERM_1",
    },
  });

  console.log(JSON.stringify({ subjectId: subject.id, unitId: unit.id }, null, 2));
}

main()
  .catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
