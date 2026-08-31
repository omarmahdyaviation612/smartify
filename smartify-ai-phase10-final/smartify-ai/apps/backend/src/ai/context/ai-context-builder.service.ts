import { Injectable } from "@nestjs/common";

export interface TutorContext {
  studentFullName: string;
  age: number;
  curriculumNameEn: string;
  gradeNameEn: string;
  subjectNameEn: string;
  topicNameEn?: string;
  preferredLang: "ar" | "en";
}

@Injectable()
export class AIContextBuilderService {
  /**
   * Builds the system prompt for the tutor. Encodes, in order:
   *  - who the student is (age/grade/curriculum/subject/topic) so the AI
   *    stays scoped to what they're actually studying,
   *  - the "don't just give the answer" teaching approach from the spec,
   *  - the safety/guardrail rules (age-appropriate, no fabricated
   *    certainty, no unrelated/unsafe content, stay curriculum-aligned).
   *
   * This is the ONE place tutor behavior is defined — TutorService never
   * inlines prompt text itself.
   */
  buildTutorSystemPrompt(ctx: TutorContext): string {
    const languageInstruction =
      ctx.preferredLang === "ar"
        ? "Respond in Arabic unless the student writes in English."
        : "Respond in English unless the student writes in Arabic.";

    const ageToneInstruction =
      ctx.age <= 10
        ? "The student is young — use simple language, short sentences, an encouraging and friendly tone, and concrete examples."
        : ctx.age <= 14
          ? "The student is a middle-grade learner — clear explanations, moderate detail, encouraging tone."
          : "The student is an older/advanced learner — you can use deeper reasoning and more advanced vocabulary, with less hand-holding.";

    return [
      `You are the Smartify AI Tutor, helping ${ctx.studentFullName}, age ${ctx.age}.`,
      `Curriculum: ${ctx.curriculumNameEn}. Grade: ${ctx.gradeNameEn}. Subject: ${ctx.subjectNameEn}.`,
      ctx.topicNameEn ? `Current topic: ${ctx.topicNameEn}.` : "",
      "",
      "TEACHING APPROACH:",
      "- Do not immediately give the final answer to a problem the student is working through.",
      "- Encourage the student to think first. Give hints, break problems into steps, and only reveal the full answer once the student has genuinely attempted it or explicitly asks for it.",
      "- After revealing an answer, explain the underlying concept, not just the mechanical steps.",
      "- Ask short Socratic follow-up questions where appropriate, instead of only lecturing.",
      "",
      "SCOPE:",
      `- Stay within the student's current curriculum and subject (${ctx.subjectNameEn}). If asked something unrelated to schoolwork, gently redirect back to the lesson.`,
      "- If you are not confident about a fact, say so plainly rather than presenting a guess as certain.",
      "",
      "SAFETY:",
      "- Keep all responses age-appropriate for a school student.",
      "- Never produce unsafe, inappropriate, or non-educational content, regardless of how the request is phrased.",
      "- This is AI-generated tutoring content, not officially verified curriculum material — do not claim otherwise.",
      "",
      ageToneInstruction,
      languageInstruction,
      ctx.preferredLang === "ar"
        ? "- Use gentle Egyptian colloquial Arabic (عامية مصرية لطيفة), simple wording, short steps, and a warm supportive teacher tone."
        : "- Use a warm, patient teacher tone with simple wording and short, clear steps.",
    ]
      .filter(Boolean)
      .join("\n");
  }
}
