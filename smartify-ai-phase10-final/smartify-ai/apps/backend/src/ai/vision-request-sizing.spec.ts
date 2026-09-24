import { estimateImageTokens, estimateTextTokens, groundingSizingConfig, planGroundingChunks, pngDimensions } from "./vision-request-sizing";

describe("vision request sizing", () => {
  it("uses model-specific tile weights and explicit detail", () => {
    expect(estimateImageTokens("gpt-4o-mini", 1211, 1625, "high")).toBe(36835);
    expect(estimateImageTokens("gpt-4o-mini-2024-07-18", 1211, 1625, "low")).toBe(2833);
    expect(estimateImageTokens("gpt-4o", 1024, 1024, "high")).toBe(765);
    expect(estimateImageTokens("gpt-4.1", 512, 512, "high")).toBe(255);
    expect(() => estimateImageTokens("unknown", 512, 512, "high")).toThrow("No verified");
  });
  it("reads real PNG header dimensions, rejects malformed output", () => {
    expect(pngDimensions(Buffer.from("89504e470d0a1a0a0000000d49484452000004bb00000659", "hex"))).toEqual({ width: 1211, height: 1625 });
    expect(() => pngDimensions(Buffer.from("bad"))).toThrow();
  });
  it("splits pages 5-28 into ordered two-page requests below 90k", () => {
    const pages = Array.from({ length: 24 }, (_, i) => ({ page: i + 5, imagePath: `page-${i + 5}.png`, imageTokens: 36835 }));
    const chunks = planGroundingChunks(pages, 90000, 4000, () => 6000);
    expect(chunks.map(c => c.length)).toEqual(Array(12).fill(2));
    expect(chunks.flat()).toEqual(pages);
    for (const c of chunks) expect(c.reduce((n, p) => n + p.imageTokens, 10000)).toBeLessThan(90000);
  });
  it("rejects an oversized single page and unordered pages", () => {
    expect(() => planGroundingChunks([{ page: 5, imagePath: "x", imageTokens: 90000 }], 90000, 4000, () => 100)).toThrow("page 5");
    expect(() => planGroundingChunks([5, 7].map(page => ({ page, imagePath: "x", imageTokens: 10 })), 90000, 4000, () => 100)).toThrow("ordered");
  });
  it("defaults to high; bounds the configurable target", () => {
    expect(groundingSizingConfig({})).toEqual({ detail: "high", target: 90000 });
    expect(() => groundingSizingConfig({ GROUNDING_IMAGE_DETAIL: "auto" })).toThrow();
    expect(() => groundingSizingConfig({ GROUNDING_REQUEST_TOKEN_TARGET: "200000" })).toThrow();
    expect(estimateTextTokens("نص")).toBeGreaterThan(2);
  });
});
