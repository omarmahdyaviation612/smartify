/**
 * Controlled, explicit-allowlist Unit RE-GROUND for Units whose page range was
 * corrected by the Wave B printed-to-physical repair (repair-unit-page-offset).
 *
 * Never clears grounding first. For each allowlisted Unit (processed one at a
 * time, stopping at the first failure):
 *   1. preflight against the reviewed Wave B plan — the live source file is
 *      unchanged, the live range equals the approved corrected range, and the
 *      stored fingerprint is still the historical old-range fingerprint;
 *   2. generate replacement notes with the existing UnitGrounding pipeline
 *      (renderer, model, prompt, chunking/pacing, image-aware accounting)
 *      without persisting anything;
 *   3. validate the replacement (non-empty, every cited page inside the
 *      corrected range);
 *   4. atomically replace all grounding fields with ONE compare-and-set update
 *      conditioned on the exact preflighted range + old fingerprint.
 * Any failure before step 4 leaves the existing grounding untouched.
 *
 * DRY RUN (default) performs only the preflight. Assignments are NOT touched
 * here; rebuild them afterwards with topic-grounding-remediation for that
 * Unit's Topics only.
 *
 * Usage:
 *   node dist/scripts/reground-unit.js --plan=<wave-b.plan.json> --unitIds=<id>[,<id>] [--apply]
 */
import * as crypto from "crypto";
import * as fs from "fs";
import { validatePlan, type PlanBook, type RepairPlan } from "./repair-unit-page-offset";

export const groundingSourceFingerprint = (sourceKey: string, start: number, end: number) => crypto.createHash("sha256").update(`${sourceKey}|${start}-${end}`).digest("hex");

const ID = /^[a-z0-9]{20,40}$/;
export function parseArgs(argv: string[]): { plan: string; unitIds: string[]; apply: boolean } {
  for (const a of argv) {
    if (!/^--(plan|unitIds)=.+$/.test(a) && a !== "--apply") throw new Error(`unexpected argument: ${a}`);
  }
  const one = (n: string) => { const v = argv.filter((a) => a.startsWith(`--${n}=`)); if (v.length !== 1) throw new Error(`--${n} must be given exactly once`); return v[0].slice(n.length + 3); };
  const unitIds = one("unitIds").split(",");
  if (unitIds.some((x) => !ID.test(x))) throw new Error("malformed --unitIds entry");
  if (new Set(unitIds).size !== unitIds.length) throw new Error("duplicate --unitIds entry");
  if (argv.filter((a) => a === "--apply").length > 1) throw new Error("--apply given more than once");
  return { plan: one("plan"), unitIds, apply: argv.includes("--apply") };
}

export interface ApprovedTarget { unitId: string; label: string; order: number; sourceKey: string; oldStart: number; oldEnd: number; newStart: number; newEnd: number; oldFingerprint: string; newFingerprint: string }

/** Resolves the approved corrected range for a Unit from the reviewed Wave B plan (same arithmetic as the applied repair). */
export function approvedTarget(plan: RepairPlan, unitId: string): ApprovedTarget {
  const book: PlanBook | undefined = plan.books.find((b) => b.expectedUnits.some((u) => u.unitId === unitId));
  if (!book) throw new Error(`Unit ${unitId} is not in the reviewed Wave B plan`);
  const units = [...book.expectedUnits].sort((a, b) => a.order - b.order);
  const i = units.findIndex((u) => u.unitId === unitId), u = units[i];
  const newStart = u.persistedStart + book.offset;
  const newEnd = i + 1 < units.length ? units[i + 1].persistedStart + book.offset - 1 : book.finalUnitContentEnd;
  return { unitId, label: `${book.label} U${u.order}`, order: u.order, sourceKey: book.sourceFile, oldStart: u.persistedStart, oldEnd: u.persistedEnd, newStart, newEnd, oldFingerprint: groundingSourceFingerprint(book.sourceFile, u.persistedStart, u.persistedEnd), newFingerprint: groundingSourceFingerprint(book.sourceFile, newStart, newEnd) };
}

export interface LiveUnitGrounding { id: string; sourceFileOverride: string | null; subjectSourceFile: string | null; sourcePageStart: number | null; sourcePageEnd: number | null; groundingSourceFingerprint: string | null; hasNotes: boolean }

export function preflight(t: ApprovedTarget, live: LiveUnitGrounding | null): void {
  if (!live) throw new Error(`${t.label}: Unit not found`);
  if (live.sourceFileOverride !== null || live.subjectSourceFile !== t.sourceKey) throw new Error(`${t.label}: source file changed`);
  if (live.sourcePageStart !== t.newStart || live.sourcePageEnd !== t.newEnd) throw new Error(`${t.label}: live range ${live.sourcePageStart}-${live.sourcePageEnd} != approved corrected ${t.newStart}-${t.newEnd}`);
  if (live.groundingSourceFingerprint !== t.oldFingerprint) throw new Error(`${t.label}: stored fingerprint is not the historical old-range fingerprint (already re-grounded or drifted)`);
  if (!live.hasNotes) throw new Error(`${t.label}: Unit has no existing grounding to replace`);
}

