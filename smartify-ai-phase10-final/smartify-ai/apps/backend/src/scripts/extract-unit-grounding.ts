/**
 * Offline unit-grounding extraction — a manual/deliberate alternative to
 * production's own lazy-grounding path (2026-09-19:
 * UnitGroundingService.ensureUnitGrounded(), triggered automatically by a
 * real student's first request to a Topic in an ungrounded Unit — see
 * that method's doc comment). Both paths call the exact same
 * extractUnitGrounding() core logic; this script exists for admin/QA use
 * (pre-warming a Unit deliberately, debugging, re-extracting with
 * overrides) — it is never required for production correctness.
 *
 * Usage (via the root `grounding:extract` script — see root package.json):
 *   pnpm grounding:extract --unitId=<id> [--pdf=<override filename>] [--pages=<start>-<end>]
 *
 * `--pdf`/`--pages` override the Unit's own Subject.sourceFile /
 * Unit.sourcePageStart-sourcePageEnd — use them for a Unit that has no
 * backfilled provenance yet, or to re-extract a specific page range.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { UnitGroundingService } from "../interactive-lesson/unit-grounding/unit-grounding.service";
import { CONTENT_AUTHORING_ACTOR_ID } from "../ai/content-authoring-actor.const";

function parseArgs(argv: string[]): { unitId: string; pdf?: string; pages?: [number, number] } {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = arg.match(/^--([a-zA-Z]+)=(.*)$/);
    if (match) flags.set(match[1], match[2]);
  }

  const unitId = flags.get("unitId");
  if (!unitId) {
    throw new Error('Missing required --unitId=<id>. Usage: pnpm grounding:extract --unitId=<id> [--pdf=<filename>] [--pages=<start>-<end>]');
  }

  let pages: [number, number] | undefined;
  const pagesRaw = flags.get("pages");
  if (pagesRaw) {
    const match = pagesRaw.match(/^(\d+)-(\d+)$/);
    if (!match) throw new Error(`Invalid --pages value "${pagesRaw}" — expected <start>-<end>, e.g. --pages=8-17.`);
    pages = [Number(match[1]), Number(match[2])];
  }

  return { unitId, pdf: flags.get("pdf"), pages };
}

async function main() {
  const { unitId, pdf, pages } = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    const service = app.get(UnitGroundingService);
    const result = await service.extractUnitGrounding(unitId, { pdfOverride: pdf, pageRangeOverride: pages }, CONTENT_AUTHORING_ACTOR_ID);
    console.log("GROUNDING EXTRACTION SUCCEEDED:", JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("GROUNDING EXTRACTION FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
