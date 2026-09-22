/**
 * Grade 1 Arabic pilot, Unit 1 "أسرتي": reviews (supplies the Arabic half
 * of each learning objective), approves, then publishes the two Letter
 * Alef / Letter Baa LessonDraft rows created by
 * grade1-arabic-unit1-generate-drafts.ts. No AI call anywhere in this
 * script — objectiveAr values below are Smartify's own translations of
 * the English objectives already on the draft, not AI output.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { InteractiveLessonModule } from "../interactive-lesson/interactive-lesson.module";
import { LessonPublishService } from "../interactive-lesson/lesson-draft-generator/lesson-publish.service";

const REVIEWER_USER_ID = "cmtz6270z0000u9c5h6ua0y67"; // the one SUPER_ADMIN account

const DRAFTS: Array<{ draftId: string; translations: Array<{ objectiveEn: string; objectiveAr: string }> }> = [
  {
    draftId: "cmu78mw3q000366w7bz4vgl8e", // Letter Alef
    translations: [
      { objectiveEn: "Recognize the shape of the letter Alef through a variety of activities.", objectiveAr: "التعرف على شكل حرف الألف من خلال أنشطة متنوعة." },
      { objectiveEn: "Pronounce the sound of the letter Alef with each short vowel mark and with sukoon.", objectiveAr: "نطق صوت حرف الألف مع كل حركة قصيرة (الفتحة والضمة والكسرة) ومع السكون." },
      { objectiveEn: "Write the letter Alef correctly, following the correct writing-stroke direction.", objectiveAr: "كتابة حرف الألف بشكل صحيح، مع اتباع الاتجاه الصحيح لحركة الكتابة." },
    ],
  },
  {
    draftId: "cmu78n244000766w7udviitqd", // Letter Baa
    translations: [
      { objectiveEn: "Recognize the isolated and connected written forms of the letter Baa.", objectiveAr: "التعرف على الصورة المنفردة والصور المتصلة لحرف الباء عند الكتابة." },
      { objectiveEn: "Pronounce the sound of the letter Baa with each short vowel mark and with sukoon.", objectiveAr: "نطق صوت حرف الباء مع كل حركة قصيرة ومع السكون." },
      { objectiveEn: "Write the letter Baa correctly, following the correct writing-stroke direction.", objectiveAr: "كتابة حرف الباء بشكل صحيح، مع اتباع الاتجاه الصحيح لحركة الكتابة." },
    ],
  },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["warn", "error"] });
  const results: unknown[] = [];
  try {
    const publisher = app.select(InteractiveLessonModule).get(LessonPublishService, { strict: false });
    for (const { draftId, translations } of DRAFTS) {
      await publisher.reviewObjectives(draftId, translations);
      const approved = await publisher.approve(draftId, REVIEWER_USER_ID);
      const published = await publisher.publish(draftId);
      results.push({ draftId, approvedStatus: approved.status, published });
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await app.close();
  }
}

main();
