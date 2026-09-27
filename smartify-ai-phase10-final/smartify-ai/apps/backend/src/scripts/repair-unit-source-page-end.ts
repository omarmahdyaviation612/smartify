/**
 * One-off, explicit-allowlist repair for the 2026-09-26 curriculum-wide
 * audit finding: 44 of 45 seeded Subjects have their FINAL Unit's
 * `sourcePageEnd` left null. Root cause (see seed-titles-from-manifests.js,
 * "sourcePageEnd for unit i = unit i+1's sourcePage - 1; the LAST unit uses
 * entry.totalPages ... otherwise it stays null"): the TOC manifests never
 * supplied `totalPages` for 44 of 45 books, so the seeder deliberately left
 * the last Unit's end page unset rather than guess. A null `sourcePageEnd`
 * makes `UnitGroundingService.prepareNextGroundingChunk()` return
 * CONFIGURATION_ERROR forever (see unit-grounding.service.ts) — this script
 * backfills the missing value from verified evidence so those Units become
 * groundable again on the next real student /advance request (no manual
 * grounding — see UnitGroundingProgressService.sameIdentity()).
 *
 * BRITISH_INTL Year 6 English Language (unitId cmucxcugm00hd2qd53jl8ay86) is
 * NOT in this allowlist: its production R2 object is a confirmed 91-page
 * partial/incomplete scan while its sourcePageStart is 186 — this is a
 * source-file content problem, not a metadata problem, and must be repaired
 * separately once a correct textbook is sourced. Never add it here without
 * a verified replacement PDF.
 *
 * Every OTHER row's `proposedSourcePageEnd` is either:
 *   - `override` — a specific value established by visual/text-density
 *     inspection of the real production R2 PDF's trailing pages (the last
 *     unit's true curricular content ends before trailing blank/print-spec/
 *     shared-appendix pages), or
 *   - absent — meaning "use the physical page count of the real production
 *     R2 PDF, verified live at preflight time" (no trailing non-curricular
 *     matter was found for that book).
 *
 * This script NEVER hardcodes a page count — every row's physical PDF page
 * count is re-fetched from R2 and re-measured on every run, so a stale
 * assumption can never silently apply. See `preflightAndApply()`.
 *
 * Usage:
 *   pnpm --filter backend exec ts-node src/scripts/repair-unit-source-page-end.ts            (dry run — default, no writes)
 *   pnpm --filter backend exec ts-node src/scripts/repair-unit-source-page-end.ts --apply     (writes, only after a clean dry run)
 *
 * No grounding, no /advance, no OpenAI calls, no R2 writes (only the
 * existing GetObject-based fetchToTempFile is used), no
 * UnitGroundingProgress writes, no groundingNotesJson changes, no
 * Subject.sourceFile changes. Only `Unit.sourcePageEnd` is ever written,
 * only for the rows below, only inside one transaction, only after every
 * row in the allowlist has been independently re-verified against live
 * production data.
 */
import "reflect-metadata";
import "dotenv/config";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import type { CurriculumSourceStorage } from "../interactive-lesson/unit-grounding/storage/curriculum-source-storage.interface";
import { CurriculumSourceStorageFactory } from "../interactive-lesson/unit-grounding/storage/curriculum-source-storage.factory";
import { pdfRendererPython } from "../interactive-lesson/unit-grounding/pdf-renderer-runtime";

export const EXCLUDED_SOURCE_FILE_MISMATCH = {
  unitId: "cmucxcugm00hd2qd53jl8ay86",
  subjectId: "cmucxcuf700gf2qd5t5q38tcx",
  label: "BRITISH_INTL Year 6 English Language",
  reason: "SOURCE_FILE_MISMATCH: production R2 PDF has 91 physical pages but Unit.sourcePageStart is 186. Wrong/incomplete textbook object — needs a verified replacement PDF before any metadata repair, not included here.",
} as const;

