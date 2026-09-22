/**
 * One-off verification script (2026-09-19) — confirms the launch-speed
 * lazy-generation fix in OnboardingService.getDiagnosticQuestions()
 * actually produces real questions for a British Year 3 English student
 * whose subject had zero non-placeholder Questions before this fix.
 * Not part of any pipeline; safe to delete after use.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { OnboardingService } from "../onboarding/onboarding.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const service = app.get(OnboardingService);
  const questions = await service.getDiagnosticQuestions("cmu8g1qjf0000c0j6dr1ye5fn");
  console.log("QUESTION COUNT:", questions.length);
  console.log(JSON.stringify(questions.slice(0, 2), null, 2));
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
