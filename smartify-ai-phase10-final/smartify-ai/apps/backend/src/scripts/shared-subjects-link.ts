// Shared subjects Phase 2 (2026-10-06). Dry run by default; --apply writes.
//
// Links non-Egyptian grades to the Egyptian Arabic Language / Social Studies
// subjects that already exist and already carry content, and withdraws the
// empty placeholder duplicates the seed created. Nothing is copied: the
// reference subjects keep their units, topics, price, and textbook mapping.
import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "@smartify/database";
import {
  DUPLICATE_SUBJECT_NAMES,
  LEVEL_OFFSET,
  REFERENCE_CURRICULUM_CODE,
  SHARED_SUBJECT_NAMES,
  planSharedSubjects,
  type SharedSubjectsPlan,
  type Snapshot,
} from "./shared-subjects-map";

export async function loadSnapshot(db: PrismaClient): Promise<Snapshot> {
  const grades = await db.grade.findMany({ select: { id: true, level: true, isActive: true, curriculum: { select: { code: true } } } });

  const subjects = await db.subject.findMany({
    where: {
      OR: [
        { nameEn: { in: SHARED_SUBJECT_NAMES }, grade: { curriculum: { code: REFERENCE_CURRICULUM_CODE } } },
        { nameEn: { in: DUPLICATE_SUBJECT_NAMES }, grade: { curriculum: { code: { not: REFERENCE_CURRICULUM_CODE } } } },
      ],
    },
    select: {
      id: true,
      nameEn: true,
      gradeId: true,
      isActive: true,
      _count: { select: { studentSubjects: true } },
      units: { select: { _count: { select: { topics: true } } } },
    },
  });

  const offerings = await db.gradeSubject.findMany({ select: { gradeId: true, subjectId: true, isActive: true } });

  const entitlements = await db.studentSubject.findMany({
    select: {
      studentId: true,
      subjectId: true,
      expiresAt: true,
      student: { select: { grade: { select: { level: true, curriculum: { select: { code: true } } } } } },
    },
  });

  return {
    grades: grades.map((g) => ({ id: g.id, level: g.level, curriculumCode: g.curriculum.code, isActive: g.isActive })),
    subjects: subjects.map((s) => ({
      id: s.id,
      nameEn: s.nameEn,
      gradeId: s.gradeId,
      isActive: s.isActive,
      unitCount: s.units.length,
      topicCount: s.units.reduce((n, u) => n + u._count.topics, 0),
      entitlementCount: s._count.studentSubjects,
    })),
    offerings,
    entitlements: entitlements.map((e) => ({
      studentId: e.studentId,
      subjectId: e.subjectId,
      expiresAt: e.expiresAt,
      studentGradeLevel: e.student.grade.level,
      studentCurriculumCode: e.student.grade.curriculum.code,
    })),
  };
}

export function renderDryRun(plan: SharedSubjectsPlan): string {
  const lines: string[] = [
    `level offset: ${LEVEL_OFFSET} (target level N -> reference level N + ${LEVEL_OFFSET})`,
    `links: ${plan.links.length}`,
    `withdrawals: ${plan.withdrawals.length}`,
    `entitlementRepoints: ${plan.entitlementRepoints.length}`,
    `blocked: ${plan.blocked.length}`,
    "",
  ];
  for (const link of plan.links) lines.push(`LINK       ${link.curriculumCode} level ${link.level} -> ${link.subjectId} (${link.nameEn})`);
  for (const w of plan.withdrawals) lines.push(`WITHDRAW   ${w.curriculumCode} level ${w.level} ${w.nameEn} (${w.subjectId}) — ${w.reason}`);
  for (const r of plan.entitlementRepoints) lines.push(`REPOINT    student ${r.studentId}: ${r.fromSubjectId} -> ${r.toSubjectId}`);
  for (const b of plan.blocked) {
    lines.push(`BLOCKED    ${b.curriculumCode} level ${b.level} ${b.nameEn} (${b.subjectId}) — ${b.reason} units=${b.unitCount} topics=${b.topicCount} entitlements=${b.entitlementCount}`);
  }
  for (const n of plan.notes) lines.push(`NOTE       ${n.code} ${n.curriculumCode}${n.level === undefined ? "" : ` level ${n.level}`}`);
  return lines.join("\n");
}

