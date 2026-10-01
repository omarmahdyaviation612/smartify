/**
 * Explicit-allowlist Unit page-range repair for books whose persisted Unit
 * ranges were seeded from PRINTED TOC page numbers but are consumed as
 * PHYSICAL PDF pages (2026-10-01 curriculum pagination audit).
 *
 * Only books classified OFFSET_CONSTANT in the reviewed plan file are
 * eligible. For each eligible book:
 *   correctedStart = persisted start + verified constant offset
 *   correctedEnd   = next Unit's correctedStart - 1, or for the final Unit the
 *                    independently verified physical content boundary from
 *                    the plan (never the raw PDF page count).
 *
 * Units with a sourceFileOverride (separate reader PDFs) are never touched.
 *
 * DRY RUN is the default and performs no writes. `--apply` writes ONLY
 * Unit.sourcePageStart/sourcePageEnd inside one transaction, and only after
 * the complete preflight of every requested book has passed. It never
 * re-grounds, never touches grounding notes/fingerprints, assignments,
 * Topics, Questions or AI usage.
 *
 * Usage:
 *   pnpm --filter backend exec ts-node src/scripts/repair-unit-page-offset.ts \
 *     --plan=../../docs/unit-page-offset-wave-b.plan.json --subjectIds=<id>,<id>
 *   (add --snapshot=<catalog.json> to plan from a read-only exported snapshot
 *    instead of the database; --apply is refused with --snapshot)
 */
import * as fs from "fs";

export type BookClassification = "OFFSET_CONSTANT" | "OK" | "EDITION_MISMATCH" | "OFFSET_NONCONSTANT" | "UNKNOWN";

export interface PlanUnit { unitId: string; order: number; persistedStart: number; persistedEnd: number }
export interface PlanBook {
  subjectId: string;
  label: string;
  classification: "OFFSET_CONSTANT";
  sourceFile: string;
  sourceSha256: string;
  physicalPageCount: number;
  offset: number;
  offsetEvidence: string;
  finalUnitContentEnd: number;
  finalUnitBoundaryEvidence: string;
  expectedUnits: PlanUnit[];
}
export interface ExcludedBook { subjectId: string; label: string; classification: Exclude<BookClassification, "OFFSET_CONSTANT">; reason: string }
export interface RepairPlan { version: 1; books: PlanBook[]; excluded: ExcludedBook[] }

export interface LiveUnit { id: string; order: number; start: number | null; end: number | null; override: string | null; topics: { status: string | null }[] }
export interface LiveSubject { id: string; sourceFile: string | null; units: LiveUnit[] }

export type Severity = "LOW" | "MEDIUM" | "HIGH";
export interface UnitRepairRow {
  subjectId: string; label: string; unitId: string; order: number;
  oldStart: number; oldEnd: number; newStart: number; newEnd: number;
  startDelta: number; endDelta: number; overlapPages: number; correctedPages: number; overlapPct: number; severity: Severity;
  changes: boolean; ready: number; blocked: number; unassigned: number; estimatedGroundingCalls: number;
  missesCorrectedTail: boolean; includesPreviousUnitPages: boolean;
}
export interface RepairReport { mode: "DRY_RUN" | "APPLY"; books: { subjectId: string; label: string; offset: number; units: number; unitsChanging: number; ready: number; blocked: number; correctedPages: number; severity: Record<Severity, number> }[]; rows: UnitRepairRow[]; skippedOverrideUnits: { subjectId: string; unitId: string }[] }

const ID = /^[a-z0-9]{20,40}$/;
const PAGES_PER_GROUNDING_CALL = 2; // ~36.8k high-detail image tokens/page vs the 90k grounding request target

