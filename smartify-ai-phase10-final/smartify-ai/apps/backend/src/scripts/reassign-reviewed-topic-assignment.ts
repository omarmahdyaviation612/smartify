/**
 * ADMIN: set ONE Topic's grounding assignment to a REVIEWED selection of exact
 * evidence from its Unit's current grounding (2026-10-04). See
 * ai/context/reviewed-assignment.ts for the semantics and safety rules.
 *
 * DRY RUN (default): validates the manifest, resolves the candidate slice with
 * the runtime resolver and prints it with its assignment fingerprint and the
 * live row's CAS hash. Zero writes, zero provider calls.
 *
 * --apply: requires the two values the dry-run printed, so exactly the
 * reviewed slice is written, and only if the row is unchanged:
 *   --expectRow=<expectedRowHash> --expectFingerprint=<candidate.fingerprint>
 * Refuses a Topic with CURRENT content (that needs staged regeneration + an
 * atomic flip) or any student activity. Never calls an AI provider.
 *
 * Usage:
 *   node dist/scripts/reassign-reviewed-topic-assignment.js --topicId=<id> --evidence=<manifest.json> [--apply --expectRow=<hash> --expectFingerprint=<tga1:...>]
 *
 * Manifest: {"concepts":[...],"vocabulary":[...],"facts":[...],"hints":[...]} — exact
 * strings from the Unit's grounding; a name occurring n>1 times must be given as
 * {"name": "...", "occurrences": n}.
 */
import * as fs from "fs";
import { applyReviewedAssignment, parseManifest, planReviewedAssignment, REVIEWED_TOPIC_SELECT, type ReviewedManifest } from "../ai/context/reviewed-assignment";

const ID = /^[a-z0-9]{20,40}$/;

export interface ReviewedArgs { topicId: string; evidence: string; apply: boolean; expectRow: string | null; expectFingerprint: string | null }

export function parseArgs(argv: string[]): ReviewedArgs {
  for (const a of argv) if (!/^--(topicId|evidence|expectRow|expectFingerprint)=.+$/.test(a) && a !== "--apply") throw new Error(`unexpected argument: ${a}`);
  if (argv.filter((a) => a === "--apply").length > 1) throw new Error("--apply given more than once");
  const one = (n: string, required: boolean) => {
    const v = argv.filter((a) => a.startsWith(`--${n}=`));
    if (v.length > 1 || (required && v.length !== 1)) throw new Error(`--${n} must be given exactly once`);
    return v.length ? v[0].slice(n.length + 3) : null;
  };
  const topicId = one("topicId", true)!;
  if (!ID.test(topicId)) throw new Error("malformed --topicId");
  const apply = argv.includes("--apply");
  const expectRow = one("expectRow", false);
  const expectFingerprint = one("expectFingerprint", false);
  if (apply && (!expectRow || !expectFingerprint)) throw new Error("--apply requires --expectRow and --expectFingerprint from the dry-run");
  if (!apply && (expectRow || expectFingerprint)) throw new Error("--expectRow/--expectFingerprint are only valid with --apply");
  return { topicId, evidence: one("evidence", true)!, apply, expectRow, expectFingerprint };
}

export interface ReviewedDeps {
  loadTopic(topicId: string): Promise<any>;
  transaction: { $transaction: (fn: (tx: any) => Promise<any>, opts?: any) => Promise<any> };
}

export async function runReviewedReassignment(args: ReviewedArgs, manifest: ReviewedManifest, deps: ReviewedDeps) {
  const plan = planReviewedAssignment(await deps.loadTopic(args.topicId), manifest);
  if (!args.apply) return { mode: "DRY_RUN" as const, plan };
  const applied = await applyReviewedAssignment(deps.transaction, args.topicId, manifest, { rowHash: args.expectRow!, fingerprint: args.expectFingerprint! });
  return { mode: "APPLY" as const, plan, applied };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = parseManifest(JSON.parse(fs.readFileSync(args.evidence, "utf8")));
  await import("dotenv/config");
  const { prisma } = await import("@smartify/database");
  try {
    const out = await runReviewedReassignment(args, manifest, {
      loadTopic: (id) => prisma.topic.findUnique({ where: { id }, select: REVIEWED_TOPIC_SELECT }),
      transaction: prisma as any,
    });
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("REVIEWED REASSIGNMENT REFUSED:", err instanceof Error ? err.message : err, err?.detail ? JSON.stringify(err.detail) : "");
      process.exit(1);
    });
}
