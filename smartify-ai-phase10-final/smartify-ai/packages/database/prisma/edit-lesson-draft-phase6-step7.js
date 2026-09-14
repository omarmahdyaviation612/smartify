// One-time human editorial correction (Phase 6, Part B) — NOT AI
// regeneration. Updates only step s7 (COMPLETE)'s `objective` text on the
// existing pending_review LessonDraft "Addition with Zero"
// (cmtyx1wnq0002w7iz5ru2l39f) to child-friendly wording, leaving every
// other field byte-identical. Historical record — do not re-run.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const DRAFT_ID = "cmtyx1wnq0002w7iz5ru2l39f";
const NEW_S7_OBJECTIVE = "Conclude the lesson by reinforcing that adding zero means adding nothing, so the number stays the same.";

async function main() {
  const before = await prisma.lessonDraft.findUniqueOrThrow({
    where: { id: DRAFT_ID },
    select: { id: true, status: true, teachingStepsJson: true },
  });
  const steps = before.teachingStepsJson;

  if (before.status !== "pending_review") {
    throw new Error(`Refusing to edit: draft status is "${before.status}", expected "pending_review".`);
  }
  if (steps[6].id !== "s7" || steps[6].type !== "COMPLETE") {
    throw new Error("Step array shape changed unexpectedly — aborting to avoid editing the wrong step.");
  }

  const beforeS7 = steps[6].objective;
  const updatedSteps = steps.map((step, i) => (i === 6 ? { ...step, objective: NEW_S7_OBJECTIVE } : step));

  await prisma.lessonDraft.update({
    where: { id: DRAFT_ID },
    data: { teachingStepsJson: updatedSteps },
    select: { id: true },
  });

  console.log(JSON.stringify({ draftId: DRAFT_ID, beforeS7, afterS7: NEW_S7_OBJECTIVE }, null, 2));
}

main()
  .catch((e) => {
    console.error("EDIT FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
