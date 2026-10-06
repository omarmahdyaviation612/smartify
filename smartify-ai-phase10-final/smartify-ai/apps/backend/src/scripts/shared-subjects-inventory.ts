// READ-ONLY. Default: inventory only. No writes, no migrations, no R2, no AI.
//
// Phase 0 of docs/superpowers/specs/2026-10-06-shared-subjects-design.md:
// before any shared offering can be created, we need to know how many
// Arabic / Social Studies Subjects already exist per curriculum and whether
// the non-Egyptian ones carry content. An empty duplicate can be withdrawn
// mechanically; a non-empty one needs a human decision, so this report is
// the decision surface, not an implementation detail.
import { PrismaClient } from "@smartify/database";

// Names measured against the real database (2026-10-06): the populated
// Egyptian subjects are named "Arabic Language" and "Social Studies", while
// the seeded non-Egyptian placeholders are named "Arabic". Both variants must
// be reported, or the inventory silently misses every real Egyptian row and
// reports an empty curriculum that in fact holds all the content.
export const SHARED_SUBJECT_NAMES = ["Arabic Language", "Arabic", "Social Studies"] as const;

/** `Subscription.selectedSubjectIds` is a Json column and `LessonTrial.subjectIds` is a JSON string — both are read defensively. */
export function parseIdList(raw: unknown): string[] {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export type InventorySubject = {
  subjectId: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
  curriculumCode: string;
  curriculumNameEn: string;
  gradeId: string;
  gradeNameEn: string;
  gradeLevel: number;
  priceEGP: number | null;
  sourceFile: string | null;
  unitCount: number;
  groundedUnitCount: number;
  topicCount: number;
  generatedTopicCount: number;
  lessonCount: number;
  studentSubjectCount: number;
  trialRefCount: number;
  subscriptionRefCount: number;
};

export type InventoryReport = {
  generatedAt: string;
  subjectNames: string[];
  byName: Record<string, InventorySubject[]>;
  totals: {
    subjectCount: number;
    subjectsWithContent: number;
    unitCount: number;
    topicCount: number;
    lessonCount: number;
  };
};

export async function collectInventory(db: PrismaClient): Promise<InventoryReport> {
  const subjects = await db.subject.findMany({
    where: { nameEn: { in: [...SHARED_SUBJECT_NAMES] } },
    select: {
      id: true,
      nameEn: true,
      nameAr: true,
      isActive: true,
      sourceFile: true,
      priceEGP: true,
      grade: { select: { id: true, nameEn: true, level: true, curriculum: { select: { code: true, nameEn: true } } } },
      _count: { select: { studentSubjects: true } },
    },
    orderBy: [{ nameEn: "asc" }, { grade: { curriculum: { code: "asc" } } }, { grade: { level: "asc" } }],
  });

  const subjectIds = subjects.map((s) => s.id);
  const units = subjectIds.length
    ? await db.unit.findMany({ where: { subjectId: { in: subjectIds } }, select: { id: true, subjectId: true, groundingNotesJson: true } })
    : [];
  const unitIds = units.map((u) => u.id);
  const topics = unitIds.length
    ? await db.topic.findMany({ where: { unitId: { in: unitIds } }, select: { id: true, unitId: true, teachingStepsJson: true } })
    : [];
  const topicIds = topics.map((t) => t.id);
  const lessons = topicIds.length
    ? await db.lesson.findMany({ where: { topicId: { in: topicIds } }, select: { id: true, topicId: true } })
    : [];
  const trials = await db.lessonTrial.findMany({ select: { id: true, subjectIds: true } });
  const subscriptions = await db.subscription.findMany({ select: { id: true, selectedSubjectIds: true } });

  const unitToSubject = new Map(units.map((u) => [u.id, u.subjectId]));
  // Keyed by TOPIC id (not unit id): the topic loop looks up a topic's own id,
  // and the lesson loop looks up lesson.topicId — both are topic ids.
  const topicToSubject = new Map(topics.map((t) => [t.id, unitToSubject.get(t.unitId)!]));

  const perSubject = new Map<string, InventorySubject>();
  const byName: Record<string, InventorySubject[]> = {};
  for (const name of SHARED_SUBJECT_NAMES) byName[name] = [];

  for (const subject of subjects) {
    const row: InventorySubject = {
      subjectId: subject.id,
      nameEn: subject.nameEn,
      nameAr: subject.nameAr,
      isActive: subject.isActive,
      curriculumCode: subject.grade.curriculum.code,
      curriculumNameEn: subject.grade.curriculum.nameEn,
      gradeId: subject.grade.id,
      gradeNameEn: subject.grade.nameEn,
      gradeLevel: subject.grade.level,
      priceEGP: subject.priceEGP == null ? null : Number(subject.priceEGP),
      sourceFile: subject.sourceFile,
      unitCount: 0,
      groundedUnitCount: 0,
      topicCount: 0,
      generatedTopicCount: 0,
      lessonCount: 0,
      studentSubjectCount: subject._count.studentSubjects,
      trialRefCount: 0,
      subscriptionRefCount: 0,
    };
    perSubject.set(subject.id, row);
    (byName[subject.nameEn] ??= []).push(row);
  }

  for (const unit of units) {
    const row = perSubject.get(unit.subjectId);
    if (!row) continue;
    row.unitCount += 1;
    if (unit.groundingNotesJson != null) row.groundedUnitCount += 1;
  }
  for (const topic of topics) {
    const row = perSubject.get(topicToSubject.get(topic.id) ?? "");
    if (!row) continue;
    row.topicCount += 1;
    if (topic.teachingStepsJson != null) row.generatedTopicCount += 1;
  }
  for (const lesson of lessons) {
    const row = perSubject.get(topicToSubject.get(lesson.topicId) ?? "");
    if (row) row.lessonCount += 1;
  }
  for (const trial of trials) {
    for (const id of parseIdList(trial.subjectIds)) {
      const row = perSubject.get(id);
      if (row) row.trialRefCount += 1;
    }
  }
  for (const subscription of subscriptions) {
    for (const id of parseIdList(subscription.selectedSubjectIds)) {
      const row = perSubject.get(id);
      if (row) row.subscriptionRefCount += 1;
    }
  }

  const rows = [...perSubject.values()];
  return {
    generatedAt: new Date().toISOString(),
    subjectNames: [...SHARED_SUBJECT_NAMES],
    byName,
    totals: {
      subjectCount: rows.length,
      subjectsWithContent: rows.filter((r) => r.unitCount > 0 || r.topicCount > 0 || r.lessonCount > 0).length,
      unitCount: rows.reduce((n, r) => n + r.unitCount, 0),
      topicCount: rows.reduce((n, r) => n + r.topicCount, 0),
      lessonCount: rows.reduce((n, r) => n + r.lessonCount, 0),
    },
  };
}

async function main() {
  const db = new PrismaClient();
  try {
    const report = await collectInventory(db);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