export interface RepairAllowlistRow {
  subjectId: string;
  unitId: string;
  label: string;
  expectedSourcePageStart: number;
  /** Set only for rows whose true curricular end was established by direct
   * inspection (trailing blank/print-spec/shared-appendix pages excluded).
   * Absent means "use the live physical PDF page count". */
  override?: number;
  /**
   * 2026-09-27: set ONLY for a row correcting an ALREADY-non-null
   * `sourcePageEnd` (every other row here only ever fills a null one). Must
   * equal the exact currently-persisted value being corrected — preflight
   * re-verifies this live and FAILs closed if the live value has since
   * changed to anything else, so this can never silently overwrite an
   * unexpected/already-different value. Requires `override` to also be set
   * (the corrected target must be an explicit, evidence-based value, never
   * a re-derived physical page count).
   */
  correctFromSourcePageEnd?: number;
}

// Real production IDs, sourced mechanically from the 2026-09-26
// curriculum-wide audit extraction (/tmp/curriculum-wide-audit-full.json),
// never retyped/guessed. 43 rows — BRITISH Y6 English is deliberately
// excluded (see EXCLUDED_SOURCE_FILE_MISMATCH above).
export const ALLOWLIST: RepairAllowlistRow[] = [
  { subjectId: "cmucxctey00052qd5su3dqbh4", unitId: "cmucxctgp00132qd5hw4z1zgy", label: "BRITISH_INTL Year 1 English", expectedSourcePageStart: 159 },
  { subjectId: "cmucxcth600172qd5z7y827w5", unitId: "cmucxctk400352qd5woivrloy", label: "BRITISH_INTL Year 1 Mathematics", expectedSourcePageStart: 182 },
  { subjectId: "cmucxctkh00392qd57uu63e4c", unitId: "cmucxctmr00472qd5wokz49il", label: "BRITISH_INTL Year 1 Science", expectedSourcePageStart: 131 },
  { subjectId: "cmucxctob004d2qd5ajweuz1n", unitId: "cmucxctqv005b2qd5rioc6zah", label: "BRITISH_INTL Year 3 English", expectedSourcePageStart: 158 },
  { subjectId: "cmucxctr7005f2qd5b94tz37g", unitId: "cmucxctuu007d2qd599zg70v8", label: "BRITISH_INTL Year 3 Mathematics", expectedSourcePageStart: 183 },
  { subjectId: "cmucxctuz007h2qd509z05jhf", unitId: "cmucxctxc008n2qd5b9jhamwu", label: "BRITISH_INTL Year 3 Science", expectedSourcePageStart: 132 },
  { subjectId: "cmucxcu00009z2qd51fgrijd2", unitId: "cmucxcu1q00ax2qd5uglr1p7a", label: "BRITISH_INTL Year 4 English", expectedSourcePageStart: 156 },
  { subjectId: "cmucxcu2100b12qd53jgefke6", unitId: "cmucxcu8v00cz2qd5as4ugp5a", label: "BRITISH_INTL Year 4 Mathematics", expectedSourcePageStart: 187 },
  { subjectId: "cmucxctxs008t2qd5byvyk0ft", unitId: "cmucxctzt009v2qd5fbrcpiil", label: "BRITISH_INTL Year 4 Science", expectedSourcePageStart: 128 },
  { subjectId: "cmucxcub400eb2qd5a7xngtj7", unitId: "cmucxcuex00g92qd5y6j3mxhr", label: "BRITISH_INTL Year 5 Mathematics", expectedSourcePageStart: 186 },
  { subjectId: "cmucxcugu00hh2qd5gjpr3q2s", unitId: "cmucxcuk600jf2qd5lzfy5eo4", label: "BRITISH_INTL Year 6 Mathematics", expectedSourcePageStart: 186 },
  { subjectId: "cmucxcukc00jj2qd5z4hry58h", unitId: "cmucxcumv00kh2qd5t9aq3new", label: "BRITISH_INTL Year 6 Science", expectedSourcePageStart: 126 },
  { subjectId: "cmucxcun700kn2qd5ajc9fhd1", unitId: "cmucxcuoo00l92qd5ub3fx6sn", label: "EG_NATIONAL Grade 1 English", expectedSourcePageStart: 103 },
  { subjectId: "cmucxcuoy00ld2qd5uhgaj4o1", unitId: "cmucxcuqw00mf2qd5fzd407k6", label: "EG_NATIONAL Grade 1 Islamic", expectedSourcePageStart: 62 },
  { subjectId: "cmucxcurp00n12qd52mwjl05c", unitId: "cmucxcut900nz2qd5um6phtrp", label: "EG_NATIONAL Grade 2 Arabic", expectedSourcePageStart: 82 },
  { subjectId: "cmucxcuvs00pf2qd5a5zrr74g", unitId: "cmucxcuws00q12qd58wsy4zoi", label: "EG_NATIONAL Grade 2 English", expectedSourcePageStart: 82 },
  { subjectId: "cmucxcuwy00q52qd554pikgig", unitId: "cmucxcuyc00r72qd55pu23dd1", label: "EG_NATIONAL Grade 2 Islamic", expectedSourcePageStart: 63 },
  {
    subjectId: "cmucxcuu000od2qd5sbgih0ln",
    unitId: "cmucxcuvl00pb2qd5ptpa04qr",
    label: "EG_NATIONAL Grade 2 Mathematics",
    expectedSourcePageStart: 120,
    // 2026-09-27 visual audit: physical page 125 is the genuine final
    // instructional page; 126-127 are blank Notes pages and 128 is the
    // back-cover/colophon — excluded from grounding's page range.
    override: 125,
    correctFromSourcePageEnd: 128,
  },
  { subjectId: "cmucxcuzf00rt2qd5mokbdrcr", unitId: "cmucxcv0y00sf2qd5cw5lwohq", label: "EG_NATIONAL Grade 3 Arabic", expectedSourcePageStart: 84, override: 126 },
  { subjectId: "cmucxcv3500tv2qd57rywrgoh", unitId: "cmucxcv5500v92qd58n4d6a7n", label: "EG_NATIONAL Grade 3 English", expectedSourcePageStart: 99 },
  { subjectId: "cmucxcv5l00vj2qd5164wippr", unitId: "cmucxcv6v00wd2qd5clg0qkyd", label: "EG_NATIONAL Grade 3 Islamic", expectedSourcePageStart: 59 },
  { subjectId: "cmucxcv1k00sp2qd5c6ekf2jo", unitId: "cmucxcv2z00tr2qd5u7l6swrw", label: "EG_NATIONAL Grade 3 Mathematics", expectedSourcePageStart: 106 },
  { subjectId: "cmucxcv7p00wt2qd531l7qrnd", unitId: "cmucxcv8z00xf2qd5l9o1rdlb", label: "EG_NATIONAL Grade 4 Arabic", expectedSourcePageStart: 102, override: 150 },
  { subjectId: "cmucxcvf6010z2qd5vwcgz7ge", unitId: "cmucxcvi1012p2qd5mee90aa8", label: "EG_NATIONAL Grade 4 English", expectedSourcePageStart: 96 },
  { subjectId: "cmucxcvn301572qd5tudvpy7j", unitId: "cmucxcvnz015n2qd5rbsrytea", label: "EG_NATIONAL Grade 4 ICT", expectedSourcePageStart: 30 },
  { subjectId: "cmucxcvib012t2qd5yehrw2aq", unitId: "cmucxcvk2013r2qd5to3tb302", label: "EG_NATIONAL Grade 4 Islamic", expectedSourcePageStart: 65 },
  { subjectId: "cmucxcv9h00xp2qd5jhsxddxt", unitId: "cmucxcveu010t2qd5ps9qk6g8", label: "EG_NATIONAL Grade 4 Mathematics", expectedSourcePageStart: 124 },
  { subjectId: "cmucxcvor01612qd59g7kpv8n", unitId: "cmucxcvq9016v2qd5kn1763eh", label: "EG_NATIONAL Grade 4 Science", expectedSourcePageStart: 92 },
  { subjectId: "cmucxcvks01472qd5crlkw4el", unitId: "cmucxcvm9014v2qd5aohzvhl4", label: "EG_NATIONAL Grade 4 Social Studies", expectedSourcePageStart: 72, override: 112 },
  { subjectId: "cmucxcvqh01712qd5joicbbq3", unitId: "cmucxcvrb017n2qd50r6eyw1v", label: "EG_NATIONAL Grade 5 Arabic", expectedSourcePageStart: 99, override: 150 },
  { subjectId: "cmucxcvwi01av2qd5zfuqd37z", unitId: "cmucxcvz501cf2qd5rji3uiqd", label: "EG_NATIONAL Grade 5 English", expectedSourcePageStart: 92 },
  { subjectId: "cmucxcw7q01fn2qd5dtts57f0", unitId: "cmucxcw9a01g32qd5gue0iomw", label: "EG_NATIONAL Grade 5 ICT", expectedSourcePageStart: 27 },
  { subjectId: "cmucxcvzb01cj2qd563injcar", unitId: "cmucxcw1f01dd2qd5iyky8nhx", label: "EG_NATIONAL Grade 5 Islamic", expectedSourcePageStart: 59 },
  { subjectId: "cmucxcvrs017x2qd53uns1slq", unitId: "cmucxcvw201al2qd5fx3txroz", label: "EG_NATIONAL Grade 5 Mathematics", expectedSourcePageStart: 121 },
  { subjectId: "cmucxcw2b01dr2qd56mrjztgr", unitId: "cmucxcw4d01ep2qd5iboyq742", label: "EG_NATIONAL Grade 5 Science", expectedSourcePageStart: 92 },
  { subjectId: "cmucxcw4q01et2qd5zrl5hrv4", unitId: "cmucxcw7001ff2qd59crm0f0m", label: "EG_NATIONAL Grade 5 Social Studies", expectedSourcePageStart: 68 },
  { subjectId: "cmucxcwb001gj2qd5s0ppynjo", unitId: "cmucxcwey01h52qd5uxwje5s1", label: "EG_NATIONAL Grade 6 Arabic", expectedSourcePageStart: 100, override: 145 },
  { subjectId: "cmucxcwlp01jp2qd5ef7c1jpm", unitId: "cmucxcwq301lf2qd5j8f8t1cw", label: "EG_NATIONAL Grade 6 English", expectedSourcePageStart: 85 },
  { subjectId: "cmucxcwxs01ox2qd5e9r4w908", unitId: "cmucxcwyh01pd2qd5m4bp0fo6", label: "EG_NATIONAL Grade 6 ICT", expectedSourcePageStart: 29 },
  { subjectId: "cmucxcwqg01lj2qd5jyc3a89h", unitId: "cmucxcws001mh2qd5tzeueh93", label: "EG_NATIONAL Grade 6 Islamic", expectedSourcePageStart: 70 },
  { subjectId: "cmucxcwfs01hf2qd55hfkccfe", unitId: "cmucxcwkz01jf2qd50jljt46j", label: "EG_NATIONAL Grade 6 Mathematics", expectedSourcePageStart: 99 },
  { subjectId: "cmucxcwt901mv2qd5u4la5ply", unitId: "cmucxcwvg01nx2qd592xqxw9g", label: "EG_NATIONAL Grade 6 Science", expectedSourcePageStart: 82 },
  { subjectId: "cmucxcww001o12qd5uj6wg47o", unitId: "cmucxcwx601on2qd5wjp74scb", label: "EG_NATIONAL Grade 6 Social Studies", expectedSourcePageStart: 76 },
];

