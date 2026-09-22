import { deriveTopicStatus } from "./curriculum-status.util";

/**
 * The curriculum/admin audit found that generationSource is only ever
 * written by the new (2026-09-19) autoPublishIntoTopic() lazy pipeline —
 * the older, human-reviewed LessonPublishService.publish() pipeline
 * (41 real, currently-live published Topics as of the audit) leaves it
 * NULL even though teachingStepsJson is set. These tests lock in that
 * exactly this combination must read as "historical", never "never
 * generated".
 */
describe("deriveTopicStatus", () => {
  it("returns NEVER_GENERATED when teachingStepsJson does not exist, regardless of generationSource", () => {
    expect(deriveTopicStatus(false, null)).toBe("NEVER_GENERATED");
    expect(deriveTopicStatus(false, "TEXTBOOK_GROUNDED")).toBe("NEVER_GENERATED");
  });

  it("returns TEXTBOOK_GROUNDED when steps exist and generationSource is TEXTBOOK_GROUNDED", () => {
    expect(deriveTopicStatus(true, "TEXTBOOK_GROUNDED")).toBe("TEXTBOOK_GROUNDED");
  });

  it("returns LEGACY_TITLE_ONLY when steps exist and generationSource is LEGACY_TITLE_ONLY", () => {
    expect(deriveTopicStatus(true, "LEGACY_TITLE_ONLY")).toBe("LEGACY_TITLE_ONLY");
  });

  it("returns HISTORICAL_GENERATED — NOT NEVER_GENERATED — when steps exist but generationSource is null (the old pre-2026-09-19 publish() pipeline)", () => {
    expect(deriveTopicStatus(true, null)).toBe("HISTORICAL_GENERATED");
    expect(deriveTopicStatus(true, null)).not.toBe("NEVER_GENERATED");
  });

  it("falls back to HISTORICAL_GENERATED for steps existing with any other unrecognized generationSource value", () => {
    expect(deriveTopicStatus(true, "SOME_FUTURE_VALUE")).toBe("HISTORICAL_GENERATED");
  });
});
