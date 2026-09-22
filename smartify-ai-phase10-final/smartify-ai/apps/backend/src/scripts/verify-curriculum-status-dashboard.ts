/**
 * One-off manual verification (2026-09-20) — confirms the new read-only
 * GET /admin/curriculum/status endpoint's underlying service returns
 * correct real data against the live database, without needing a real
 * Clerk HTTP session. Read-only: makes no writes, triggers no grounding or
 * generation. Safe to delete after use.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { AdminCurriculumService } from "../admin/curriculum/admin-curriculum.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const service = app.get(AdminCurriculumService);
    const result = await service.getCurriculumStatus();

    console.log("SUMMARY:", JSON.stringify(result.summary, null, 2));

    // NOTE: this curriculum has TWO Grade rows at level=5 — the real
    // "Year 5" (isActive) and a leftover "[PLACEHOLDER] Grade 5"
    // (isActive:false) from the original bulk seed — so disambiguate by
    // name+isActive, not level alone.
    const british = result.curricula.find((c) => c.code === "BRITISH_INTL");
    const year5 = british?.grades.find((g) => g.nameEn === "Year 5" && g.isActive);
    const science = year5?.subjects.find((s) => s.nameEn === "Science");
    console.log("\nBritish Y5 Science — textbookMapped:", science?.textbookMapped, "sourceFile:", science?.sourceFile);

    for (const unit of science?.units ?? []) {
      console.log(`\nUnit "${unit.nameEn}" — grounded=${unit.grounded} pages=${unit.sourcePageStart}-${unit.sourcePageEnd} model=${unit.groundingModel}`);
      for (const topic of unit.topics) {
        console.log(`   Topic "${topic.nameEn}" — status=${topic.status} hasTeachingSteps=${topic.hasTeachingSteps} generationSource=${topic.generationSource}`);
      }
    }

    // Sanity check on the historical-generated distinction: find any topic
    // with hasTeachingSteps=true and generationSource=null anywhere, and
    // confirm it's classified HISTORICAL_GENERATED, never NEVER_GENERATED.
    let historicalExampleFound = false;
    for (const c of result.curricula) {
      for (const g of c.grades) {
        for (const s of g.subjects) {
          for (const u of s.units) {
            for (const t of u.topics) {
              if (t.hasTeachingSteps && t.generationSource === null) {
                if (!historicalExampleFound) {
                  console.log(`\nHistorical-generated example: Topic "${t.nameEn}" (${t.id}) — status=${t.status}`);
                  historicalExampleFound = true;
                }
                if (t.status !== "HISTORICAL_GENERATED") {
                  console.error(`MISMATCH: Topic ${t.id} has teachingSteps but generationSource=null and status=${t.status} (expected HISTORICAL_GENERATED)`);
                }
              }
            }
          }
        }
      }
    }
    console.log("\nHistorical-generated example found:", historicalExampleFound);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("VERIFICATION FAILED:", err);
    process.exit(1);
  });