export function parseArgs(argv: string[]): { plan: string; subjectIds: string[]; snapshot?: string; apply: boolean } {
  const known = new Set(["--plan", "--subjectIds", "--snapshot", "--apply"]);
  for (const a of argv) {
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    const name = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
    if (!known.has(name)) throw new Error(`unknown argument: ${a}`);
    if (name !== "--apply" && !a.includes("=")) throw new Error(`argument requires a value: ${a}`);
    if (name === "--apply" && a !== "--apply") throw new Error("--apply takes no value");
  }
  const one = (name: string) => { const v = argv.filter((a) => a.startsWith(name + "=")); if (v.length > 1) throw new Error(`${name} given more than once`); return v[0]?.slice(name.length + 1); };
  const plan = one("--plan"); if (!plan) throw new Error("--plan is required");
  const raw = one("--subjectIds"); if (!raw) throw new Error("--subjectIds is required (explicit allowlist)");
  const subjectIds = raw.split(",");
  if (subjectIds.some((x) => !ID.test(x))) throw new Error("malformed --subjectIds entry");
  if (new Set(subjectIds).size !== subjectIds.length) throw new Error("duplicate --subjectIds entry");
  const snapshot = one("--snapshot"); const apply = argv.filter((a) => a === "--apply").length;
  if (apply > 1) throw new Error("--apply given more than once");
  if (apply && snapshot) throw new Error("--apply is not allowed with --snapshot");
  return { plan, subjectIds, snapshot, apply: apply === 1 };
}

const posInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 1;

export function validatePlan(raw: any): RepairPlan {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.books) || !Array.isArray(raw.excluded)) throw new Error("plan: malformed root");
  const seen = new Set<string>();
  for (const b of raw.books) {
    if (!ID.test(b?.subjectId) || seen.has(b.subjectId)) throw new Error(`plan: bad or duplicate subjectId ${b?.subjectId}`); seen.add(b.subjectId);
    if (b.classification !== "OFFSET_CONSTANT") throw new Error(`plan: ${b.subjectId} is not OFFSET_CONSTANT`);
    if (!Number.isSafeInteger(b.offset) || b.offset === 0) throw new Error(`plan: ${b.subjectId} has a missing/zero offset`);
    if (!posInt(b.physicalPageCount) || !posInt(b.finalUnitContentEnd) || b.finalUnitContentEnd > b.physicalPageCount) throw new Error(`plan: ${b.subjectId} has an invalid page boundary`);
    if (typeof b.sourceFile !== "string" || !b.sourceFile || !/^[0-9a-f]{64}$/.test(b.sourceSha256)) throw new Error(`plan: ${b.subjectId} has no source identity`);
    if (!b.offsetEvidence || !b.finalUnitBoundaryEvidence) throw new Error(`plan: ${b.subjectId} lacks evidence`);
    if (!Array.isArray(b.expectedUnits) || !b.expectedUnits.length) throw new Error(`plan: ${b.subjectId} has no units`);
    const ids = new Set<string>();
    for (const u of b.expectedUnits) { if (!ID.test(u.unitId) || ids.has(u.unitId) || !posInt(u.persistedStart) || !posInt(u.persistedEnd) || !Number.isSafeInteger(u.order)) throw new Error(`plan: ${b.subjectId} has a malformed unit`); ids.add(u.unitId); }
  }
  for (const e of raw.excluded) { if (!ID.test(e?.subjectId) || seen.has(e.subjectId)) throw new Error(`plan: bad or duplicate excluded subjectId ${e?.subjectId}`); seen.add(e.subjectId); if (!["OK", "EDITION_MISMATCH", "OFFSET_NONCONSTANT", "UNKNOWN"].includes(e.classification) || !e.reason) throw new Error(`plan: excluded ${e.subjectId} is malformed`); }
  return raw as RepairPlan;
}

export function selectBooks(plan: RepairPlan, subjectIds: string[]): PlanBook[] {
  const byId = new Map(plan.books.map((b) => [b.subjectId, b]));
  const excluded = new Map(plan.excluded.map((e) => [e.subjectId, e]));
  return subjectIds.map((id) => {
    const ex = excluded.get(id); if (ex) throw new Error(`${id} (${ex.label}) is ${ex.classification} and not eligible: ${ex.reason}`);
    const b = byId.get(id); if (!b) throw new Error(`unknown book ${id}: not in the reviewed plan`);
    return b;
  });
}

