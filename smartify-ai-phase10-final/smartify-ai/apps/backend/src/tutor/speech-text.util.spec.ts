import { stripMarkdownForSpeech } from "./speech-text.util";

describe("stripMarkdownForSpeech", () => {
  it("reads Arabic numbered lists as the full item text, not just the number", () => {
    const input = "1. **التربة الطينية:** دي بتكون ناعمة جدًا وليها قدرة على الاحتفاظ بالماء.\n2. **التربة الرملية:** بتصرف الماء بسرعة.";
    const result = stripMarkdownForSpeech(input);
    expect(result).not.toMatch(/^\s*1[.)]/);
    expect(result).not.toContain("**");
    expect(result).toContain("التربة الطينية: دي بتكون ناعمة جدًا وليها قدرة على الاحتفاظ بالماء.");
    expect(result).toContain("التربة الرملية: بتصرف الماء بسرعة.");
  });

  it("reads English numbered lists as the full item text, not just the number", () => {
    const input = "1. **Light Absorption**: Plants use chlorophyll.\n2. **Water Uptake**: Roots absorb water from soil.\n3. **Carbon Dioxide Intake**: Through stomata.";
    const result = stripMarkdownForSpeech(input);
    expect(result).not.toMatch(/\b1\./);
    expect(result).not.toContain("**");
    expect(result).toContain("Light Absorption: Plants use chlorophyll.");
    expect(result).toContain("Water Uptake: Roots absorb water from soil.");
    expect(result).toContain("Carbon Dioxide Intake: Through stomata.");
  });

  it("strips bold markdown (** and __) while keeping the wrapped text", () => {
    expect(stripMarkdownForSpeech("This is **very important** to remember.")).toBe("This is very important to remember.");
    expect(stripMarkdownForSpeech("This is __also bold__ text.")).toBe("This is also bold text.");
  });

  it("strips bullet points and reads each item as full spoken content", () => {
    const input = "Here are the types:\n- Clay soil\n- Sandy soil\n* Loamy soil\n• Rocky soil";
    const result = stripMarkdownForSpeech(input);
    expect(result).not.toMatch(/^[-*•]/m);
    expect(result).toBe("Here are the types:. Clay soil. Sandy soil. Loamy soil. Rocky soil");
  });

  it("preserves normal punctuation while stripping only markdown-specific syntax", () => {
    const input = "Hello!! What's `cool`? (see: important) [Read more](https://example.com/lesson)";
    const result = stripMarkdownForSpeech(input);
    expect(result).toBe("Hello!! What's cool? (see: important) Read more");
  });

  it("does not truncate a long, multi-paragraph response and preserves reading order", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => `**Point ${i + 1}:** This is a full explanation sentence for point number ${i + 1}, with enough detail to matter.`);
    const input = paragraphs.join("\n");
    const result = stripMarkdownForSpeech(input);
    expect(result).not.toContain("**");
    for (let i = 1; i <= 20; i++) {
      expect(result).toContain(`Point ${i}: This is a full explanation sentence for point number ${i}, with enough detail to matter.`);
    }
    // Order preserved: point 1 must appear before point 20 in the output.
    expect(result.indexOf("Point 1:")).toBeLessThan(result.indexOf("Point 20:"));
  });

  it("strips heading markers without dropping the heading text", () => {
    expect(stripMarkdownForSpeech("## Photosynthesis\nIt is a process.")).toBe("Photosynthesis. It is a process.");
  });

  it("strips fenced and inline code markers while keeping their text content", () => {
    expect(stripMarkdownForSpeech("Use the `stomata` to breathe.")).toBe("Use the stomata to breathe.");
    expect(stripMarkdownForSpeech("```\nx = 1\n```")).toBe("x = 1");
  });

  it("never loses Arabic text when mixed with Latin markdown syntax", () => {
    const input = "**عملية البناء الضوئي** (Photosynthesis) هي عملية مهمة.";
    const result = stripMarkdownForSpeech(input);
    expect(result).toContain("عملية البناء الضوئي");
    expect(result).toContain("عملية مهمة");
    expect(result).not.toContain("**");
  });

  it("returns an empty string for empty input without throwing", () => {
    expect(stripMarkdownForSpeech("")).toBe("");
  });
});
