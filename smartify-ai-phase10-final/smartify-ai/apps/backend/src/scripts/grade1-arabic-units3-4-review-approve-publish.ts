/**
 * Grade 1 Arabic pilot, Units 3-4: reviews, approves, then publishes the
 * thirteen LessonDraft rows created by
 * grade1-arabic-units3-4-generate-drafts.ts. No AI call anywhere in this
 * script — objectiveAr values are Smartify's own translations of the
 * English objectives already on each draft, not AI output.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { InteractiveLessonModule } from "../interactive-lesson/interactive-lesson.module";
import { LessonPublishService } from "../interactive-lesson/lesson-draft-generator/lesson-publish.service";

const REVIEWER_USER_ID = "cmtz6270z0000u9c5h6ua0y67";

function connectingTranslations(letterEn: string, letterAr: string) {
  return [
    { objectiveEn: `Recognize the isolated and connected written forms of the letter ${letterEn}.`, objectiveAr: `التعرف على الصورة المنفردة والصور المتصلة لحرف ${letterAr} عند الكتابة.` },
    { objectiveEn: `Pronounce the sound of the letter ${letterEn} with each short vowel mark and with sukoon.`, objectiveAr: `نطق صوت حرف ${letterAr} مع كل حركة قصيرة ومع السكون.` },
    { objectiveEn: `Use the letter ${letterEn} to complete or build a simple word.`, objectiveAr: `استخدام حرف ${letterAr} لإكمال أو تكوين كلمة بسيطة.` },
    { objectiveEn: `Recognize the sound of the letter ${letterEn} within a spoken sentence or story.`, objectiveAr: `تمييز صوت حرف ${letterAr} عند سماعه في جملة أو قصة منطوقة.` },
  ];
}

function nonConnectingTranslations(letterEn: string, letterAr: string) {
  return [
    { objectiveEn: `Recognize the two written forms of the letter ${letterEn} (it never connects forward to the next letter).`, objectiveAr: `التعرف على صورتي حرف ${letterAr} عند الكتابة (فهو لا يتصل بالحرف التالي له).` },
    { objectiveEn: `Pronounce the sound of the letter ${letterEn} with each short vowel mark and with sukoon.`, objectiveAr: `نطق صوت حرف ${letterAr} مع كل حركة قصيرة ومع السكون.` },
    { objectiveEn: `Use the letter ${letterEn} to complete or build a simple word.`, objectiveAr: `استخدام حرف ${letterAr} لإكمال أو تكوين كلمة بسيطة.` },
    { objectiveEn: `Recognize the sound of the letter ${letterEn} within a spoken sentence or story.`, objectiveAr: `تمييز صوت حرف ${letterAr} عند سماعه في جملة أو قصة منطوقة.` },
  ];
}

const DRAFTS: Array<{ draftId: string; translations: Array<{ objectiveEn: string; objectiveAr: string }> }> = [
  { draftId: "cmu79up530003w2de6qfm64cd", translations: connectingTranslations("Yaa", "الياء") },
  { draftId: "cmu79utzh0007w2de4up0c6sn", translations: connectingTranslations("Ain", "العين") },
  { draftId: "cmu79uyof000bw2derb5ta5c6", translations: connectingTranslations("Sheen", "الشين") },
  { draftId: "cmu79v372000fw2ded7e7g42x", translations: nonConnectingTranslations("Waw", "الواو") },
  { draftId: "cmu79vamo000jw2der4qkmg5n", translations: connectingTranslations("Ha", "الهاء") },
  { draftId: "cmu79venx000nw2de76g4l0j5", translations: nonConnectingTranslations("Dhal", "الذال") },
  { draftId: "cmu79vjmk000rw2depmb7vc46", translations: connectingTranslations("Dhaa", "الظاء") },
  { draftId: "cmu79vqct000vw2deiudci6f4", translations: nonConnectingTranslations("Zay", "الزاي") },
  { draftId: "cmu79w0wf000zw2demrrw5ujm", translations: connectingTranslations("Emphatic Ta", "الطاء") },
  { draftId: "cmu79w5rz0013w2deuibsikyg", translations: connectingTranslations("Sad", "الصاد") },
  { draftId: "cmu79walx0017w2de6u0juhml", translations: connectingTranslations("Dad", "الضاد") },
  { draftId: "cmu79wrhg001dw2dedvio2orx", translations: connectingTranslations("Thaa", "الثاء") },
  { draftId: "cmu79wvmt001hw2denmwkw90f", translations: connectingTranslations("Ghain", "الغين") },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["warn", "error"] });
  const results: unknown[] = [];
  try {
    const publisher = app.select(InteractiveLessonModule).get(LessonPublishService, { strict: false });
    for (const { draftId, translations } of DRAFTS) {
      try {
        await publisher.reviewObjectives(draftId, translations);
        const approved = await publisher.approve(draftId, REVIEWER_USER_ID);
        const published = await publisher.publish(draftId);
        results.push({ draftId, approvedStatus: approved.status, published });
      } catch (err) {
        results.push({ draftId, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await app.close();
  }
}

main();