const severityOf = (pct: number): Severity => (pct >= 90 ? "LOW" : pct >= 70 ? "MEDIUM" : "HIGH");

/** Pure, deterministic per-book computation + validation against live state. Throws on any mismatch. */
export function planBook(book: PlanBook, live: LiveSubject | undefined): { rows: UnitRepairRow[]; skipped: { subjectId: string; unitId: string }[] } {
  if (!live) throw new Error(`${book.label}: subject not found live`);
  if (live.sourceFile !== book.sourceFile) throw new Error(`${book.label}: source file changed (${live.sourceFile} != ${book.sourceFile})`);
  const own = live.units.filter((u) => !u.override).sort((a, b) => a.order - b.order);
  const skipped = live.units.filter((u) => u.override).map((u) => ({ subjectId: book.subjectId, unitId: u.id }));
  if (own.length !== book.expectedUnits.length) throw new Error(`${book.label}: unit count drifted (${own.length} live vs ${book.expectedUnits.length} planned)`);
  own.forEach((u, i) => {
    const e = book.expectedUnits[i];
    if (u.id !== e.unitId || u.order !== e.order || u.start !== e.persistedStart || u.end !== e.persistedEnd) throw new Error(`${book.label}: unit ${u.id} drifted from the reviewed plan`);
  });
  const starts = own.map((u) => (u.start as number) + book.offset);
  const rows: UnitRepairRow[] = own.map((u, i) => {
    const oldStart = u.start as number, oldEnd = u.end as number, newStart = starts[i];
    const newEnd = i + 1 < own.length ? starts[i + 1] - 1 : book.finalUnitContentEnd;
    const overlapPages = Math.max(0, Math.min(oldEnd, newEnd) - Math.max(oldStart, newStart) + 1);
    const correctedPages = newEnd - newStart + 1;
    const overlapPct = correctedPages > 0 ? Math.round((overlapPages / correctedPages) * 1000) / 10 : 0;
    const changes = oldStart !== newStart || oldEnd !== newEnd;
    return {
      subjectId: book.subjectId, label: book.label, unitId: u.id, order: u.order, oldStart, oldEnd, newStart, newEnd,
      startDelta: newStart - oldStart, endDelta: newEnd - oldEnd, overlapPages, correctedPages, overlapPct, severity: severityOf(overlapPct), changes,
      ready: u.topics.filter((t) => t.status === "READY").length, blocked: u.topics.filter((t) => t.status === "BLOCKED").length, unassigned: u.topics.filter((t) => !t.status).length,
      estimatedGroundingCalls: changes ? Math.ceil(correctedPages / PAGES_PER_GROUNDING_CALL) : 0,
      missesCorrectedTail: newEnd > oldEnd, includesPreviousUnitPages: oldStart < newStart,
    };
  });
  rows.forEach((r, i) => {
    if (r.newStart < 1) throw new Error(`${book.label} U${r.order}: correctedStart < 1`);
    if (r.newEnd < r.newStart) throw new Error(`${book.label} U${r.order}: correctedEnd < correctedStart`);
    if (r.newEnd > book.physicalPageCount) throw new Error(`${book.label} U${r.order}: correctedEnd beyond the physical page count`);
    const next = rows[i + 1];
    if (next && (next.newStart <= r.newEnd || next.newStart !== r.newEnd + 1)) throw new Error(`${book.label} U${r.order}: overlap or gap with the next Unit`);
    if (next && next.newStart <= r.newStart) throw new Error(`${book.label}: corrected Unit order is not monotonic`);
  });
  return { rows, skipped };
}

export interface RepairDeps { loadLive(subjectIds: string[]): Promise<LiveSubject[]>; applyRanges(rows: { unitId: string; expectedStart: number; expectedEnd: number; start: number; end: number }[]): Promise<void> }

