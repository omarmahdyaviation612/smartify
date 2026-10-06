import { remapSourceImageIndexToPages } from "./unit-grounding-page-remap.util";
import type { RawGroundingNotes } from "./unit-grounding.types";
import type { SizedPage } from "../../ai/vision-request-sizing";

function rawNotes(overrides: Partial<RawGroundingNotes> = {}): RawGroundingNotes {
  return {
    unitTitle: "Angles and shapes",
    gradeLevel: "Year 5",
    subject: "Mathematics",
    learningObjectives: ["Identify angle types."],
    concepts: [],
    facts: [],
    vocabulary: [],
    skills: [],
    topicHints: [],
    scopeNotes: [],
    ...overrides,
  };
}

function sizedPage(page: number): SizedPage {
  return { page, imagePath: `C:/tmp/page-${page}.png`, imageTokens: 100 };
}

describe("remapSourceImageIndexToPages", () => {
  // 1. Two-page chunk, explicit ordinal -> real page mapping (the exact
  // production incident scenario: pages 21-22).
  it("1. maps a 2-image chunk's ordinals to the correct real PDF pages", () => {
    const pages = [sizedPage(21), sizedPage(22)];
    const raw = rawNotes({
      concepts: [{ name: "Right angle", description: "A 90-degree angle.", importance: "core", sourceImageIndex: [1] }],
      facts: [{ fact: "A square has four right angles.", importance: "core", sourceImageIndex: [2] }],
    });

    const result = remapSourceImageIndexToPages(raw, pages);

    expect(result.concepts[0].sourcePages).toEqual([21]);
    expect(result.facts[0].sourcePages).toEqual([22]);
  });

  // 3. Per-item provenance is preserved — never collapsed to the whole
  // chunk's page range.
  it("3. preserves distinct per-item provenance rather than assigning the entire chunk range to every item", () => {
    const pages = [sizedPage(21), sizedPage(22)];
    const raw = rawNotes({
      concepts: [
        { name: "Right angle", description: "A 90-degree angle.", importance: "core", sourceImageIndex: [1] },
        { name: "Obtuse angle", description: "An angle greater than 90 degrees.", importance: "core", sourceImageIndex: [2] },
      ],
    });

    const result = remapSourceImageIndexToPages(raw, pages);

    expect(result.concepts[0].sourcePages).toEqual([21]); // NOT [21, 22]
    expect(result.concepts[1].sourcePages).toEqual([22]); // NOT [21, 22]
  });

  it("an item citing multiple images gets each of their real pages, in order", () => {
    const pages = [sizedPage(21), sizedPage(22)];
    const raw = rawNotes({
      concepts: [{ name: "Angle types", description: "Covers both pages.", importance: "core", sourceImageIndex: [1, 2] }],
    });

    const result = remapSourceImageIndexToPages(raw, pages);

    expect(result.concepts[0].sourcePages).toEqual([21, 22]);
  });

  // 4. Renderer/page-mapping regression for 1/2/5-page chunks.
  it("4a. 1-page chunk: the single image maps to the single real page", () => {
    const pages = [sizedPage(30)];
    const raw = rawNotes({ concepts: [{ name: "X", description: "Y", importance: "core", sourceImageIndex: [1] }] });
    expect(remapSourceImageIndexToPages(raw, pages).concepts[0].sourcePages).toEqual([30]);
  });

  it("4b. 2-page chunk: ordinals 1 and 2 map to consecutive real pages", () => {
    const pages = [sizedPage(41), sizedPage(42)];
    const raw = rawNotes({
      concepts: [
        { name: "X", description: "Y", importance: "core", sourceImageIndex: [1] },
        { name: "Z", description: "W", importance: "core", sourceImageIndex: [2] },
      ],
    });
    const result = remapSourceImageIndexToPages(raw, pages);
    expect(result.concepts[0].sourcePages).toEqual([41]);
    expect(result.concepts[1].sourcePages).toEqual([42]);
  });

  it("4c. 5-page chunk (the maximum chunk size): every ordinal maps to its correct real page", () => {
    const pages = [sizedPage(1), sizedPage(2), sizedPage(3), sizedPage(4), sizedPage(5)];
    const raw = rawNotes({
      concepts: [
        { name: "A", description: "d", importance: "core", sourceImageIndex: [1] },
        { name: "B", description: "d", importance: "core", sourceImageIndex: [3] },
        { name: "C", description: "d", importance: "core", sourceImageIndex: [5] },
      ],
    });
    const result = remapSourceImageIndexToPages(raw, pages);
    expect(result.concepts[0].sourcePages).toEqual([1]);
    expect(result.concepts[1].sourcePages).toEqual([3]);
    expect(result.concepts[2].sourcePages).toEqual([5]);
  });

  it("vocabulary and topicHints are remapped the same way as concepts/facts", () => {
    const pages = [sizedPage(21), sizedPage(22)];
    const raw = rawNotes({
      vocabulary: [{ term: "Vertex", meaning: "The point where two lines meet.", sourceImageIndex: [2] }],
      topicHints: [{ topicTitle: "Angles", relevantConcepts: ["Right angle"], sourceImageIndex: [1] }],
    });
    const result = remapSourceImageIndexToPages(raw, pages);
    expect(result.vocabulary[0].sourcePages).toEqual([22]);
    expect(result.topicHints[0].sourcePages).toEqual([21]);
  });

  it("a topicHint with no sourceImageIndex at all (optional field) remaps to an empty sourcePages array, never a guess", () => {
    const pages = [sizedPage(21), sizedPage(22)];
    const raw = rawNotes({ topicHints: [{ topicTitle: "Angles", relevantConcepts: ["Right angle"] }] });
    const result = remapSourceImageIndexToPages(raw, pages);
    expect(result.topicHints[0].sourcePages).toEqual([]);
  });

  it("preserves every non-page field unchanged (name/description/importance/etc.)", () => {
    const pages = [sizedPage(21)];
    const raw = rawNotes({
      unitTitle: "Angles and shapes",
      concepts: [{ name: "Right angle", description: "A 90-degree angle.", importance: "supporting", sourceImageIndex: [1] }],
    });
    const result = remapSourceImageIndexToPages(raw, pages);
    expect(result.unitTitle).toBe("Angles and shapes");
    expect(result.concepts[0].name).toBe("Right angle");
    expect(result.concepts[0].description).toBe("A 90-degree angle.");
    expect(result.concepts[0].importance).toBe("supporting");
  });
});
