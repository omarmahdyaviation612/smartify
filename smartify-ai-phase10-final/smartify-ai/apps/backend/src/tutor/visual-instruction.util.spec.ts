import { deriveMathVisualWithContext, deriveRequestedMathVisual, parseTutorVisual, validateVisualInstruction } from "./visual-instruction.util";

describe("deterministic visual instructions", () => {
  it("accepts exact multiplication groups", () => {
    expect(validateVisualInstruction({ kind: "MULTIPLICATION_GROUPS", groups: 4, itemsPerGroup: 3, item: "apple", altText: "Four groups" })).toMatchObject({ groups: 4, itemsPerGroup: 3 });
  });
  it("rejects inconsistent fractions and bar totals", () => {
    expect(validateVisualInstruction({ kind: "FRACTION_BAR", numerator: 3, denominator: 4, segments: ["filled"], altText: "bad" })).toBeNull();
    expect(validateVisualInstruction({ kind: "BAR_MODEL", bars: [{ value: 3 }, { value: 4 }], total: 8, altText: "bad" })).toBeNull();
  });
  it("strips and validates the optional marker without requiring another AI call", () => {
    const result = parseTutorVisual('Use equal groups.\n<!--SMARTIFY_VISUAL {"kind":"MULTIPLICATION_GROUPS","groups":4,"itemsPerGroup":3,"item":"apple","altText":"Four groups"} -->');
    expect(result.text).toBe("Use equal groups.");
    expect(result.visual?.kind).toBe("MULTIPLICATION_GROUPS");
  });
  it.each([
    ["invalid JSON", "Reply. <!--SMARTIFY_VISUAL {bad} -->"],
    ["truncated JSON", "Reply. <!--SMARTIFY_VISUAL {\"kind\":\"NUMBER_LINE\" -->"],
    ["code fence", "Reply. ```json <!--SMARTIFY_VISUAL {bad} --> ```"],
    ["trailing text", "Reply. <!--SMARTIFY_VISUAL {bad} --> Thanks."],
    ["multiple markers", "Reply. <!--SMARTIFY_VISUAL {bad} --><!--SMARTIFY_VISUAL {\"kind\":\"NUMBER_LINE\",\"min\":0,\"max\":5,\"marks\":[0,5],\"altText\":\"A line\"} -->"],
    ["unsupported kind", "Reply. <!--SMARTIFY_VISUAL {\"kind\":\"HTML\",\"altText\":\"x\"} -->"],
    ["malicious payload", "Reply. <!--SMARTIFY_VISUAL {\"kind\":\"NUMBER_LINE\",\"min\":0,\"max\":5,\"marks\":[0,5],\"altText\":\"<svg onload=alert(1)>\"} -->"],
  ])("strips %s markers and preserves natural language", (_label, input) => {
    const result = parseTutorVisual(input);
    expect(result.text).toContain("Reply.");
    expect(result.text).not.toMatch(/SMARTIFY_VISUAL|<svg|alert|```/i);
  });
  it("rejects executable or URL-shaped content", () => {
    expect(validateVisualInstruction({ kind: "NUMBER_LINE", min: 0, max: 5, marks: [0, 5], altText: "<script>alert(1)</script>" })).toBeNull();
  });
  it("derives only explicit, unambiguous math requests", () => {
    expect(deriveRequestedMathVisual("I don't understand 4 × 3. Show me visually.", "Mathematics")).toMatchObject({ kind: "MULTIPLICATION_GROUPS", groups: 4, itemsPerGroup: 3 });
    expect(deriveRequestedMathVisual("show me 3/4", "Maths")).toMatchObject({ kind: "FRACTION_BAR", numerator: 3, denominator: 4, segments: ["filled", "filled", "filled", "empty"] });
    expect(deriveRequestedMathVisual("show me 12 ÷ 4", "Mathematics")).toMatchObject({ kind: "MULTIPLICATION_GROUPS", groups: 4, itemsPerGroup: 3 });
    expect(deriveRequestedMathVisual("show me this", "Science")).toBeNull();
    expect(deriveRequestedMathVisual("show me 7 ÷ 2", "Mathematics")).toBeNull();
  });
  it("resolves explicit visual follow-ups from one recent expression", () => {
    expect(deriveMathVisualWithContext("Can you show me visually?", "Mathematics", [{ role: "user", content: "What is 4 × 3?" }, { role: "assistant", content: "4 groups of 3 make 12." }])).toMatchObject({ source: "recent_context", visual: { groups: 4, itemsPerGroup: 3 } });
    expect(deriveMathVisualWithContext("show me", "Maths", [{ role: "assistant", content: "Three quarters means 3/4." }]).visual).toMatchObject({ kind: "FRACTION_BAR", numerator: 3, denominator: 4 });
    expect(deriveMathVisualWithContext("show me", "Mathematics", [{ role: "assistant", content: "4 × 3, or perhaps 7 × 8." }])).toMatchObject({ visual: null, source: "none" });
    expect(deriveMathVisualWithContext("show me 5 × 2", "Mathematics", [{ role: "assistant", content: "4 × 3" }])).toMatchObject({ source: "current_message", visual: { groups: 5, itemsPerGroup: 2 } });
    expect(deriveMathVisualWithContext("ممكن تورينيها بالرسم؟", "Mathematics", [{ role: "assistant", content: "٤ × ٣" }]).visual).toMatchObject({ groups: 4, itemsPerGroup: 3 });
  });
});
