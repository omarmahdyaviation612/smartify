/**
 * READ-ONLY Wave content-readiness plan (2026-10-03).
 *
 * Classifies every Unit of a reviewed wave plan with
 * classifyUnitContentReadiness (ai/context/unit-content-readiness.util.ts):
 * ALREADY_STRICT / ALREADY_READY_FOR_STRICT / NEEDS_PREPARATION /
 * INVALID_STATE, in deterministic order (grade level, grade, subject, Unit
 * order, id). Stored content the student runtime would never serve (LEGACY
 * behind CURRENT, MISMATCH) is reported as historical, not as an issue.
 *
 * Never writes, never calls a provider.
 *
 * Usage:
 *   node dist/scripts/plan-wave-content-readiness.js --plan=<wave.plan.json>
 */
import * as fs from "fs";
import { QUESTION_PROVENANCE_SELECT, TOPIC_GATE_INCLUDE, UNIT_GATE_SELECT } from "../ai/context/topic-content-provenance.util";
import { classifyUnitContentReadiness, type UnitReadiness } from "../ai/context/unit-content-readiness.util";
import { groundingSourceFingerprint } from "./reground-unit";

export function parseArgs(argv: string[]): { plan: string } {
  for (const a of argv) if (!/^--plan=.+$/.test(a)) throw new Error(`unexpected argument: ${a}`);
  const plans = argv.filter((a) => a.startsWith("--plan="));
  if (plans.length !== 1) throw new Error("--plan must be given exactly once");
  return { plan: plans[0].slice("--plan=".length) };
}

export function planUnitIds(plan: { books: Array<{ expectedUnits: Array<{ unitId: string }> }> }): string[] {
  return plan.books.flatMap((b) => b.expectedUnits.map((u) => u.unitId));
}

export function summarize(rows: UnitReadiness[]) {
  const sum = (k: keyof UnitReadiness) => rows.reduce((s, r) => s + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);
  return {
    units: rows.length,
    classes: rows.reduce<Record<string, number>>((m, r) => ((m[r.class] = (m[r.class] ?? 0) + 1), m), {}),
    strictUnits: rows.filter((r) => r.mode === "STRICT").length,
    ready: sum("ready"), blocked: sum("blocked"),
    stepsCurrent: sum("stepsCurrent"), stepsLegacy: sum("stepsLegacy"), stepsMissing: sum("stepsMissing"), stepsMismatch: sum("stepsMismatch"),
    qCurrent: sum("qCurrent"), qLegacy: sum("qLegacy"), qMismatch: sum("qMismatch"), readyUnder8: sum("readyUnder8"),
    historicalNonServable: {
      legacyQuestions: rows.reduce((s, r) => s + r.historicalNonServable.legacyQuestions, 0),
      mismatchQuestions: rows.reduce((s, r) => s + r.historicalNonServable.mismatchQuestions, 0),
    },
    activity: sum("activity"),
    unitsWithoutReady: rows.filter((r) => r.ready === 0).map((r) => r.unitId),
  };
}

/** The one read this plan makes: `prisma.unit.findMany` (no writes, no provider). */
export async function buildReadinessPlan(prisma: { unit: { findMany: (args: any) => Promise<any[]> } }, unitIds: string[]) {
  const units = await prisma.unit.findMany({
    where: { id: { in: unitIds } },
    select: {
      ...UNIT_GATE_SELECT, nameEn: true, order: true, sourcePageStart: true, sourcePageEnd: true, sourceFileOverride: true,
      subject: { select: { nameEn: true, sourceFile: true, grade: { select: { nameEn: true, level: true } } } },
      topics: {
        orderBy: { order: "asc" },
        select: {
          id: true, nameEn: true, teachingStepsJson: true, groundingSourceFingerprintUsed: true, groundingAssignmentFingerprintUsed: true, ...TOPIC_GATE_INCLUDE,
          questions: { select: { topicId: true, isPlaceholder: true, ...QUESTION_PROVENANCE_SELECT, _count: { select: { attempts: true } } } },
          lessons: { select: { _count: { select: { progress: true } } } },
          _count: { select: { lessonSessions: true, quizResults: true } },
        },
      },
    },
  });
  if (units.length !== unitIds.length) throw new Error(`plan lists ${unitIds.length} Units, found ${units.length}`);
  const rows = units.map((u) => {
    const src = u.sourceFileOverride ?? u.subject.sourceFile;
    const expected = src && u.sourcePageStart != null && u.sourcePageEnd != null ? groundingSourceFingerprint(src, u.sourcePageStart, u.sourcePageEnd) : null;
    const readiness = classifyUnitContentReadiness(
      {
        ...u,
        topics: u.topics.map((t: any) => ({
          ...t,
          activity: t._count.lessonSessions + t._count.quizResults + t.questions.reduce((s: number, q: any) => s + q._count.attempts, 0) + t.lessons.reduce((s: number, l: any) => s + l._count.progress, 0),
        })),
      },
      { expectedSourceFingerprint: expected },
    );
    return { grade: u.subject.grade.nameEn as string, level: u.subject.grade.level as number, subject: u.subject.nameEn as string, order: u.order as number, title: u.nameEn as string, range: `${u.sourcePageStart}-${u.sourcePageEnd}`, ...readiness };
  });
  rows.sort((a, b) => a.level - b.level || a.grade.localeCompare(b.grade) || a.subject.localeCompare(b.subject) || a.order - b.order || a.unitId.localeCompare(b.unitId));
  return { summary: summarize(rows), rows };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const unitIds = planUnitIds(JSON.parse(fs.readFileSync(args.plan, "utf8")));
  await import("dotenv/config");
  const { prisma } = await import("@smartify/database");
  try {
    const { summary, rows } = await buildReadinessPlan(prisma as any, unitIds);
    console.log("READINESS_SUM " + JSON.stringify(summary));
    for (const r of rows) console.log("READINESS " + JSON.stringify(r));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error("READINESS_ERR", e instanceof Error ? e.message : String(e)); process.exitCode = 2; });
}