if (ALLOWLIST.length !== 43) {
  throw new Error(`ALLOWLIST must contain exactly 43 rows — found ${ALLOWLIST.length}.`);
}
if (ALLOWLIST.some((r) => r.unitId === EXCLUDED_SOURCE_FILE_MISMATCH.unitId)) {
  throw new Error("BRITISH Y6 English must never appear in ALLOWLIST — it is a SOURCE_FILE_MISMATCH, not a metadata repair.");
}
if (new Set(ALLOWLIST.map((r) => r.unitId)).size !== ALLOWLIST.length) {
  throw new Error("ALLOWLIST contains a duplicate unitId.");
}
if (ALLOWLIST.some((r) => r.correctFromSourcePageEnd !== undefined && r.override === undefined)) {
  throw new Error("A row with correctFromSourcePageEnd must also set an explicit override — a correction target can never be a re-derived physical page count.");
}

export type UnitLookup = (unitId: string) => Promise<{
  id: string;
  subjectId: string;
  sourcePageStart: number | null;
  sourcePageEnd: number | null;
  sourceFileOverride: string | null;
  subject: { sourceFile: string | null; grade: { level: number; curriculum: { code: string } } };
} | null>;

export interface RepairDeps {
  findUnit: UnitLookup;
  storage: Pick<CurriculumSourceStorage, "fetchToTempFile">;
  countPages: (pdfPath: string) => number;
  updateSourcePageEnd: (rows: { unitId: string; sourcePageEnd: number }[]) => Promise<void>;
}

