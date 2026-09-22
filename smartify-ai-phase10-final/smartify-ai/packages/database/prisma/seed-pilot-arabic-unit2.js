// One-off pilot seeding script: Egypt Primary, Grade 1, Arabic Language,
// Term 1, Unit 2 "حيواناتي" (My Animals). Creates the Unit only — Topic/
// Lesson rows come from the LessonDraft generate -> review -> publish
// pipeline. Content origin: curriculum-pilot/egypt-primary/grade1-arabic-term1/curriculum-map.json.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const ARABIC_SUBJECT_ID = "cmu78g0k300015tapkf9wor13";

async function main() {
  const existing = await prisma.unit.findFirst({ where: { subjectId: ARABIC_SUBJECT_ID, nameEn: "My Animals" } });
  if (existing) {
    console.log("Unit 2 already exists. Nothing to do.");
    console.log(JSON.stringify({ unitId: existing.id }, null, 2));
    return;
  }

  const unit = await prisma.unit.create({
    data: {
      subjectId: ARABIC_SUBJECT_ID,
      nameEn: "My Animals",
      nameAr: "حيواناتي",
      order: 2,
      term: "TERM_1",
    },
  });

  console.log(JSON.stringify({ unitId: unit.id }, null, 2));
}

main()
  .catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