export async function runRepair(options: { plan: RepairPlan; subjectIds: string[]; apply: boolean }, deps: RepairDeps): Promise<RepairReport> {
  const books = selectBooks(options.plan, options.subjectIds);
  const live = new Map((await deps.loadLive(options.subjectIds)).map((s) => [s.id, s]));
  // Full-batch preflight: every book is computed and validated before any write.
  const planned = books.map((b) => ({ book: b, ...planBook(b, live.get(b.subjectId)) }));
  const report: RepairReport = { mode: options.apply ? "APPLY" : "DRY_RUN", books: [], rows: [], skippedOverrideUnits: [] };
  for (const p of planned) {
    const sev: Record<Severity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 }; p.rows.forEach((r) => sev[r.severity]++);
    report.books.push({ subjectId: p.book.subjectId, label: p.book.label, offset: p.book.offset, units: p.rows.length, unitsChanging: p.rows.filter((r) => r.changes).length, ready: p.rows.reduce((n, r) => n + r.ready, 0), blocked: p.rows.reduce((n, r) => n + r.blocked, 0), correctedPages: p.rows.reduce((n, r) => n + r.correctedPages, 0), severity: sev });
    report.rows.push(...p.rows); report.skippedOverrideUnits.push(...p.skipped);
  }
  if (options.apply) await deps.applyRanges(report.rows.filter((r) => r.changes).map((r) => ({ unitId: r.unitId, expectedStart: r.oldStart, expectedEnd: r.oldEnd, start: r.newStart, end: r.newEnd })));
  return report;
}

function liveFromSnapshot(file: string): RepairDeps["loadLive"] {
  const cat = JSON.parse(fs.readFileSync(file, "utf8"));
  return async (ids) => cat.filter((s: any) => ids.includes(s.id)).map((s: any) => ({ id: s.id, sourceFile: s.sourceFile, units: s.units.map((u: any) => ({ id: u.id, order: u.order, start: u.start, end: u.end, override: u.override, topics: u.topics.map((t: any) => ({ status: t.status })) })) }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = validatePlan(JSON.parse(fs.readFileSync(args.plan, "utf8")));
  const refuse = async () => { throw new Error("apply is not available in snapshot mode"); };
  if (args.snapshot) { console.log(JSON.stringify(await runRepair({ plan, subjectIds: args.subjectIds, apply: false }, { loadLive: liveFromSnapshot(args.snapshot), applyRanges: refuse }), null, 2)); return; }
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../app.module");
  const { PrismaService } = await import("../prisma/prisma.service");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const prisma = app.get(PrismaService).client;
    const deps: RepairDeps = {
      loadLive: async (ids) => (await prisma.subject.findMany({ where: { id: { in: ids } }, select: { id: true, sourceFile: true, units: { select: { id: true, order: true, sourcePageStart: true, sourcePageEnd: true, sourceFileOverride: true, topics: { select: { groundingAssignment: { select: { status: true } } } } } } } })).map((s: any) => ({ id: s.id, sourceFile: s.sourceFile, units: s.units.map((u: any) => ({ id: u.id, order: u.order, start: u.sourcePageStart, end: u.sourcePageEnd, override: u.sourceFileOverride, topics: u.topics.map((t: any) => ({ status: t.groundingAssignment?.status ?? null })) })) })),
      applyRanges: async (rows) => {
        await prisma.$transaction(async (tx: any) => {
          for (const r of rows) {
            const res = await tx.unit.updateMany({ where: { id: r.unitId, sourcePageStart: r.expectedStart, sourcePageEnd: r.expectedEnd }, data: { sourcePageStart: r.start, sourcePageEnd: r.end } });
            if (res.count !== 1) throw new Error(`unit ${r.unitId} changed concurrently; aborting the whole transaction`);
          }
        });
      },
    };
    console.log(JSON.stringify(await runRepair({ plan, subjectIds: args.subjectIds, apply: args.apply }, deps), null, 2));
  } finally { await app.close(); }
}

if (require.main === module) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 2; });