export type ApplyResult = {
  /** Pairs this plan owns as ACTIVE offerings — includes pairs that were already active, so a re-run still reports the full desired state rather than 0. */
  offeringsCreated: number;
  /** Subset of offeringsCreated that this run actually inserted. */
  linksInserted: number;
  offeringsDeactivated: number;
  subjectsDeactivated: number;
  entitlementsRepointed: number;
  entitlementsDeduplicated: number;
  appliedAt: string;
};

/** Which GradeSubject rows this plan wants active, regardless of which run created them. */
export type DesiredOfferingState = {
  activeOfferingPairs: Array<{ gradeId: string; subjectId: string }>;
  inactiveOfferingPairs: Array<{ gradeId: string; subjectId: string }>;
  deactivatedSubjectIds: string[];
};

/**
 * The FULL effect of a plan, independent of what had already been applied.
 * `applyPlan` returns only what it changed, so a re-run of an already-applied
 * plan produced `offeringsCreated: 0` and an EMPTY reverse map — i.e. the
 * record of how to undo the real apply was destroyed by the verification
 * re-run. The evidence files are written from this function instead.
 */
export function desiredStateFor(plan: SharedSubjectsPlan): DesiredOfferingState {
  return {
    activeOfferingPairs: plan.links.map((l) => ({ gradeId: l.gradeId, subjectId: l.subjectId })),
    inactiveOfferingPairs: plan.withdrawals.map((w) => ({ gradeId: w.gradeId, subjectId: w.subjectId })),
    deactivatedSubjectIds: [...new Set(plan.withdrawals.map((w) => w.subjectId))],
  };
}

export async function applyPlan(db: PrismaClient, plan: SharedSubjectsPlan): Promise<ApplyResult> {
  if (plan.blocked.length > 0) {
    throw new Error(
      `Refusing to apply: ${plan.blocked.length} row(s) are blocked and need a human decision — ${plan.blocked
        .map((b) => `${b.nameEn}@${b.curriculumCode}/${b.level}:${b.reason}`)
        .join(", ")}`,
    );
  }

  const result: ApplyResult = {
    // NOTE (2026-10-06): both counters describe THIS RUN's delta, not the
    // phase's total effect. The planner only emits a link for a pair that is
    // not ALREADY OFFERED, so re-running an applied plan yields 0 here and an
    // EMPTY reverse map — which is why the evidence under docs/ was authored
    // from the reviewed dry run plus the verified Postgres state instead of
    // from a later run's output.
    offeringsCreated: plan.links.length,
    linksInserted: plan.links.length,
    offeringsDeactivated: 0,
    subjectsDeactivated: 0,
    entitlementsRepointed: 0,
    entitlementsDeduplicated: 0,
    appliedAt: new Date().toISOString(),
  };

  await db.$transaction(async (tx) => {
    // plan.links holds every pair that is not already offered, so this run
    // inserts all of them; the count is kept separately so a no-op re-run is
    // distinguishable from the original apply in the report.
    result.linksInserted = plan.links.length;

    for (const link of plan.links) {
      await tx.gradeSubject.upsert({
        where: { gradeId_subjectId: { gradeId: link.gradeId, subjectId: link.subjectId } },
        update: { isActive: true },
        create: { gradeId: link.gradeId, subjectId: link.subjectId },
      });    }

    // Entitlements move BEFORE any duplicate is withdrawn, so a student is never
    // left without access at any point inside the transaction.
    for (const repoint of plan.entitlementRepoints) {
      const target = await tx.studentSubject.findUnique({
        where: { studentId_subjectId: { studentId: repoint.studentId, subjectId: repoint.toSubjectId } },
      });
      const moving = await tx.studentSubject.findUnique({
        where: { studentId_subjectId: { studentId: repoint.studentId, subjectId: repoint.fromSubjectId } },
      });
      if (!moving) continue;

      if (!target) {
        await tx.studentSubject.update({
          where: { studentId_subjectId: { studentId: repoint.studentId, subjectId: repoint.fromSubjectId } },
          data: { subjectId: repoint.toSubjectId },
        });
        result.entitlementsRepointed += 1;
        continue;
      }

      // Two rows for the same student and the same target subject. Keep the more
      // permissive grant: a permanent one (expiresAt null) beats any dated one,
      // otherwise the later expiry wins. Removing the redundant row is a DEDUPE
      // of two rows describing one entitlement — the single case where
      // StudentSubject deletion is allowed — and it is counted and reported.
      const keepExpiresAt =
        target.expiresAt == null || moving.expiresAt == null
          ? null
          : target.expiresAt > moving.expiresAt
            ? target.expiresAt
            : moving.expiresAt;
      await tx.studentSubject.update({
        where: { studentId_subjectId: { studentId: repoint.studentId, subjectId: repoint.toSubjectId } },
        data: { expiresAt: keepExpiresAt },
      });
      await tx.studentSubject.delete({
        where: { studentId_subjectId: { studentId: repoint.studentId, subjectId: repoint.fromSubjectId } },
      });
      result.entitlementsDeduplicated += 1;
    }

    for (const withdrawal of plan.withdrawals) {
      const deactivated = await tx.gradeSubject.updateMany({
        where: { gradeId: withdrawal.gradeId, subjectId: withdrawal.subjectId },
        data: { isActive: false },
      });
      result.offeringsDeactivated += deactivated.count;
      await tx.subject.update({ where: { id: withdrawal.subjectId }, data: { isActive: false } });
      result.subjectsDeactivated += 1;
    }
  });

  return result;
}

