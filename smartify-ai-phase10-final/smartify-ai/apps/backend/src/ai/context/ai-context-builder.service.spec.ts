import { AIContextBuilderService } from "./ai-context-builder.service";

/**
 * Locks in the copyright-safe guardrails (Phase 5 hardening): curriculum
 * data must be usable only as a topic/objective map, never as a source
 * to quote from, and the tutor must never claim official/Ministry status.
 * This is the ONE place tutor prompt text is defined — these assertions
 * are the closest thing to a regression test for that policy short of a
 * real (costly) model call.
 */
describe("AIContextBuilderService.buildTutorSystemPrompt", () => {
  const service = new AIContextBuilderService();
  const baseCtx = {
    studentFullName: "Kenda",
    age: 10,
    curriculumNameEn: "Egyptian National Curriculum",
    gradeNameEn: "Grade 5",
    subjectNameEn: "Science",
    topicNameEn: "Photosynthesis",
    preferredLang: "en" as const,
  };

  it("instructs the model to use curriculum/topic only as a map, never as a source to quote", () => {
    const prompt = service.buildTutorSystemPrompt(baseCtx);
    expect(prompt).toMatch(/only as a map/i);
    expect(prompt).toMatch(/never.*source.*(quote|retrieve|reproduce)/i);
  });

  it("instructs the model to generate original content and not reproduce or paraphrase textbook passages", () => {
    const prompt = service.buildTutorSystemPrompt(baseCtx);
    expect(prompt).toMatch(/own original explanations, examples, exercises, questions, quizzes, and hints/i);
    expect(prompt).toMatch(/do not reproduce or closely paraphrase/i);
  });

  it("forbids presenting the response as an official textbook excerpt or Ministry-endorsed content", () => {
    const prompt = service.buildTutorSystemPrompt(baseCtx);
    expect(prompt).toMatch(/never present your response as an official textbook excerpt/i);
    expect(prompt).toMatch(/Ministry of Education/i);
  });

  it("still discloses the content is AI-generated, not officially verified", () => {
    const prompt = service.buildTutorSystemPrompt(baseCtx);
    expect(prompt).toMatch(/AI-generated tutoring content, not officially verified curriculum material/i);
  });

  it("applies the same originality rules for Arabic-language sessions", () => {
    const prompt = service.buildTutorSystemPrompt({ ...baseCtx, preferredLang: "ar" });
    expect(prompt).toMatch(/only as a map/i);
    expect(prompt).toMatch(/Ministry of Education/i);
    expect(prompt).toMatch(/Egyptian colloquial Arabic/i);
  });

  describe("language matching (regression: ar-preferred students getting Arabic replies to English questions)", () => {
    // Root cause: an earlier version appended an UNCONDITIONAL "always use
    // Egyptian Arabic" tone line right after the "respond in English if
    // the student writes in English" exception for ar-preferred students —
    // the two instructions contradicted each other and the model defaulted
    // to Arabic regardless of what language the student actually wrote in.
    it("tells an ar-preferred session to switch to English when the student writes in English, with language-matching stated as taking priority", () => {
      const prompt = service.buildTutorSystemPrompt({ ...baseCtx, preferredLang: "ar" });
      expect(prompt).toMatch(/respond in english instead/i);
      expect(prompt).toMatch(/always match the language the student actually wrote in, above any other preference/i);
    });

    it("tells an en-preferred session to switch to Arabic when the student writes in Arabic, with language-matching stated as taking priority", () => {
      const prompt = service.buildTutorSystemPrompt({ ...baseCtx, preferredLang: "en" });
      expect(prompt).toMatch(/respond in arabic instead/i);
      expect(prompt).toMatch(/always match the language the student actually wrote in, above any other preference/i);
    });

    it("never states the Egyptian-Arabic tone as an unconditional rule detached from the language-match instruction", () => {
      // The old bug lived in a separate, unconditional line. Assert there is
      // now exactly one Arabic-tone mention, and it lives inside the same
      // conditional instruction as the language switch.
      const prompt = service.buildTutorSystemPrompt({ ...baseCtx, preferredLang: "ar" });
      const arabicToneMentions = prompt.match(/Egyptian colloquial Arabic/gi) ?? [];
      expect(arabicToneMentions).toHaveLength(1);
      expect(prompt).toMatch(/respond in english instead[^\n]*When responding in Arabic, use gentle Egyptian colloquial Arabic/i);
    });
  });

  describe("conversation context anchoring (regression: reusing a previous answer's headings for an unrelated question)", () => {
    // Root cause reproduced manually: after answering "what are the
    // different types of soil?" with Clay/Sandy/Silt/Loamy headings, an
    // unrelated follow-up about flowers came back organized under those
    // SAME soil headings. The fix is a prompt instruction, not a code
    // change to which messages are sent — these assertions are the
    // deterministic part of the fix (the instruction exists and says the
    // right thing); what the model actually does with it is a real-call
    // concern covered separately by manual/live verification, not a unit
    // test, per "do not create brittle tests that require exact OpenAI prose".
    it("instructs the model to treat the CURRENT message as the primary authority for intent and structure", () => {
      const prompt = service.buildTutorSystemPrompt(baseCtx);
      expect(prompt).toMatch(/CURRENT question/);
      expect(prompt).toMatch(/primary authority for what subject\/topic is being asked about, and for how the answer should be organized/i);
    });

    it("instructs the model NOT to automatically reuse headings/categories/structure from a previous response", () => {
      const prompt = service.buildTutorSystemPrompt(baseCtx);
      expect(prompt).toMatch(/do not automatically reuse headings, categories, list structures, examples, or answer organization/i);
    });

    it("still instructs the model to use history when the current message genuinely refers back to it", () => {
      const prompt = service.buildTutorSystemPrompt(baseCtx);
      expect(prompt).toMatch(/use the conversation history only when it is relevant to understanding the current message/i);
      expect(prompt).toMatch(/explicitly refers back to something already discussed/i);
    });

    it("applies the same context-anchoring instruction regardless of locale", () => {
      const enPrompt = service.buildTutorSystemPrompt({ ...baseCtx, preferredLang: "en" });
      const arPrompt = service.buildTutorSystemPrompt({ ...baseCtx, preferredLang: "ar" });
      for (const prompt of [enPrompt, arPrompt]) {
        expect(prompt).toMatch(/do not automatically reuse headings/i);
      }
    });
  });

  describe("formatting (regression: LaTeX notation like \\frac{1}{4} rendering as literal backslashes, both on-screen and in TTS)", () => {
    it("instructs the model never to use LaTeX or math markup", () => {
      const prompt = service.buildTutorSystemPrompt(baseCtx);
      expect(prompt).toMatch(/never use latex or other math markup/i);
    });

    it("instructs the model to express math in plain words or simple notation instead", () => {
      const prompt = service.buildTutorSystemPrompt(baseCtx);
      expect(prompt).toMatch(/write math in plain words or simple inline notation/i);
    });

    it("applies the same formatting instruction regardless of locale", () => {
      const enPrompt = service.buildTutorSystemPrompt({ ...baseCtx, preferredLang: "en" });
      const arPrompt = service.buildTutorSystemPrompt({ ...baseCtx, preferredLang: "ar" });
      for (const prompt of [enPrompt, arPrompt]) {
        expect(prompt).toMatch(/never use latex or other math markup/i);
      }
    });
  });
});
