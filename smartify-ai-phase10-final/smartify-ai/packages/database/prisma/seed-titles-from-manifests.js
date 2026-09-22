// Consumes every JSON manifest under curriculum-pilot/toc-manifests/*.json
// (produced by parallel research agents transcribing each textbook's own
// table of contents — titles + page numbers only, no textbook prose) and
// seeds title-only Grade/Subject/Unit/Topic rows (teachingStepsJson stays
// null on every Topic). Idempotent — safe to re-run; matches by nameEn at
// each level rather than assuming empty tables. New Grade/Subject rows use
// the schema default isActive: true (this is real, launch-ready structure,
// not the old inactive placeholder seed) so they appear in the public
// catalog immediately; real lesson content is filled in lazily per-topic
// by InteractiveLessonService.ensureTopicHasSteps() the first time a
// student opens each one.
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const MANIFEST_DIR = path.join(__dirname, "..", "..", "..", "curriculum-pilot", "toc-manifests");

async function upsertGrade(curriculumId, nameEn, nameAr, level) {
  let grade = await prisma.grade.findFirst({ where: { curriculumId, nameEn } });
  if (!grade) grade = await prisma.grade.create({ data: { curriculumId, nameEn, nameAr, level } });
  return grade;
}

// 2026-09-19: sourceFile is backfilled onto ALREADY-seeded Subject rows too
// (not just newly-created ones) — the grounding-extraction pipeline needs
// it, and most subjects were already seeded before sourceFile existed on
// the schema. Only writes when a real value is given and it actually
// differs, so re-running this script is still a safe no-op otherwise.
async function upsertSubject(gradeId, nameEn, nameAr, icon, sourceFile) {
  let subject = await prisma.subject.findFirst({ where: { gradeId, nameEn } });
  if (!subject) {
    subject = await prisma.subject.create({ data: { gradeId, nameEn, nameAr, icon, sourceFile: sourceFile ?? null } });
  } else if (sourceFile && subject.sourceFile !== sourceFile) {
    subject = await prisma.subject.update({ where: { id: subject.id }, data: { sourceFile } });
  }
  return subject;
}

// Same backfill-onto-existing-rows rationale as upsertSubject above, for
// the page-range fields the grounding-extraction pipeline reads.
async function upsertUnit(subjectId, nameEn, nameAr, order, sourcePageStart, sourcePageEnd) {
  // Textbooks can repeat a unit title at different positions (and page ranges).
  let unit = await prisma.unit.findFirst({ where: { subjectId, nameEn, order } });
  if (!unit) {
    unit = await prisma.unit.create({
      data: { subjectId, nameEn, nameAr, order, term: "TERM_1", sourcePageStart: sourcePageStart ?? null, sourcePageEnd: sourcePageEnd ?? null },
    });
  } else {
    const changes = {};
    if (sourcePageStart != null && unit.sourcePageStart !== sourcePageStart) changes.sourcePageStart = sourcePageStart;
    if (sourcePageEnd != null && unit.sourcePageEnd !== sourcePageEnd) changes.sourcePageEnd = sourcePageEnd;
    if (Object.keys(changes).length > 0) unit = await prisma.unit.update({ where: { id: unit.id }, data: changes });
  }
  return unit;
}

async function upsertTopic(unitId, nameEn, nameAr, order) {
  let topic = await prisma.topic.findFirst({ where: { unitId, nameEn } });
  if (!topic) topic = await prisma.topic.create({ data: { unitId, nameEn, nameAr, order } }); // teachingStepsJson stays null
  return topic;
}

async function main() {
  for (const curriculum of [
    {
      code: "EG_NATIONAL",
      nameEn: "Egyptian National Curriculum",
      nameAr: "المنهج المصري الوطني",
      country: "EG",
    },
    {
      code: "BRITISH_INTL",
      nameEn: "British International Curriculum",
      nameAr: "المنهج البريطاني الدولي",
      country: "GB",
    },
  ]) {
    const { code, ...data } = curriculum;
    await prisma.curriculum.upsert({
      where: { code },
      update: data,
      create: curriculum,
    });
  }

  const files = fs.readdirSync(MANIFEST_DIR).filter((f) => f.endsWith(".json"));
  const summary = [];

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, file), "utf8"));
    for (const entry of raw.entries) {
      const curriculum = await prisma.curriculum.findUniqueOrThrow({ where: { code: entry.curriculumCode } });
      const grade = await upsertGrade(curriculum.id, entry.gradeNameEn, entry.gradeNameAr, entry.gradeLevel);
      const subject = await upsertSubject(grade.id, entry.subjectNameEn, entry.subjectNameAr, entry.icon ?? null, entry.sourceFile ?? null);

      let unitCount = 0;
      let topicCount = 0;
      // sourcePageEnd for unit i = unit i+1's sourcePage - 1; the LAST unit
      // uses entry.totalPages (if the manifest provides it) — otherwise it
      // stays null and grounding extraction for that one unit requires an
      // explicit --pages override rather than guessing an end page.
      const sortedUnits = [...entry.units].sort((a, b) => a.order - b.order);
      for (let i = 0; i < sortedUnits.length; i++) {
        const u = sortedUnits[i];
        const next = sortedUnits[i + 1];
        const sourcePageStart = u.sourcePage ?? null;
        const sourcePageEnd = sourcePageStart == null ? null : next?.sourcePage != null ? next.sourcePage - 1 : entry.totalPages ?? null;
        const unit = await upsertUnit(subject.id, u.nameEn, u.nameAr, u.order, sourcePageStart, sourcePageEnd);
        unitCount++;
        for (const t of u.topics) {
          await upsertTopic(unit.id, t.nameEn, t.nameAr, t.order);
          topicCount++;
        }
      }
      summary.push({ file, grade: entry.gradeNameEn, subject: entry.subjectNameEn, unitCount, topicCount });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
