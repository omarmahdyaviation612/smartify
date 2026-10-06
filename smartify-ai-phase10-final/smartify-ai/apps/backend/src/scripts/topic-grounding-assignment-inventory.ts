/**
 * READ-ONLY inventory for the persisted TopicGroundingAssignment rollout
 * (2026-09-27). Makes ZERO writes and ZERO AI provider calls — it only reads
 * Units/Topics/existing TopicGroundingAssignment rows and runs the pure,
 * DB-free `computeDeterministicAssignment()` (Steps 1-5) in memory to
 * classify Topics that don't yet have a persisted row. It never calls
 * TopicGroundingAssignmentService.assignGroundingForTopic()/upsert(), so
 * nothing here can accidentally persist a row.
 *
 * Usage: node apps/backend/dist/scripts/topic-grounding-assignment-inventory.js
 */
import "dotenv/config";
import { prisma as prismaClient } from "@smartify/database";
import { computeDeterministicAssignment, type AssignmentTopic } from "../ai/context/topic-grounding-assignment.service";
import { DETERMINISTIC_ASSIGNMENT_VERSION, MAPPER_PROMPT_VERSION } from "../ai/context/topic-grounding-assignment.util";
import type { GroundingNotes } from "../interactive-lesson/unit-grounding/unit-grounding.types";

const EXCLUDED_SUBJECT_ID = "cmucxcuf700gf2qd5t5q38tcx"; // BRITISH_INTL Year 6 English — SOURCE_FILE_MISMATCH, hard-excluded everywhere

async function main() {
  const prisma = prismaClient;
  try {
    const units = await prisma.unit.findMany({
      select: {
        id: true,
        subjectId: true,
        groundingNotesJson: true,
        groundingVersion: true,
        groundingSourceFingerprint: true,
        topics: {
          select: {
            id: true,
            nameEn: true,
            order: true,
            teachingStepsJson: true,
            groundingAssignment: {
              select: {
                unitGroundingVersion: true,
                unitSourceFingerprint: true,
                assignmentVersion: true,
                method: true,
                mapperPromptVersion: true,
                status: true,
                confidence: true,
              },
            },
          },
          orderBy: { order: "asc" },
        },
      },
    });

    let totalEligibleTopics = 0;
    let y6EnglishExcludedTopics = 0;
    let authoredTopics = 0;
    let unitsNotGrounded = 0;
    let topicsUnderUngroundedUnits = 0;

    let assignmentRowsPresentValid = 0;
    let assignmentRowsPresentStale = 0;
    let assignmentRowsMissing = 0;

    const deterministicMethodCounts: Record<string, number> = {};
    let deterministicResolvableAmongMissingOrStale = 0;
    let stillNeedsAiMapper = 0;
    let blockedExisting = 0;

    let authoredWithDeterministicPathAvailable = 0;
    let previouslyMissing121ResolvedDeterministically = 0; // topics with no teachingStepsJson yet

    for (const unit of units) {
      const isY6English = unit.subjectId === EXCLUDED_SUBJECT_ID;
      const notes = unit.groundingNotesJson as unknown as GroundingNotes | null;
      const unitGrounded = unit.groundingVersion !== null && unit.groundingSourceFingerprint !== null && !!notes;

      if (isY6English) {
        y6EnglishExcludedTopics += unit.topics.length;
        continue; // never touched by any inventory/backfill/mapper pass
      }

      totalEligibleTopics += unit.topics.length;

      if (!unitGrounded) {
        unitsNotGrounded++;
        topicsUnderUngroundedUnits += unit.topics.length;
        continue;
      }

      const siblings: AssignmentTopic[] = unit.topics.map((t: { id: string; nameEn: string; order: number }) => ({ id: t.id, nameEn: t.nameEn, order: t.order }));

      for (const topic of unit.topics) {
        if (topic.teachingStepsJson) authoredTopics++;

        const a = topic.groundingAssignment;
        const identityValid =
          !!a &&
          a.unitGroundingVersion === unit.groundingVersion &&
          a.unitSourceFingerprint === unit.groundingSourceFingerprint &&
          (a.method === "AI_MAPPER" ? a.mapperPromptVersion === MAPPER_PROMPT_VERSION : a.assignmentVersion === DETERMINISTIC_ASSIGNMENT_VERSION);

        if (a && identityValid) {
          assignmentRowsPresentValid++;
          if (a.status === "BLOCKED") blockedExisting++;
          if (a.method === "AI_MAPPER" && a.status === "READY") {
            deterministicMethodCounts["AI_MAPPER(persisted)"] = (deterministicMethodCounts["AI_MAPPER(persisted)"] ?? 0) + 1;
          } else if (a.status === "READY") {
            deterministicMethodCounts[a.method] = (deterministicMethodCounts[a.method] ?? 0) + 1;
          }
          continue;
        }

        if (a && !identityValid) assignmentRowsPresentStale++;
        else assignmentRowsMissing++;

        // No valid row — classify with the pure, DB-free deterministic pass.
        const assignment = computeDeterministicAssignment(notes, { id: topic.id, nameEn: topic.nameEn, order: topic.order }, siblings, undefined);
        if (assignment) {
          deterministicResolvableAmongMissingOrStale++;
          deterministicMethodCounts[assignment.method] = (deterministicMethodCounts[assignment.method] ?? 0) + 1;
          if (topic.teachingStepsJson) authoredWithDeterministicPathAvailable++;
          else previouslyMissing121ResolvedDeterministically++;
        } else {
          stillNeedsAiMapper++;
        }
      }
    }

    console.log("=== TopicGroundingAssignment READ-ONLY inventory ===");
    console.log(`Total eligible Topics (excluding Y6 English): ${totalEligibleTopics}`);
    console.log(`  of which already authored (teachingStepsJson set): ${authoredTopics}`);
    console.log(`  of which under a NOT-YET-grounded Unit: ${topicsUnderUngroundedUnits} (${unitsNotGrounded} Unit(s))`);
    console.log(`Y6 English Topics excluded (untouched): ${y6EnglishExcludedTopics}`);
    console.log("");
    console.log(`Existing TopicGroundingAssignment rows — valid identity: ${assignmentRowsPresentValid}`);
    console.log(`Existing TopicGroundingAssignment rows — STALE identity (would recompute): ${assignmentRowsPresentStale}`);
    console.log(`Topics with NO assignment row at all: ${assignmentRowsMissing}`);
    console.log(`  of those BLOCKED (mapper already ran, rejected/LOW-confidence/empty): ${blockedExisting}`);
    console.log("");
    console.log(`Among Topics missing/stale, resolvable deterministically (Steps 1-5, zero provider calls): ${deterministicResolvableAmongMissingOrStale}`);
    console.log(`  ...of which already-authored Topics (of the 599): ${authoredWithDeterministicPathAvailable}`);
    console.log(`  ...of which previously-missing Topics (of the ~121): ${previouslyMissing121ResolvedDeterministically}`);
    console.log(`Still requiring the AI_MAPPER (Steps 1-5 found nothing, no valid row exists): ${stillNeedsAiMapper}`);
    console.log("");
    console.log("Deterministic method breakdown (existing valid rows + newly classifiable):");
    for (const [method, count] of Object.entries(deterministicMethodCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${method}: ${count}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("INVENTORY FAILED:", err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
