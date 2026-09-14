// One-time human editorial correction (Phase R2.1) — NOT AI regeneration.
// Updates only steps s2 (EXPLAIN) and s3 (CHECK)'s `objective` text on the
// existing pending_review LessonDraft "Addition with Zero"
// (cmtyx1wnq0002w7iz5ru2l39f), leaving every other field byte-identical:
// s2 now leads with child-friendly intuition ("adding nothing changes
// nothing") before the formal term; s3 now asks the child to reason
// through a concrete example (4 apples + 0) instead of a yes/no
// understanding check. Historical record — do not re-run.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const DRAFT_ID = "cmtyx1wnq0002w7iz5ru2l39f";

const NEW_S2_OBJECTIVE =
  "Explain in simple, child-friendly words that adding zero means adding nothing at all, so the number stays exactly the same as before — for example, if you have some toys and add zero more toys, you still have the same number of toys. Mention the formal term \"additive identity\" only briefly afterward, as a secondary note, not as the main explanation.";

const NEW_S3_OBJECTIVE =
  "Ask the child a concrete question and elicit their own reasoning: \"If you have 4 apples and add zero more apples, how many apples do you have? Why?\" Listen to and confirm the child's answer and explanation, rather than simply asking whether they understand.";

async function main() {
  // Explicit select: schema.prisma declares publishedTopicId/publishedAt
  // (Phase 6 Part E) ahead of the migration that adds those columns,
  // deliberately not applied yet — an unrestricted read/write would try
  // to select those non-existent columns and fail. See the same fix in
  // lesson-draft-generator.service.ts (Phase R2).
  const before = await prisma.lessonDraft.findUniqueOrThrow({
    where: { id: DRAFT_ID },
    select: { id: true, teachingStepsJson: true },
  });
  const steps = before.teachingStepsJson;

  if (steps[1].id !== "s2" || steps[2].id !== "s3") {
    throw new Error("Step array shape changed unexpectedly — aborting to avoid editing the wrong steps.");
  }

  const beforeS2 = steps[1].objective;
  const beforeS3 = steps[2].objective;

  const updatedSteps = steps.map((step, i) => {
    if (i === 1) return { ...step, objective: NEW_S2_OBJECTIVE };
    if (i === 2) return { ...step, objective: NEW_S3_OBJECTIVE };
    return step;
  });

  await prisma.lessonDraft.update({
    where: { id: DRAFT_ID },
    data: { teachingStepsJson: updatedSteps },
    select: { id: true },
  });

  console.log(JSON.stringify({ draftId: DRAFT_ID, beforeS2, afterS2: NEW_S2_OBJECTIVE, beforeS3, afterS3: NEW_S3_OBJECTIVE }, null, 2));
}

main()
  .catch((e) => {
    console.error("EDIT FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
