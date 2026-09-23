// DB-only maintenance. Default: read-only classification. No R2 or AI dependencies.
import * as fs from "fs";
import { createHash } from "crypto";
import { PrismaClient } from "@smartify/database";
import { phase1Mappings } from "./core-textbook-phase1-verified";
import { defaultObjectKey } from "../interactive-lesson/unit-grounding/storage/curriculum-source-key";

const statuses = ["ALREADY_MAPPED", "READY_TO_UPDATE", "SOURCE_MISMATCH", "SUBJECT_NOT_FOUND", "AMBIGUOUS", "EXCLUDED"] as const;
type Status = typeof statuses[number];
type Mapping = typeof phase1Mappings[number];
type Row = Mapping & { status: Status; subjectId: string | null; oldSourceFile: string | null; reason: string };
const extras = (key: string | null) => !!key && key.split(/[\\/]/).some(p => p.toLowerCase() === "extras");
const fingerprint = createHash("sha256").update(JSON.stringify(phase1Mappings)).digest("hex");

export async function classify(db: any): Promise<Row[]> {
  const rows: Row[] = [];
  for (const item of phase1Mappings) {
    const row: Row = { ...item, status: "EXCLUDED", subjectId: null, oldSourceFile: null, reason: "Unverified Phase 1 object" };
    rows.push(row);
    if (!item.verified || !item.sha256 || extras(item.newSourceFile) || extras(item.expectedSourceFile) ||
        (item.curriculum === "BRITISH_INTL" && item.level === 5 && item.subject === "Mathematics")) continue;
    if (item.newSourceFile !== defaultObjectKey(item.curriculum, item.level, item.subject, item.expectedSourceFile)) throw Error("Canonical key mismatch");
    const matches = await db.subject.findMany({ where: { nameEn: item.subject, grade: { nameEn: item.grade, level: item.level, curriculum: { code: item.curriculum } } }, select: { id: true, sourceFile: true } });
    if (!matches.length) { row.status = "SUBJECT_NOT_FOUND"; row.reason = "No exact curriculum/grade/subject match"; continue; }
    if (matches.length !== 1) { row.status = "AMBIGUOUS"; row.reason = "Multiple exact identity matches"; continue; }
    row.subjectId = matches[0].id;
    row.oldSourceFile = matches[0].sourceFile;
    row.status = row.oldSourceFile === item.newSourceFile ? "ALREADY_MAPPED" : row.oldSourceFile === item.expectedSourceFile ? "READY_TO_UPDATE" : "SOURCE_MISMATCH";
    row.reason = row.status === "SOURCE_MISMATCH" ? "Current mapping differs from both reviewed manifest and canonical key" : "Exact identity and mapping verified";
  }
  return rows;
}

export async function applyReviewed(db: any, rows: Row[]) {
  const outcomes = [];
  for (const row of rows.filter(r => r.status === "READY_TO_UPDATE")) {
    const item = phase1Mappings.find(i => i.curriculum === row.curriculum && i.grade === row.grade && i.subject === row.subject);
    if (!item?.verified || !row.subjectId || row.oldSourceFile !== item.expectedSourceFile || row.newSourceFile !== item.newSourceFile || extras(row.newSourceFile) ||
        (item.curriculum === "BRITISH_INTL" && item.level === 5 && item.subject === "Mathematics")) throw Error("Invalid approved row");
    // Re-check uniqueness/identity, then compare-and-set in one serializable transaction.
    const updated = await db.$transaction(async (tx: any) => {
      const matches = await tx.subject.findMany({ where: { nameEn: item.subject, grade: { nameEn: item.grade, level: item.level, curriculum: { code: item.curriculum } } }, select: { id: true, sourceFile: true } });
      if (matches.length !== 1 || matches[0].id !== row.subjectId || matches[0].sourceFile !== row.oldSourceFile) return false;
      const result = await tx.subject.updateMany({ where: { id: row.subjectId, sourceFile: row.oldSourceFile }, data: { sourceFile: row.newSourceFile } });
      if (result.count !== 1) throw Error("Concurrent mapping change");
      return true;
    }, { isolationLevel: "Serializable" });
    outcomes.push({ subjectId: row.subjectId, status: updated ? "UPDATED" : "SKIPPED_CHANGED_SINCE_REVIEW" });
  }
  return outcomes;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => a !== "--apply-db" && !a.startsWith("--report=") && !a.startsWith("--review="))) throw Error("Unknown argument");
  const apply = args.includes("--apply-db");
  const reportPath = args.find(a => a.startsWith("--report="))?.slice(9) ?? "/tmp/smartify-core-db-dry-run.json";
  const reviewPath = args.find(a => a.startsWith("--review="))?.slice(9);
  if (apply && !reviewPath) throw Error("Apply requires the reviewed --review dry-run JSON");
  const url = new URL(process.env.DATABASE_URL ?? "");
  const target = createHash("sha256").update(url.host + url.pathname).digest("hex");
  const prisma = new PrismaClient({ log: [] });
  try {
    if (apply) {
      const review = JSON.parse(fs.readFileSync(reviewPath!, "utf8"));
      if (review.mode !== "DRY_RUN" || review.target !== target || review.fingerprint !== fingerprint || !Array.isArray(review.rows)) throw Error("Review target/plan mismatch");
      console.log(JSON.stringify(await applyReviewed(prisma, review.rows), null, 2));
    } else {
      const rows = await classify(prisma);
      const report = { mode: "DRY_RUN", target, fingerprint, totalCandidates: phase1Mappings.length,
        counts: Object.fromEntries(statuses.map(s => [s, rows.filter(r => r.status === s).length])), rows };
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify(report, null, 2));
    }
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch(() => { console.error("DB mapping stopped. Check target, reviewed report and connectivity. Raw connection errors suppressed."); process.exitCode = 1; });
