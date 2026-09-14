import { DEFAULT_TEACHING_STRATEGY, decideStrategySwitch, getCurrentStrategy, getStrategyHistory, strategyGuidance } from "./teaching-strategy.util";
import type { StepResult } from "./interactive-lesson.types";

describe("teaching-strategy.util", () => {
  it("resolves the default strategy (CONCRETE_OBJECTS) when no step has recorded one", () => {
    expect(getCurrentStrategy([])).toBe("CONCRETE_OBJECTS");
    expect(DEFAULT_TEACHING_STRATEGY).toBe("CONCRETE_OBJECTS");
  });

  it("resolves the latest recorded strategy across step results", () => {
    const results: StepResult[] = [
      { stepId: "s1", delivered: true, attempts: 0, correct: null, hintGiven: false, strategy: "CONCRETE_OBJECTS" },
      { stepId: "s2", delivered: true, attempts: 0, correct: null, hintGiven: false, strategy: "CONCRETE_OBJECTS" },
      { stepId: "s3", delivered: true, attempts: 2, correct: false, hintGiven: true, strategy: "NUMBER_LINE" },
    ];
    expect(getCurrentStrategy(results)).toBe("NUMBER_LINE");
  });

  it("does not switch on a correct answer", () => {
    const decision = decideStrategySwitch({
      stepId: "s3",
      attemptsSoFar: 1,
      isMeaningfulWrongAttempt: false,
      currentStrategy: "CONCRETE_OBJECTS",
      alreadySwitchedAtThisStep: false,
    });
    expect(decision).toBeNull();
  });

  it("does not switch on the first meaningful wrong attempt", () => {
    const decision = decideStrategySwitch({
      stepId: "s3",
      attemptsSoFar: 1,
      isMeaningfulWrongAttempt: true,
      currentStrategy: "CONCRETE_OBJECTS",
      alreadySwitchedAtThisStep: false,
    });
    expect(decision).toBeNull();
  });

  it("switches to NUMBER_LINE on the second meaningful wrong attempt", () => {
    const decision = decideStrategySwitch({
      stepId: "s3",
      attemptsSoFar: 2,
      isMeaningfulWrongAttempt: true,
      currentStrategy: "CONCRETE_OBJECTS",
      alreadySwitchedAtThisStep: false,
    });
    expect(decision?.strategy).toBe("NUMBER_LINE");
    expect(decision?.record).toMatchObject({ strategy: "NUMBER_LINE", atStepId: "s3", reason: "2_meaningful_incorrect_attempts" });
    expect(typeof decision?.record.switchedAt).toBe("string");
  });

  it("does not switch again once already switched at this step", () => {
    const decision = decideStrategySwitch({
      stepId: "s3",
      attemptsSoFar: 3,
      isMeaningfulWrongAttempt: true,
      currentStrategy: "NUMBER_LINE",
      alreadySwitchedAtThisStep: true,
    });
    expect(decision).toBeNull();
  });

  it("does not switch when no further strategy exists after the current one (NUMBER_LINE has no defined successor in V1)", () => {
    const decision = decideStrategySwitch({
      stepId: "s3",
      attemptsSoFar: 2,
      isMeaningfulWrongAttempt: true,
      currentStrategy: "NUMBER_LINE",
      alreadySwitchedAtThisStep: false,
    });
    expect(decision).toBeNull();
  });

  it("getStrategyHistory returns the latest recorded history array", () => {
    const results: StepResult[] = [
      { stepId: "s3", delivered: true, attempts: 2, correct: false, hintGiven: true, strategy: "NUMBER_LINE", strategyHistory: [{ strategy: "NUMBER_LINE", reason: "2_meaningful_incorrect_attempts", atStepId: "s3", switchedAt: "2026-01-01T00:00:00.000Z" }] },
    ];
    expect(getStrategyHistory(results)).toHaveLength(1);
    expect(getStrategyHistory([])).toEqual([]);
  });

  it("produces materially different guidance text per strategy", () => {
    const concrete = strategyGuidance("CONCRETE_OBJECTS");
    const numberLine = strategyGuidance("NUMBER_LINE");
    expect(concrete).toMatch(/objects|apples|toys|blocks/i);
    expect(numberLine).toMatch(/number line/i);
    expect(concrete).not.toBe(numberLine);
  });

  describe("Phase 8.1: NUMBER_LINE prompt adherence (regression — live pilot showed the model kept using apples after switching)", () => {
    // Root cause: the switch was recorded correctly in stepResultsJson, but
    // the CHECK step's own stored objective hardcodes a concrete-object
    // example ("If you have 4 apples and add zero more apples..."), and the
    // old NUMBER_LINE guidance only said "don't repeat a previous
    // explanation" — too weak/abstract to outweigh a concrete, specific
    // example sitting right next to it in the same prompt. The fix is a
    // stronger, explicit guidance string; this locks in its required shape.
    it("explicitly bans apples/toys/blocks/other countable-object examples", () => {
      const guidance = strategyGuidance("NUMBER_LINE");
      expect(guidance).toMatch(/do not use/i);
      expect(guidance).toMatch(/apples/i);
      expect(guidance).toMatch(/toys/i);
      expect(guidance).toMatch(/blocks/i);
    });

    it("requires number-line position/movement reasoning", () => {
      const guidance = strategyGuidance("NUMBER_LINE");
      expect(guidance).toMatch(/number line/i);
      expect(guidance).toMatch(/position|movement|move|step/i);
    });

    it("requires zero to be explained as zero movement/zero steps", () => {
      const guidance = strategyGuidance("NUMBER_LINE");
      expect(guidance).toMatch(/zero (movement|steps)/i);
    });

    it("instructs restating the objective's own example under the new representation, rather than just avoiding it", () => {
      const guidance = strategyGuidance("NUMBER_LINE");
      expect(guidance).toMatch(/objective.*example.*above|restate.*question|numbers/i);
    });

    it("does not hard-code the model's final wording (gives an illustrative shape, not a verbatim script)", () => {
      const guidance = strategyGuidance("NUMBER_LINE");
      expect(guidance).toMatch(/your own (original )?wording|do not copy verbatim/i);
    });

    it("CONCRETE_OBJECTS guidance is unchanged by the NUMBER_LINE fix", () => {
      expect(strategyGuidance("CONCRETE_OBJECTS")).toBe(
        "Use familiar countable objects (like apples, toys, or blocks) to explain and question the concept. Keep language appropriate for an Egyptian Grade 1 child. Do not switch representation unless instructed.",
      );
    });
  });
});
