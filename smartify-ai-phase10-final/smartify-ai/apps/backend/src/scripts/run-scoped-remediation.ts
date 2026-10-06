/**
 * CLI wiring for the scoped bilingual-alias (Part 1) and coarse-grounding-
 * refinement (Part 2) backfills (2026-09-28). Drives ONLY the two exported
 * functions in `topic-grounding-scoped-backfill.ts` against ONLY
 * `CATEGORY_A_TOPIC_IDS` (1 topic) and `CATEGORY_B_TOPIC_IDS` (28 topics) —
 * no other Topic is ever queried or touched by this script.
 *
 * DEFAULT = DRY RUN: reports exactly which of the 29 topicIds would be
 * attempted and their current state, WITHOUT calling either service (zero
 * writes, zero provider calls). Only --apply invokes the real alias
 * generation / refinement calls (real, bounded AI provider spend — one call
 * per Unit for Part 1's alias generation, one call per Topic for Part 2).
 *
 * Usage:
 *   pnpm --filter backend exec ts-node src/scripts/run-scoped-remediation.ts            (dry run — default)
 *   pnpm --filter backend exec ts-node src/scripts/run-scoped-remediation.ts --apply     (executes)
 *
 * Production: run the COMPILED artifact, e.g.
 *   railway ssh --service smartify -- node apps/backend/dist/scripts/run-scoped-remediation.js
 *   railway ssh --service smartify -- node apps/backend/dist/scripts/run-scoped-remediation.js --apply
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { AIProviderFactory } from "../ai/ai-provider.factory";
import { AIUsageService } from "../ai/usage/ai-usage.service";
import { TopicGroundingAssignmentService } from "../ai/context/topic-grounding-assignment.service";
import { GroundingConceptAliasService } from "../ai/context/grounding-concept-alias.service";
import { TopicGroundingValidatorService } from "../ai/context/topic-grounding-validator.service";
import { TopicGroundingRefinementService } from "../ai/context/topic-grounding-refinement.service";
import { runScopedBilingualBackfill, runScopedCoarseRefinementBackfill, CATEGORY_A_TOPIC_IDS, CATEGORY_B_TOPIC_IDS } from "./topic-grounding-scoped-backfill";

async function main() {
  const apply = process.argv.includes("--apply");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });

  try {
    const prisma = app.get(PrismaService);
    const providerFactory = app.get(AIProviderFactory);
    const usageService = app.get(AIUsageService);
    const assignmentService = app.get(TopicGroundingAssignmentService);

    // Deliberately NOT registered in any module (mirrors the mapper/validator's
    // own student-runtime-unreachability guarantee) — constructed explicitly here.
    const aliasService = new GroundingConceptAliasService(prisma, providerFactory, usageService);
    const validatorService = new TopicGroundingValidatorService(prisma, providerFactory, usageService, assignmentService);
    const refinementService = new TopicGroundingRefinementService(prisma, providerFactory, usageService, assignmentService);

    console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
    console.log(`Category A (bilingual) target: ${CATEGORY_A_TOPIC_IDS.length} topic(s)`);
    console.log(`Category B (coarse-grounding) target: ${CATEGORY_B_TOPIC_IDS.length} topic(s)`);
    console.log("");

    if (!apply) {
      const allIds = [...CATEGORY_A_TOPIC_IDS, ...CATEGORY_B_TOPIC_IDS];
      const topics = await prisma.client.topic.findMany({
        where: { id: { in: allIds } },
        select: {
          id: true,
          nameEn: true,
          groundingAssignment: { select: { status: true, method: true } },
          unit: { select: { id: true, groundingVersion: true, groundingSourceFingerprint: true } },
        },
      });
      const byId = new Map(topics.map((t) => [t.id, t]));
      console.log("=== DRY RUN preview (zero writes, zero provider calls) ===");
      for (const id of allIds) {
        const t = byId.get(id);
        const category = CATEGORY_A_TOPIC_IDS.includes(id) ? "A(bilingual)" : "B(coarse)";
        if (!t) {
          console.log(`  ${id} [${category}]: NOT FOUND`);
          continue;
        }
        const grounded = t.unit.groundingVersion !== null && t.unit.groundingSourceFingerprint !== null;
        console.log(
          `  ${id} [${category}] "${t.nameEn}" — unit grounded: ${grounded}; current assignment: ${t.groundingAssignment ? `${t.groundingAssignment.status}/${t.groundingAssignment.method}` : "none"}`,
        );
      }
      console.log(`\nWOULD ATTEMPT: ${allIds.length} topic(s) (${CATEGORY_A_TOPIC_IDS.length} bilingual + ${CATEGORY_B_TOPIC_IDS.length} coarse-grounding). No other Topic is ever read.`);
      return;
    }

    console.log("=== Part 1: bilingual alignment ===");
    const part1 = await runScopedBilingualBackfill({ prisma, aliasService, validatorService }, CATEGORY_A_TOPIC_IDS);
    for (const r of part1) console.log(JSON.stringify(r));

    console.log("\n=== Part 2: coarse-grounding refinement ===");
    const part2 = await runScopedCoarseRefinementBackfill(refinementService, CATEGORY_B_TOPIC_IDS);
    for (const r of part2) console.log(JSON.stringify(r));
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
