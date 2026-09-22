/**
 * One-off manual verification (2026-09-20) — Admin textbook upload, Step 1.
 * Exercises the exact same AdminCurriculumService.uploadSubjectTextbook()
 * method the new POST /admin/curriculum/subjects/:id/textbook endpoint
 * calls, reading a real file into a Buffer to simulate exactly what
 * Multer hands the controller — against the REAL database and the REAL
 * private R2 bucket (no HTTP/Clerk layer needed for this, same
 * established verification style used throughout this project). Subject:
 * "Arabic Language" (Grade 1, Egyptian National) — real, active,
 * sourceFile was null, with an unambiguous single matching real PDF on
 * disk. Read-only elsewhere: does not touch any Unit/Topic/Lesson row.
 * Safe to delete after use.
 */
import "reflect-metadata";
import "dotenv/config";
import * as fs from "fs";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { AdminCurriculumService } from "../admin/curriculum/admin-curriculum.service";

const SUBJECT_ID = "cmu78g0k300015tapkf9wor13"; // Arabic Language, Grade 1, Egyptian National
const PDF_PATH = "D:/samrtify website/curriculum-sources/egypt moe/grade 1/Arabic_language_prim1_t1.pdf";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    const prisma = app.get(PrismaService);
    const service = app.get(AdminCurriculumService);

    const before = await prisma.client.subject.findUnique({
      where: { id: SUBJECT_ID },
      include: { units: { include: { topics: { select: { id: true, teachingStepsJson: true } } } } },
    });
    const aiUsageBefore = await prisma.client.aIUsage.count();
    console.log("BEFORE — sourceFile:", before?.sourceFile);

    const buffer = fs.readFileSync(PDF_PATH);
    const result = await service.uploadSubjectTextbook(SUBJECT_ID, { originalname: "Arabic_language_prim1_t1.pdf", buffer });
    console.log("UPLOAD RESULT:", JSON.stringify(result, null, 2));

    const after = await prisma.client.subject.findUnique({
      where: { id: SUBJECT_ID },
      include: { units: { include: { topics: { select: { id: true, teachingStepsJson: true } } } } },
    });
    const aiUsageAfter = await prisma.client.aIUsage.count();

    console.log("AFTER — sourceFile:", after?.sourceFile);
    console.log("AIUsage rows before/after:", aiUsageBefore, "/", aiUsageAfter, "(must be equal — zero OpenAI calls)");

    for (let i = 0; i < after!.units.length; i++) {
      const u = after!.units[i];
      const ub = before!.units[i];
      console.log(
        `Unit "${u.nameEn}": grounded before=${ub.groundingNotesJson != null} after=${u.groundingNotesJson != null} | topics with steps before=${ub.topics.filter((t) => t.teachingStepsJson != null).length} after=${u.topics.filter((t) => t.teachingStepsJson != null).length}`,
      );
    }
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
