/**
 * Explicit, per-Unit switch from TRANSITION to STRICT downstream content
 * provenance enforcement (2026-10-03, Wave B runtime safety).
 *
 * TRANSITION (Unit.contentProvenanceEnforcedAt = null, the migration default):
 * LEGACY (pre-provenance) teachingSteps/Questions are still served for READY
 * Topics, so deploying the provenance columns breaks nothing.
 * STRICT (contentProvenanceEnforcedAt set): only content whose stored
 * provenance equals the Topic's current grounding is served.
 *
 * Enabling STRICT is refused unless, for every READY_CURRENT_NON_EMPTY Topic
 * in the Unit, (a) existing teachingSteps are CURRENT and (b) a Topic that
 * still has LEGACY/MISMATCHED Questions already holds a full CURRENT pool — so
 * switching can never silently empty a lesson or a practice pool. BLOCKED
 * Topics are ignored: runtime never serves them in either mode.
 *
 * DRY RUN (default) only reports. --apply writes contentProvenanceEnforcedAt
 * with a compare-and-set on the current value. --disable reverts a Unit to
 * TRANSITION (the rollback path).
 *
 * Usage:
 *   node dist/scripts/enforce-content-provenance.js --unitIds=<id>[,<id>] [--apply] [--disable]
 */
import { classifyContentProvenance, evaluateTopicGroundingGate, topicStepsProvenance, type GateTopic, type StoredProvenance, type TopicStepsProvenanceFields } from "../ai/context/topic-content-provenance.util";
import { POOL_TARGET } from "./regenerate-topic-content";

const ID = /^[a-z0-9]{20,40}$/;

export interface EnforceArgs { unitIds: string[]; apply: boolean; disable: boolean }

export function parseArgs(argv: string[]): EnforceArgs {
  for (const a of argv) if (!/^--unitIds=.+$/.test(a) && a !== "--apply" && a !== "--disable") throw new Error(`unexpected argument: ${a}`);
  const lists = argv.filter((a) => a.startsWith("--unitIds="));
  if (lists.length !== 1) throw new Error("--unitIds must be given exactly once");
  const unitIds = lists[0].slice("--unitIds=".length).split(",");
  if (unitIds.some((x) => !ID.test(x))) throw new Error("malformed --unitIds entry");
  if (new Set(unitIds).size !== unitIds.length) throw new Error("duplicate --unitIds entry");
  return { unitIds, apply: argv.includes("--apply"), disable: argv.includes("--disable") };
}

export type EnforcementTopic = GateTopic & TopicStepsProvenanceFields & { id: string; teachingStepsJson: unknown; questions: Array<StoredProvenance & { isPlaceholder?: boolean }> };

/** Pure: the reasons STRICT would withhold content that TRANSITION currently serves. Empty = safe to enable. */
export function strictReadinessBlockers(topics: EnforcementTopic[]): string[] {
  const blockers: string[] = [];
  for (const t of topics) {
    const gate = evaluateTopicGroundingGate(t);
    if (gate.state !== "READY") continue;
    if (t.teachingStepsJson && classifyContentProvenance(topicStepsProvenance(t), gate.provenance) !== "CURRENT") blockers.push(`${t.id}: teachingSteps not CURRENT`);
    const states = t.questions.filter((q) => !q.isPlaceholder).map((q) => classifyContentProvenance(q, gate.provenance));
    const current = states.filter((s) => s === "CURRENT").length;
    if (states.length > current && current < POOL_TARGET) blockers.push(`${t.id}: ${current}/${POOL_TARGET} CURRENT Questions alongside ${states.length - current} non-current`);
  }
  return blockers;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await import("dotenv/config");
  const { prisma } = await import("@smartify/database");
  const { TOPIC_GATE_INCLUDE, UNIT_GATE_SELECT, QUESTION_PROVENANCE_SELECT } = await import("../ai/context/topic-content-provenance.util");
  const report = [];
  try {
    for (const unitId of args.unitIds) {
      const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { ...UNIT_GATE_SELECT } });
      if (!unit) throw new Error(`Unit ${unitId} not found`);
      const topics = await prisma.topic.findMany({
        where: { unitId },
        select: { id: true, teachingStepsJson: true, groundingSourceFingerprintUsed: true, groundingAssignmentFingerprintUsed: true, ...TOPIC_GATE_INCLUDE, questions: { select: { isPlaceholder: true, ...QUESTION_PROVENANCE_SELECT } } },
      });
      const blockers = args.disable ? [] : strictReadinessBlockers(topics.map((t) => ({ ...t, unit })) as any);
      const entry: Record<string, unknown> = { unitId, enforcedAt: unit.contentProvenanceEnforcedAt, target: args.disable ? "TRANSITION" : "STRICT", blockers };
      if (blockers.length) throw Object.assign(new Error(`Unit ${unitId} is not ready for STRICT enforcement`), { report: [...report, entry] });
      if (args.apply) {
        const updated = await prisma.unit.updateMany({
          where: { id: unitId, contentProvenanceEnforcedAt: unit.contentProvenanceEnforcedAt },
          data: { contentProvenanceEnforcedAt: args.disable ? null : new Date() },
        });
        if (updated.count !== 1) throw new Error(`Unit ${unitId} changed concurrently; nothing written`);
        entry.applied = true;
      }
      report.push(entry);
    }
    console.log(JSON.stringify({ mode: args.apply ? "APPLY" : "DRY_RUN", report }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      if (err?.report) console.log(JSON.stringify({ report: err.report }, null, 2));
      console.error("ENFORCEMENT FAILED:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
