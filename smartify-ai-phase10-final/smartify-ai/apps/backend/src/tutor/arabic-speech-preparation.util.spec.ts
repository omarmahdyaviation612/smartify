import { containsArabicScript, prepareArabicSpeechText } from "./arabic-speech-preparation.util";

describe("containsArabicScript", () => {
  it("detects Arabic text", () => {
    expect(containsArabicScript("مرحباً يا سلمى")).toBe(true);
  });

  it("returns false for English-only text", () => {
    expect(containsArabicScript("Hello Salma")).toBe(false);
  });
});

describe("prepareArabicSpeechText", () => {
  it("leaves non-Arabic text completely unchanged", () => {
    const text = "4 + 3 = 7, great job!";
    expect(prepareArabicSpeechText(text)).toBe(text);
  });

  it("replaces math symbols with diacritized spoken words in Arabic text", () => {
    const result = prepareArabicSpeechText("يعني 4 + 3 = 7");
    expect(result).toContain("زائِد");
    expect(result).toContain("يُساوي");
    expect(result).not.toContain("+");
    expect(result).not.toContain("=");
  });

  it("converts small standalone numbers to diacritized number words", () => {
    const result = prepareArabicSpeechText("عندك 4 تفاحات و3 موز");
    expect(result).toContain("أَرْبَعة");
    expect(result).toContain("ثَلاثة");
  });

  it("normalizes Arabic-Indic digits before converting to number words", () => {
    const result = prepareArabicSpeechText("النتيجة ٧");
    expect(result).toContain("سَبْعة");
  });

  it("leaves numbers outside the covered small range as plain digits rather than guessing", () => {
    const result = prepareArabicSpeechText("عندك 145 تفاحة");
    expect(result).toContain("145");
  });

  it("diacritizes known whole-word terms without corrupting unrelated words that merely share letters", () => {
    const result = prepareArabicSpeechText("الجمع يعني إننا نجمع حاجات");
    expect(result).toContain("الجَمْع");
    // "نجمع" (a verb form, deliberately not in the dictionary) must be left untouched.
    expect(result).toContain("نجمع");
  });

  it("does not touch a word that is not an exact whole-token match (avoids partial/substring corruption)", () => {
    const result = prepareArabicSpeechText("مجموعتنا رائعة");
    // "مجموعتنا" ("our group") shares a root with dictionary entries but is
    // not an exact match — must be left completely untouched.
    expect(result).toContain("مجموعتنا");
  });

  it("preserves the exact meaning and word order — this is diacritization, not rewriting", () => {
    const result = prepareArabicSpeechText("لو عندك 2 تفاحات وضفتِ عليهم 3 تفاحات");
    expect(result).toMatch(/اِثْنان.*تفاحات.*ثَلاثة.*تفاحات/);
  });

  it("never changes the displayed text — it only derives a separate speech string", () => {
    const displayText = "الجمع يعني إننا نجمع حاجات مع بعض. مثلاً 2 + 3 = 5.";
    const speechText = prepareArabicSpeechText(displayText);
    expect(speechText).not.toBe(displayText); // proves a real transformation happened
    expect(displayText).toBe("الجمع يعني إننا نجمع حاجات مع بعض. مثلاً 2 + 3 = 5."); // and the original is untouched
  });
});
