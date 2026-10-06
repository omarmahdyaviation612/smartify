// Shared subjects Phase 2 (2026-10-06) — post-apply, read-only verification.
// Answers the only question that matters after linking: can a student in
// another curriculum actually open this content, grounding included?
import { PrismaClient } from "@smartify/database";
import { findInvariantViolations, type InvariantViolation } from "../common/grade-subject-invariants";
import { resolveEffectiveSourceFile } from "../interactive-lesson/unit-grounding/unit-effective-source.util";
import { REFERENCE_CURRICULUM_CODE, SHARED_SUBJECT_NAMES } from "./shared-subjects-map";

export type SharedSubjectSnapshot = {
  subjectId: string;
  nameEn: string;
  level: number;
  sourceFile: string | null;
  units: Array<{ id: string; sourceFileOverride: string | null }>;
  offeringCount: number;
};

export type VerifyInput = { invariants: InvariantViolation[]; sharedSubjects: SharedSubjectSnapshot[] };

export type VerifyFailure =
  | { kind: "UNIT_WITHOUT_SOURCE"; subjectId: string; level: number; unitId: string }
  | { kind: "SHARED_SUBJECT_NOT_OFFERED"; subjectId: string; level: number }
  | { kind: "INVARIANT_VIOLATION"; violation: InvariantViolation };

export type VerifyWarning = { kind: "NON_CANONICAL_SOURCE_KEY"; subjectId: string; level: number; sourceFile: string };

export function judgeSharedSubjects(input: VerifyInput): { failures: VerifyFailure[]; warnings: VerifyWarning[] } {
  const failures: VerifyFailure[] = [];
  const warnings: VerifyWarning[] = [];

  for (const violation of input.invariants) {
    failures.push({ kind: "INVARIANT_VIOLATION", violation });
  }

  for (const subject of input.sharedSubjects) {
    // A canonical R2 object key contains a path; a bare filename (what the
    // Egyptian grades 2-6 still carry, pending the core-textbook repair) does
    // not. That is a data-hygiene warning, not an outage.
    if (subject.sourceFile != null && !subject.sourceFile.includes("/")) {
      warnings.push({ kind: "NON_CANONICAL_SOURCE_KEY", subjectId: subject.subjectId, level: subject.level, sourceFile: subject.sourceFile });
    }
    for (const unit of subject.units) {
      const resolved = resolveEffectiveSourceFile(
        { sourceFileOverride: unit.sourceFileOverride },
        { sourceFile: subject.sourceFile },
      );
      if (resolved == null) {
        failures.push({ kind: "UNIT_WITHOUT_SOURCE", subjectId: subject.subjectId, level: subject.level, unitId: unit.id });
      }
    }
    if (subject.offeringCount < 1) {
      failures.push({ kind: "SHARED_SUBJECT_NOT_OFFERED", subjectId: subject.subjectId, level: subject.level });
    }
  }

  return { failures, warnings };
}

export async function collectVerificationInput(db: PrismaClient): Promise<VerifyInput> {
  const subjects = await db.subject.findMany({
    where: {
      nameEn: { in: SHARED_SUBJECT_NAMES },
      grade: { curriculum: { code: REFERENCE_CURRICULUM_CODE } },
      isActive: true,
    },
    select: {
      id: true,
      nameEn: true,
      sourceFile: true,
      grade: { select: { level: true } },
      units: { select: { id: true, sourceFileOverride: true } },
      gradeOfferings: { where: { isActive: true }, select: { id: true } },
    },
  });

  return {
    invariants: await findInvariantViolations(db),
    sharedSubjects: subjects.map((s) => ({
      subjectId: s.id,
      nameEn: s.nameEn,
      level: s.grade.level,
      sourceFile: s.sourceFile,
      units: s.units,
      offeringCount: s.gradeOfferings.length,
    })),
  };
}

async function main() {
  const db = new PrismaClient();
  try {
    const judged = judgeSharedSubjects(await collectVerificationInput(db));
    for (const w of judged.warnings) process.stdout.write(`WARN  ${JSON.stringify(w)}\n`);
    for (const f of judged.failures) process.stdout.write(`FAIL  ${JSON.stringify(f)}\n`);
    process.stdout.write(`\nfailures: ${judged.failures.length}  warnings: ${judged.warnings.length}\n`);
    if (judged.failures.length > 0) process.exitCode = 1;
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