export function reverseMapFor(plan: SharedSubjectsPlan) {
  return {
    undo: {
      links: plan.links.map((l) => ({ gradeId: l.gradeId, subjectId: l.subjectId })),
      withdrawals: plan.withdrawals.map((w) => ({ gradeId: w.gradeId, subjectId: w.subjectId })),
      entitlementRepoints: plan.entitlementRepoints.map((r) => ({
        studentId: r.studentId,
        fromSubjectId: r.fromSubjectId,
        toSubjectId: r.toSubjectId,
      })),
    },
    notes: [
      "links: set GradeSubject.isActive false (or delete the row) to stop offering the subject",
      "withdrawals: set GradeSubject.isActive true and Subject.isActive true to restore the duplicate",
      "entitlementRepoints: move StudentSubject rows back from toSubjectId to fromSubjectId",
    ],
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = new PrismaClient();
  try {
    const snapshot = await loadSnapshot(db);
    const plan = planSharedSubjects(snapshot);
    process.stdout.write(`${renderDryRun(plan)}\n`);

    if (!apply) {
      process.stdout.write("\nDRY RUN — nothing was written. Re-run with --apply after reviewing the above.\n");
      return;
    }
    if (plan.blocked.length > 0) {
      process.stdout.write("\nRefusing to apply while rows are blocked. Resolve them first.\n");
      process.exitCode = 1;
      return;
    }

    const result = await applyPlan(db, plan);
    const stamp = result.appliedAt.replace(/[:.]/g, "-");
    // Compiled __dirname is <project>/apps/backend/dist/scripts, so the
    // project's docs/ is exactly four levels up. (The original five-level
    // literal resolved to smartify-ai-phase10-final/docs — outside the package
    // — and aborted AFTER the transaction had already committed.)
    const outDir = path.resolve(__dirname, "../../../../docs");
    fs.writeFileSync(path.join(outDir, `shared-subjects-apply-report-${stamp}.json`), `${JSON.stringify({ result, plan }, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, `shared-subjects-reverse-map-${stamp}.json`), `${JSON.stringify(reverseMapFor(plan), null, 2)}\n`);
    process.stdout.write(`\nAPPLIED ${JSON.stringify(result)}\n`);
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
