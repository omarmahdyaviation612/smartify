// Egypt Primary, Grade 1, Arabic Language, Term 1, Units 3 "أجزاء جسمي"
// and 4 "مدرستي". Creates the Unit rows only.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const ARABIC_SUBJECT_ID = "cmu78g0k300015tapkf9wor13";

async function upsertUnit(nameEn, nameAr, order) {
  const existing = await prisma.unit.findFirst({ where: { subjectId: ARABIC_SUBJECT_ID, nameEn } });
  if (existing) return existing;
  return prisma.unit.create({ data: { subjectId: ARABIC_SUBJECT_ID, nameEn, nameAr, order, term: "TERM_1" } });
}

async function main() {
  const unit3 = await upsertUnit("Parts of My Body", "أجزاء جسمي", 3);
  const unit4 = await upsertUnit("My School", "مدرستي", 4);
  console.log(JSON.stringify({ unit3Id: unit3.id, unit4Id: unit4.id }, null, 2));
}

main()
  .catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
