/**
 * Grade 1 Arabic pilot, Unit 1 "أسرتي": reviews, approves, then publishes
 * the six LessonDraft rows created by
 * grade1-arabic-unit1-generate-drafts-2.ts (Meem, Haa, Jeem, Dal, Khaa,
 * Taa). No AI call anywhere in this script — objectiveAr values below are
 * Smartify's own translations of the English objectives already on each
 * draft, not AI output.
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
    draftId: "cmu78u8zy0003o6zg08hqnmwp", // Letter Meem
    translations: [
      { objectiveEn: "Recognize the isolated and connected written forms of the letter Meem.", objectiveAr: "التعرف على الصورة المنفردة والصور المتصلة لحرف الميم عند الكتابة." },
      { objectiveEn: "Pronounce the sound of the letter Meem with each short vowel mark and with sukoon.", objectiveAr: "نطق صوت حرف الميم مع كل حركة قصيرة ومع السكون." },
      { objectiveEn: "Write the letter Meem correctly, following the correct writing-stroke direction.", objectiveAr: "كتابة حرف الميم بشكل صحيح، مع اتباع الاتجاه الصحيح لحركة الكتابة." },
    ],
  },
  {
    draftId: "cmu78ue5x0007o6zgcjni1pv9", // Letter Haa
    translations: [
      { objectiveEn: "Recognize the isolated and connected written forms of the letter Haa.", objectiveAr: "التعرف على الصورة المنفردة والصور المتصلة لحرف الحاء عند الكتابة." },
      { objectiveEn: "Pronounce the sound of the letter Haa with each short vowel mark and with sukoon.", objectiveAr: "نطق صوت حرف الحاء مع كل حركة قصيرة ومع السكون." },
      { objectiveEn: "Write the letter Haa correctly, following the correct writing-stroke direction.", objectiveAr: "كتابة حرف الحاء بشكل صحيح، مع اتباع الاتجاه الصحيح لحركة الكتابة." },
    ],
  },
  {
    draftId: "cmu78ukzy000bo6zg9dxj1nah", // Letter Jeem
    translations: [
      { objectiveEn: "Recognize the isolated and connected written forms of the letter Jeem.", objectiveAr: "التعرف على الصورة المنفردة والصور المتصلة لحرف الجيم عند الكتابة." },
      { objectiveEn: "Pronounce the sound of the letter Jeem with each short vowel mark and with sukoon.", objectiveAr: "نطق صوت حرف الجيم مع كل حركة قصيرة ومع السكون." },
      { objectiveEn: "Write the letter Jeem correctly, following the correct writing-stroke direction.", objectiveAr: "كتابة حرف الجيم بشكل صحيح، مع اتباع الاتجاه الصحيح لحركة الكتابة." },
    ],
  },
  {
    draftId: "cmu78uqtl000fo6zgohaumedw", // Letter Dal
    translations: [
      { objectiveEn: "Recognize the two written forms of the letter Dal (it never connects forward to the next letter).", objectiveAr: "التعرف على صورتي حرف الدال عند الكتابة (فهو لا يتصل بالحرف التالي له)." },
      { objectiveEn: "Pronounce the sound of the letter Dal with each short vowel mark and with sukoon.", objectiveAr: "نطق صوت حرف الدال مع كل حركة قصيرة ومع السكون." },
      { objectiveEn: "Write the letter Dal correctly, following the correct writing-stroke direction.", objectiveAr: "كتابة حرف الدال بشكل صحيح، مع اتباع الاتجاه الصحيح لحركة الكتابة." },
    ],
  },
  {
    draftId: "cmu78uxaw000jo6zgd88jlsxt", // Letter Khaa
    translations: [
      { objectiveEn: "Recognize the isolated and connected written forms of the letter Khaa.", objectiveAr: "التعرف على الصورة المنفردة والصور المتصلة لحرف الخاء عند الكتابة." },
      { objectiveEn: "Pronounce the sound of the letter Khaa with each short vowel mark and with sukoon.", objectiveAr: "نطق صوت حرف الخاء مع كل حركة قصيرة ومع السكون." },
      { objectiveEn: "Write the letter Khaa correctly, following the correct writing-stroke direction.", objectiveAr: "كتابة حرف الخاء بشكل صحيح، مع اتباع الاتجاه الصحيح لحركة الكتابة." },
    ],
  },
  {
    draftId: "cmu78v0yj000no6zgcykhvtz2", // Letter Taa
    translations: [
      { objectiveEn: "Recognize the isolated and connected written forms of the letter Taa.", objectiveAr: "التعرف على الصورة المنفردة والصور المتصلة لحرف التاء عند الكتابة." },
      { objectiveEn: "Pronounce the sound of the letter Taa with each short vowel mark and with sukoon.", objectiveAr: "نطق صوت حرف التاء مع كل حركة قصيرة ومع السكون." },
      { objectiveEn: "Write the letter Taa correctly, following the correct writing-stroke direction.", objectiveAr: "كتابة حرف التاء بشكل صحيح، مع اتباع الاتجاه الصحيح لحركة الكتابة." },
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