export type RowOutcome =
  | { row: RepairAllowlistRow; state: "PENDING"; proposedSourcePageEnd: number; physicalPdfPageCount: number; resolvedSourceKey: string }
  | { row: RepairAllowlistRow; state: "ALREADY_APPLIED"; proposedSourcePageEnd: number; physicalPdfPageCount: number; resolvedSourceKey: string }
  | { row: RepairAllowlistRow; state: "FAIL"; reason: string };

export interface PreflightResult {
  status: "READY_TO_APPLY" | "ALREADY_APPLIED" | "FAIL_CLOSED";
  rows: RowOutcome[];
  errors: string[];
}

/** Real PDF page count via the same PyMuPDF venv the production renderer uses. */
export function countPagesViaPyMuPDF(pdfPath: string): number {
  const python = pdfRendererPython();
  const out = execFileSync(python, ["-c", "import pymupdf,sys; print(pymupdf.open(sys.argv[1]).page_count)", pdfPath]).toString().trim();
  return parseInt(out, 10);
}

async function preflightRow(deps: RepairDeps, row: RepairAllowlistRow): Promise<RowOutcome> {
  const unit = await deps.findUnit(row.unitId);
  if (!unit) return { row, state: "FAIL", reason: `Unit ${row.unitId} not found.` };
  if (unit.subjectId !== row.subjectId) return { row, state: "FAIL", reason: `subjectId mismatch: expected ${row.subjectId}, found ${unit.subjectId}.` };
  if (unit.sourcePageStart !== row.expectedSourcePageStart) return { row, state: "FAIL", reason: `sourcePageStart mismatch: expected ${row.expectedSourcePageStart}, found ${unit.sourcePageStart}.` };
  if (unit.sourceFileOverride !== null) return { row, state: "FAIL", reason: `sourceFileOverride expected null, found "${unit.sourceFileOverride}".` };

  const resolvedSourceKey = unit.subject.sourceFile;
  if (!resolvedSourceKey) return { row, state: "FAIL", reason: "No resolved source key (Subject.sourceFile is null)." };

  let physicalPdfPageCount: number;
  let localPath: string | undefined;
  let isTemporary = false;
  try {
    const fetched = await deps.storage.fetchToTempFile(resolvedSourceKey, { curriculumCode: unit.subject.grade.curriculum.code, gradeLevel: unit.subject.grade.level });
    localPath = fetched.localPath;
    isTemporary = fetched.isTemporary;
    physicalPdfPageCount = deps.countPages(localPath);
  } catch (err) {
    return { row, state: "FAIL", reason: `Could not fetch/parse R2 object "${resolvedSourceKey}": ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    if (localPath && isTemporary) fs.rmSync(path.dirname(localPath), { recursive: true, force: true });
  }

  const proposedSourcePageEnd = row.override ?? physicalPdfPageCount;
  if (proposedSourcePageEnd < row.expectedSourcePageStart) return { row, state: "FAIL", reason: `proposedSourcePageEnd (${proposedSourcePageEnd}) < sourcePageStart (${row.expectedSourcePageStart}).` };
  if (proposedSourcePageEnd > physicalPdfPageCount) return { row, state: "FAIL", reason: `proposedSourcePageEnd (${proposedSourcePageEnd}) > physicalPdfPageCount (${physicalPdfPageCount}).` };

  if (unit.sourcePageEnd === null) return { row, state: "PENDING", proposedSourcePageEnd, physicalPdfPageCount, resolvedSourceKey };
  if (unit.sourcePageEnd === proposedSourcePageEnd) return { row, state: "ALREADY_APPLIED", proposedSourcePageEnd, physicalPdfPageCount, resolvedSourceKey };
  if (row.correctFromSourcePageEnd !== undefined && unit.sourcePageEnd === row.correctFromSourcePageEnd) {
    return { row, state: "PENDING", proposedSourcePageEnd, physicalPdfPageCount, resolvedSourceKey };
  }
  return { row, state: "FAIL", reason: `sourcePageEnd is already set to an UNEXPECTED value (${unit.sourcePageEnd}, expected null${row.correctFromSourcePageEnd !== undefined ? ` or ${row.correctFromSourcePageEnd}` : ""} or ${proposedSourcePageEnd}) — refusing to overwrite.` };
}

/**
 * Runs preflight for all 43 rows. Never writes.
 *
 * The "every row in the same state" check below exists to catch an
 * UNINTENDED mixed state among the original null-filling rows (e.g. a
 * previous partial/interrupted run) — it was never meant to block a
 * deliberate, individually-verified `correctFromSourcePageEnd` row, whose
 * safety comes entirely from its own exact-value precondition in
 * `preflightRow`, not from every other row agreeing with it. Correction
 * rows are therefore excluded from the uniformity check and always allowed
 * to apply on their own PENDING/ALREADY_APPLIED outcome.
 */
export async function preflight(deps: RepairDeps): Promise<PreflightResult> {
  const rows = await Promise.all(ALLOWLIST.map((row) => preflightRow(deps, row)));
  const errors = rows.filter((r): r is Extract<RowOutcome, { state: "FAIL" }> => r.state === "FAIL").map((r) => `${r.row.label} (${r.row.unitId}): ${r.reason}`);

  if (errors.length > 0) return { status: "FAIL_CLOSED", rows, errors };

  const originalRows = rows.filter((r) => r.row.correctFromSourcePageEnd === undefined);
  const correctionRows = rows.filter((r) => r.row.correctFromSourcePageEnd !== undefined);
  const originalUniform = originalRows.every((r) => r.state === "PENDING") || originalRows.every((r) => r.state === "ALREADY_APPLIED");
  if (!originalUniform) {
    return {
      status: "FAIL_CLOSED",
      rows,
      errors: ["Mixed state: some original (null-filling) rows are PENDING and some are ALREADY_APPLIED. Refusing to partially apply — investigate before retrying."],
    };
  }
  const anyPending = rows.some((r) => r.state === "PENDING");
  const allApplied = originalRows.every((r) => r.state === "ALREADY_APPLIED") && correctionRows.every((r) => r.state === "ALREADY_APPLIED");
  if (allApplied) return { status: "ALREADY_APPLIED", rows, errors: [] };
  if (anyPending) return { status: "READY_TO_APPLY", rows, errors: [] };
  return {
    status: "FAIL_CLOSED",
    rows,
    errors: ["Unreachable preflight state — investigate before retrying."],
  };
}

/**
 * Full dry-run/apply flow. Dry run (default) only ever calls `preflight()`.
 * `--apply` additionally writes — but ONLY when preflight status is
 * READY_TO_APPLY, in one transaction, updating ONLY `sourcePageEnd`, then
 * re-reads all 43 rows to verify the persisted value matches exactly.
 */
export async function preflightAndApply(deps: RepairDeps, opts: { apply: boolean }): Promise<PreflightResult> {
  const result = await preflight(deps);
  if (!opts.apply) return result;
  if (result.status === "FAIL_CLOSED") return result;
  if (result.status === "ALREADY_APPLIED") return result; // nothing to write — safe no-op

  const pending = result.rows.filter((r): r is Extract<RowOutcome, { state: "PENDING" }> => r.state === "PENDING");
  await deps.updateSourcePageEnd(pending.map((r) => ({ unitId: r.row.unitId, sourcePageEnd: r.proposedSourcePageEnd })));

  // Post-write verification: re-fetch every row and confirm it matches exactly
  // — both the rows this run just wrote AND every already-applied row that
  // was correctly left untouched (its expected value is its own
  // proposedSourcePageEnd from preflight, not just the just-written subset).
  const verification = await Promise.all(
    ALLOWLIST.map(async (row) => {
      const unit = await deps.findUnit(row.unitId);
      const outcome = result.rows.find((r) => r.row.unitId === row.unitId);
      const expected = outcome && outcome.state !== "FAIL" ? outcome.proposedSourcePageEnd : undefined;
      return { unitId: row.unitId, ok: !!unit && unit.sourcePageEnd === expected };
    }),
  );
  const failedVerification = verification.filter((v) => !v.ok);
  if (failedVerification.length > 0) {
    throw new Error(`POST-WRITE VERIFICATION FAILED for ${failedVerification.length} row(s): ${failedVerification.map((v) => v.unitId).join(", ")}`);
  }

  return result;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const prisma = app.get(PrismaService);
    const storage = app.get(CurriculumSourceStorageFactory).get();

    const deps: RepairDeps = {
      findUnit: (unitId) =>
        prisma.client.unit.findUnique({
          where: { id: unitId },
          select: {
            id: true, subjectId: true, sourcePageStart: true, sourcePageEnd: true, sourceFileOverride: true,
            subject: { select: { sourceFile: true, grade: { select: { level: true, curriculum: { select: { code: true } } } } } },
          },
        }),
      storage,
      countPages: countPagesViaPyMuPDF,
      updateSourcePageEnd: (rows) =>
        prisma.client.$transaction(rows.map((r) => prisma.client.unit.update({ where: { id: r.unitId }, data: { sourcePageEnd: r.sourcePageEnd } }))).then(() => undefined),
    };

    console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
    console.log(`Excluded (SOURCE_FILE_MISMATCH): ${EXCLUDED_SOURCE_FILE_MISMATCH.label} — unitId ${EXCLUDED_SOURCE_FILE_MISMATCH.unitId}`);
    const result = await preflightAndApply(deps, { apply });

    console.log(`Status: ${result.status}`);
    for (const r of result.rows) {
      if (r.state === "FAIL") console.log(`  FAIL      ${r.row.label} (${r.row.unitId}): ${r.reason}`);
      else console.log(`  ${r.state.padEnd(9)} ${r.row.label} (${r.row.unitId}): sourcePageEnd -> ${r.proposedSourcePageEnd} (physical=${r.physicalPdfPageCount}, key=${r.resolvedSourceKey})`);
    }
    if (result.errors.length > 0) {
      console.error(`\n${result.errors.length} error(s):`);
      result.errors.forEach((e) => console.error(` - ${e}`));
      process.exitCode = 1;
      return;
    }
    console.log(`\n${result.status === "READY_TO_APPLY" ? (apply ? "APPLIED" : "WOULD APPLY") : result.status}: ${result.rows.length} row(s).`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("FAILED:", err);
    process.exit(1);
  });
}
