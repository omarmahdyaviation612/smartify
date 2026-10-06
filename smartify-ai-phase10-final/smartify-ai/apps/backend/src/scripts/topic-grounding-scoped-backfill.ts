import { PrismaService } from "../prisma/prisma.service";
import { GroundingConceptAliasService } from "../ai/context/grounding-concept-alias.service";
import { TopicGroundingValidatorService } from "../ai/context/topic-grounding-validator.service";
import { TopicGroundingRefinementService } from "../ai/context/topic-grounding-refinement.service";
import type { ConceptAliasBridge } from "../ai/context/topic-grounding-validator-candidate.util";
import type { ValidatorOutcome } from "../ai/context/topic-grounding-validator.service";
import type { RefinementOutcome } from "../ai/context/topic-grounding-refinement.service";

/**
 * Scoped backfill runners (2026-09-28) for the bilingual-alias (Part 1) and
 * coarse-grounding-refinement (Part 2) mechanisms.
 *
 * ---------------------------------------------------------------------------
 * STRUCTURAL SAFETY: ONLY the explicit topicId list passed in is ever
 * touched. Neither function enumerates Units/Topics broadly, neither calls
 * `assignGroundingForTopic` (the broad, all-720-Topics path), and neither
 * bumps any shared version constant. Each function's FIRST action for a
 * given topicId is a single `prisma.topic.findUnique({ where: { id } })` —
 * there is no scan, no `findMany` over Topics, and no code path here that
 * can reach a topicId not present in the caller-supplied array. A topicId
 * NOT in the target list is never read, never written, and never even
 * constructed into a query.
 */

export interface ScopedBackfillDeps {
  prisma: PrismaService;
  aliasService: GroundingConceptAliasService;
  validatorService: TopicGroundingValidatorService;
}

export interface Part1Result {
  topicId: string;
  aliasOutcome?: "GENERATED" | "ALREADY_CURRENT" | "SKIPPED" | string;
  validatorOutcome: ValidatorOutcome;
}

/**
 * Part 1 — bilingual alignment. For each topicId in `topicIds` (and ONLY
 * those): loads its Unit, runs alias generation for that Unit if it has no
 * current-version aliases yet, then re-runs the (unmodified) bounded
 * validator for that ONE topicId, now passing that Unit's persisted aliases
 * so `identifySingleCandidateWithAliases` can bridge an alias-language
 * match. Units are only ever the ones actually reached BY resolving one of
 * the given topicIds — never enumerated independently.
 */
export async function runScopedBilingualBackfill(deps: ScopedBackfillDeps, topicIds: string[]): Promise<Part1Result[]> {
  const results: Part1Result[] = [];
  const aliasedUnits = new Set<string>();

  for (const topicId of topicIds) {
    const topic = await deps.prisma.client.topic.findUnique({ where: { id: topicId }, select: { id: true, unitId: true } });
    if (!topic) {
      results.push({ topicId, validatorOutcome: { outcome: "NOT_GROUNDED", reason: `Topic ${topicId} not found.` } });
      continue;
    }

    let aliasOutcome: Part1Result["aliasOutcome"];
    if (!aliasedUnits.has(topic.unitId)) {
      const hasCurrent = await deps.aliasService.hasCurrentAliases(topic.unitId);
      if (hasCurrent) {
        aliasOutcome = "ALREADY_CURRENT";
      } else {
        const gen = await deps.aliasService.generateAliasesForUnit(topic.unitId);
        aliasOutcome = gen.outcome;
      }
      aliasedUnits.add(topic.unitId);
    } else {
      aliasOutcome = "SKIPPED";
    }

    const aliasRows = await deps.prisma.client.groundingConceptAlias.findMany({ where: { unitId: topic.unitId } });
    const aliases: ConceptAliasBridge[] = aliasRows.map((a) => ({
      itemKind: a.itemKind as "CONCEPT" | "HINT",
      itemName: a.itemName,
      canonicalLabel: a.canonicalLabel,
      aliasEn: a.aliasEn,
      aliasAr: a.aliasAr,
    }));

    const validatorOutcome = await deps.validatorService.validateCandidate(topicId, aliases);
    results.push({ topicId, aliasOutcome, validatorOutcome });
  }

  return results;
}

export interface Part2Result {
  topicId: string;
  outcome: RefinementOutcome;
}

/**
 * Part 2 — Category B coarse-grounding refinement. For each topicId in
 * `topicIds` (and ONLY those), calls `refineCoarseGrounding` directly. No
 * enumeration, no broad path, no version bump.
 */
export async function runScopedCoarseRefinementBackfill(refinementService: TopicGroundingRefinementService, topicIds: string[]): Promise<Part2Result[]> {
  const results: Part2Result[] = [];
  for (const topicId of topicIds) {
    const outcome = await refinementService.refineCoarseGrounding(topicId);
    results.push({ topicId, outcome });
  }
  return results;
}

/** The exact Category A (bilingual) target list this task was scoped to — never used as a bypass, only as documentation/reference for a caller wiring up a real run. */
export const CATEGORY_A_TOPIC_IDS: string[] = ["cmucxcvk5013t2qd5y9ylnrcl"];

/** The exact Category B (coarse-grounding) target list this task was scoped to. */
export const CATEGORY_B_TOPIC_IDS: string[] = [
  "cmucxcupd00ll2qd5i84w18v9",
  "cmucxcutq00o72qd5jj7mpxc9",
  "cmucxcus400n92qd5dulegp23",
  "cmucxcusn00nj2qd545z4d7pr",
  "cmucxcusv00np2qd5e29y7do7",
  "cmucxcut300nt2qd58nls9k1d",
  "cmucxcut700nx2qd55t7adkm9",
  "cmucxcuxs00qt2qd50u5o5asu",
  "cmucxcv5c00vd2qd5rib9g3pa",
  "cmucxcv1400sh2qd5t3i99gp3",
  "cmucxcv0q00sb2qd5hgf3sk6j",
  "cmucxcv4e00up2qd584bn3cqo",
  "cmucxcv9500xj2qd51xxwjo6t",
  "cmucxcvad00y72qd5rhzdiki0",
  "cmucxcvcb00z92qd5t21tybz5",
  "cmucxcvqn01752qd5aqh8k3ys",
  "cmucxcvrk017t2qd53goui9hm",
  "cmucxcvrg017r2qd5sqbruixe",
  "cmucxcvr7017l2qd5ja60sg5e",
  "cmucxcvub019d2qd5oks6m57o",
  "cmucxcvy701bx2qd5satul193",
  "cmucxcvyy01cb2qd5hyz68skm",
  "cmucxcwgc01hn2qd5ljkbrz6x",
  "cmucxcwkn01j72qd5wwgx13pb",
  "cmucxcwo901kl2qd5fsm2n849",
  "cmucxcwp301kx2qd5roz3cail",
  "cmucxcvhs012j2qd5ervp0ko1",
  "cmucxcwe401gx2qd5xk35d8n3",
];