const citedPages = (notes: any): number[] => ["concepts", "facts", "vocabulary", "skills", "learningObjectives", "topicHints"].flatMap((k) => (Array.isArray(notes?.[k]) ? notes[k] : []).flatMap((x: any) => (Array.isArray(x?.sourcePages) ? x.sourcePages : [])));

export function validateReplacement(t: ApprovedTarget, gen: { notes: any; sourceKey: string; pageStart: number; pageEnd: number }): void {
  if (gen.sourceKey !== t.sourceKey || gen.pageStart !== t.newStart || gen.pageEnd !== t.newEnd) throw new Error(`${t.label}: generation used an unexpected source identity`);
  if (!Array.isArray(gen.notes?.concepts) || gen.notes.concepts.length === 0) throw new Error(`${t.label}: replacement grounding has no concepts`);
  const pages = citedPages(gen.notes);
  if (!pages.length) throw new Error(`${t.label}: replacement grounding cites no source pages`);
  const outside = pages.filter((p) => !Number.isInteger(p) || p < t.newStart || p > t.newEnd);
  if (outside.length) throw new Error(`${t.label}: replacement cites pages outside ${t.newStart}-${t.newEnd}: ${[...new Set(outside)].join(",")}`);
}

export interface RegroundDeps {
  loadLive(unitId: string): Promise<LiveUnitGrounding | null>;
  generate(unitId: string): Promise<{ notes: any; model: string; chunkCount: number; sourceKey: string; pageStart: number; pageEnd: number; groundingVersion: number; groundingPromptVersion: string }>;
  /** Single compare-and-set write; must return the number of rows updated. */
  replace(t: ApprovedTarget, gen: { notes: any; model: string; groundingVersion: number; groundingPromptVersion: string }): Promise<number>;
}

export async function runReground(options: { plan: RepairPlan; unitIds: string[]; apply: boolean }, deps: RegroundDeps) {
  const targets = options.unitIds.map((id) => approvedTarget(options.plan, id));
  const results: any[] = [];
  // Full preflight of every requested Unit before any provider call.
  for (const t of targets) preflight(t, await deps.loadLive(t.unitId));
  if (!options.apply) return { mode: "DRY_RUN", targets, results };
  for (const t of targets) {
    preflight(t, await deps.loadLive(t.unitId)); // re-check immediately before spending
    const gen = await deps.generate(t.unitId);
    validateReplacement(t, gen);
    const count = await deps.replace(t, gen);
    if (count !== 1) throw new Error(`${t.label}: guarded replacement matched ${count} rows; live state changed during generation — nothing written`);
    results.push({ unitId: t.unitId, label: t.label, oldFingerprint: t.oldFingerprint, newFingerprint: t.newFingerprint, chunkCount: gen.chunkCount, model: gen.model, concepts: gen.notes.concepts.length });
  }
  return { mode: "APPLY", targets, results };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = validatePlan(JSON.parse(fs.readFileSync(args.plan, "utf8")));
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../app.module");
  const { PrismaService } = await import("../prisma/prisma.service");
  const { UnitGroundingService } = await import("../interactive-lesson/unit-grounding/unit-grounding.service");
  const { CONTENT_AUTHORING_ACTOR_ID } = await import("../ai/content-authoring-actor.const");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const prisma = app.get(PrismaService).client;
    const grounding = app.get(UnitGroundingService);
    const deps: RegroundDeps = {
      loadLive: async (id) => {
        const u = await prisma.unit.findUnique({ where: { id }, select: { id: true, sourceFileOverride: true, sourcePageStart: true, sourcePageEnd: true, groundingSourceFingerprint: true, groundingNotesJson: true, subject: { select: { sourceFile: true } } } });
        return u && { id: u.id, sourceFileOverride: u.sourceFileOverride, subjectSourceFile: u.subject.sourceFile, sourcePageStart: u.sourcePageStart, sourcePageEnd: u.sourcePageEnd, groundingSourceFingerprint: u.groundingSourceFingerprint, hasNotes: !!u.groundingNotesJson };
      },
      generate: (id) => grounding.generateReplacementGrounding(id, CONTENT_AUTHORING_ACTOR_ID),
      replace: async (t, gen) => (await prisma.unit.updateMany({
        where: { id: t.unitId, sourcePageStart: t.newStart, sourcePageEnd: t.newEnd, groundingSourceFingerprint: t.oldFingerprint, sourceFileOverride: null },
        data: { groundingNotesJson: gen.notes, groundingGeneratedAt: new Date(), groundingVersion: gen.groundingVersion, groundingModel: gen.model, groundingPromptVersion: gen.groundingPromptVersion, groundingSourceFingerprint: t.newFingerprint },
      })).count,
    };
    console.log(JSON.stringify(await runReground({ plan, unitIds: args.unitIds, apply: args.apply }, deps), null, 2));
  } finally { await app.close(); }
}

if (require.main === module) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 2; });
