/**
 * Grade 1 Arabic pilot, Unit 2 "حيواناتي": reviews, approves, then
 * publishes the seven LessonDraft rows created by
 * grade1-arabic-unit2-generate-drafts.ts. No AI call anywhere in this
 * script — objectiveAr values below are Smartify's own translations of
 * the English objectives already on each draft, not AI output.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { InteractiveLessonModule } from "../interactive-lesson/interactive-lesson.module";
import { LessonPublishService } from "../interactive-lesson/lesson-draft-generator/lesson-publish.service";

const REVIEWER_USER_ID = "cmtz6270z0000u9c5h6ua0y67";

function stdTranslations(letterEn: string, letterAr: string) {
  return [
    { objectiveEn: `Recognize the isolated and connected written forms of the letter ${letterEn}.`, objectiveAr: `التعرف على الصورة المنفردة والصور المتصلة لحرف ${letterAr} عند الكتابة.` },
    { objectiveEn: `Pronounce the sound of the letter ${letterEn} with each short vowel mark and with sukoon.`, objectiveAr: `نطق صوت حرف ${letterAr} مع كل حركة قصيرة ومع السكون.` },
    { objectiveEn: `Use the letter ${letterEn} to complete or build a simple word.`, objectiveAr: `استخدام حرف ${letterAr} لإكمال أو تكوين كلمة بسيطة.` },
    { objectiveEn: `Recognize the sound of the letter ${letterEn} within a spoken sentence or story.`, objectiveAr: `تمييز صوت حرف ${letterAr} عند سماعه في جملة أو قصة منطوقة.` },
  ];
}

const DRAFTS: Array<{ draftId: string; translations: Array<{ objectiveEn: string; objectiveAr: string }> }> = [
  { draftId: "cmu798k1h000312nheskm1dpy", translations: stdTranslations("Lam", "اللام") },
  { draftId: "cmu798njp000712nhpuc29nla", translations: stdTranslations("Seen", "السين") },
  { draftId: "cmu798sr5000b12nhc595my94", translations: stdTranslations("Noon", "النون") },
  {
    draftId: "cmu7991sc000f12nh50fg718x",
    translations: [
      { objectiveEn: "Recognize the two written forms of the letter Raa (it never connects forward to the next letter).", objectiveAr: "التعرف على صورتي حرف الراء عند الكتابة (فهو لا يتصل بالحرف التالي له)." },
      { objectiveEn: "Pronounce the sound of the letter Raa with each short vowel mark and with sukoon.", objectiveAr: "نطق صوت حرف الراء مع كل حركة قصيرة ومع السكون." },
      { objectiveEn: "Use the letter Raa to complete or build a simple word.", objectiveAr: "استخدام حرف الراء لإكمال أو تكوين كلمة بسيطة." },
      { objectiveEn: "Recognize the sound of the letter Raa within a spoken sentence or story.", objectiveAr: "تمييز صوت حرف الراء عند سماعه في جملة أو قصة منطوقة." },
    ],
  },
  { draftId: "cmu7996qg000j12nh2rgc0cn6", translations: stdTranslations("Faa", "الفاء") },
  { draftId: "cmu799dbq000n12nh39vnyjge", translations: stdTranslations("Kaf", "الكاف") },
  { draftId: "cmu799kd6000r12nhgqwlv6x8", translations: stdTranslations("Qaf", "القاف") },
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
