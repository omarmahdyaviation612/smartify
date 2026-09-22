/**
 * Admin CLI: uploads a real textbook PDF to curriculum source storage and
 * records the reference on Subject.sourceFile. Thin wrapper — the real
 * logic lives in CurriculumSourceUploadService (2026-09-20 refactor), so
 * this script and the Admin HTTP textbook-upload endpoint share the exact
 * same implementation, never two.
 *
 * Usage (via the root `curriculum:upload` script — see root package.json):
 *   pnpm curriculum:upload --subjectId=<id> --pdf="<local path>" [--key=<object key>] [--replace]
 *
 * `--key` overrides the auto-generated object key (curriculum/grade/subject/
 * filename, sanitized). `--replace` is required to overwrite an existing
 * Subject.sourceFile — without it, the command refuses and exits non-zero
 * rather than silently clobbering a mapping some Units may already be
 * grounded against (see the printed warning when replacing). `--replace`
 * remains CLI-only — the Admin HTTP endpoint never exposes it (see
 * CurriculumSourceUploadService.uploadFirstTime()).
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { CurriculumSourceUploadService } from "../interactive-lesson/unit-grounding/storage/curriculum-source-upload.service";

export function parseArgs(argv: string[]): { subjectId: string; pdf: string; key?: string; replace: boolean } {
  const flags = new Map<string, string>();
  let replace = false;
  for (const arg of argv) {
    if (arg === "--replace") {
      replace = true;
      continue;
    }
    const match = arg.match(/^--([a-zA-Z]+)=(.*)$/);
    if (match) flags.set(match[1], match[2]);
  }

  const subjectId = flags.get("subjectId");
  const pdf = flags.get("pdf");
  if (!subjectId || !pdf) {
    throw new Error('Missing required arguments. Usage: pnpm curriculum:upload --subjectId=<id> --pdf="<local path>" [--key=<object key>] [--replace]');
  }
  return { subjectId, pdf, key: flags.get("key"), replace };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    const service = app.get(CurriculumSourceUploadService);
    const result = await service.upload({ subjectId: args.subjectId, pdfPath: args.pdf, key: args.key, replace: args.replace });
    console.log(`CURRICULUM SOURCE UPLOADED: Subject ${result.subjectId} ("${result.subjectNameEn}") sourceFile="${result.sourceFile}"`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("CURRICULUM SOURCE UPLOAD FAILED:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
