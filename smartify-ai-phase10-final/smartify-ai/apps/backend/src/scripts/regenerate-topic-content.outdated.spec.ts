import { isLessonPromptOutdated, parseArgs } from "./regenerate-topic-content";
import { AUTO_LESSON_GENERATION_PROMPT_VERSION } from "../interactive-lesson/lesson-draft-generator/lesson-prompt-version.const";

describe("regenerate-topic-content — outdated lessons (2026-10-10)", () => {
  it("treats AUTO-generated steps from an older or unknown prompt version as outdated", () => {
    const auto = { teachingStepsJson: [{}], generationSource: "TEXTBOOK_GROUNDED" };
    expect(isLessonPromptOutdated({ ...auto, generationPromptVersion: "auto-lesson-v1" })).toBe(true);
    expect(isLessonPromptOutdated({ ...auto, generationPromptVersion: null })).toBe(true);
    expect(isLessonPromptOutdated({ ...auto, generationPromptVersion: AUTO_LESSON_GENERATION_PROMPT_VERSION })).toBe(false);
    expect(isLessonPromptOutdated({ teachingStepsJson: null, generationSource: "TEXTBOOK_GROUNDED", generationPromptVersion: null })).toBe(false);
  });

  it("never treats a human-reviewed lesson (no generationSource) as outdated", () => {
    expect(isLessonPromptOutdated({ teachingStepsJson: [{}], generationSource: null, generationPromptVersion: null })).toBe(false);
  });

  it("parses --list-outdated as a read-only mode that takes no other arguments", () => {
    expect(parseArgs(["--list-outdated"])).toMatchObject({ listOutdated: true, apply: false });
    expect(() => parseArgs(["--list-outdated", "--apply"])).toThrow();
  });

  it("still requires --topicIds for regeneration", () => {
    expect(() => parseArgs(["--apply"])).toThrow("--topicIds must be given exactly once");
  });
});
