import { mergeHeadingsIntoUnits } from "./full-book-scan-merge";

describe("mergeHeadingsIntoUnits", () => {
  it("chapter starts across multiple chunks merge correctly, in page order, into one Unit per chapter with a matching single Topic", () => {
    const headings = [
      { titleEn: "Chapter 2: The Storm", titleAr: "الفصل 2: العاصفة", pdfPage: 20 },
      { titleEn: "Chapter 1: The Beach", titleAr: "الفصل 1: الشاطئ", pdfPage: 4 },
      { titleEn: "Chapter 3: The Rescue", titleAr: "الفصل 3: الإنقاذ", pdfPage: 35 },
    ];
    const result = mergeHeadingsIntoUnits(headings, 50);

    expect(result.units).toHaveLength(3);
    expect(result.units.map((u) => u.nameEn)).toEqual(["Chapter 1: The Beach", "Chapter 2: The Storm", "Chapter 3: The Rescue"]);
    expect(result.units.every((u) => u.topics.length === 1)).toBe(true);
    expect(result.units[0].topics[0].nameEn).toBe("Chapter 1: The Beach");
  });

  it("page ranges are correct: each Unit ends the page before the next one starts, and the last Unit ends at the real PDF page count", () => {
    const headings = [
      { titleEn: "Chapter 1", titleAr: "1", pdfPage: 4 },
      { titleEn: "Chapter 2", titleAr: "2", pdfPage: 20 },
      { titleEn: "Chapter 3", titleAr: "3", pdfPage: 35 },
    ];
    const result = mergeHeadingsIntoUnits(headings, 50);

    expect(result.units[0]).toMatchObject({ sourcePageStart: 4, sourcePageEnd: 19 });
    expect(result.units[1]).toMatchObject({ sourcePageStart: 20, sourcePageEnd: 34 });
    expect(result.units[2]).toMatchObject({ sourcePageStart: 35, sourcePageEnd: 50 });
  });

  it("duplicate headings (a running header repeated across consecutive pages/chunks) are removed, keeping the earliest occurrence", () => {
    const headings = [
      { titleEn: "Anna and the Dolphin", titleAr: "آنا والدلفين", pdfPage: 4 },
      { titleEn: "Anna and the Dolphin", titleAr: "آنا والدلفين", pdfPage: 5 }, // same running title reported again on the next page
      { titleEn: "Anna and the Dolphin", titleAr: "آنا والدلفين", pdfPage: 6 },
      { titleEn: "Chapter 2", titleAr: "الفصل 2", pdfPage: 20 },
    ];
    const result = mergeHeadingsIntoUnits(headings, 50);

    expect(result.units).toHaveLength(2);
    expect(result.units[0]).toMatchObject({ nameEn: "Anna and the Dolphin", sourcePageStart: 4, sourcePageEnd: 19 });
  });

  it("does NOT collapse the same title reused much later, separated by a distinct section in between", () => {
    const headings = [
      { titleEn: "Interlude", titleAr: "فاصل", pdfPage: 4 },
      { titleEn: "Chapter 1", titleAr: "1", pdfPage: 10 },
      { titleEn: "Interlude", titleAr: "فاصل", pdfPage: 30 }, // legitimately reused title, not adjacent to the first
    ];
    const result = mergeHeadingsIntoUnits(headings, 50);

    expect(result.units).toHaveLength(3);
    expect(result.units.map((u) => u.nameEn)).toEqual(["Interlude", "Chapter 1", "Interlude"]);
  });

  it("title matching for dedup is case/whitespace-insensitive", () => {
    const headings = [
      { titleEn: "  Chapter One  ", titleAr: "١", pdfPage: 4 },
      { titleEn: "chapter one", titleAr: "١", pdfPage: 5 },
    ];
    const result = mergeHeadingsIntoUnits(headings, 20);
    expect(result.units).toHaveLength(1);
  });

  it("a single detected heading produces one Unit spanning to the end of the book", () => {
    const result = mergeHeadingsIntoUnits([{ titleEn: "The Whole Story", titleAr: "القصة كاملة", pdfPage: 3 }], 40);
    expect(result.units).toEqual([
      { nameEn: "The Whole Story", nameAr: "القصة كاملة", sourcePageStart: 3, sourcePageEnd: 40, topics: [{ nameEn: "The Whole Story", nameAr: "القصة كاملة" }] },
    ]);
  });

  it("zero detected headings produces zero Units", () => {
    const result = mergeHeadingsIntoUnits([], 40);
    expect(result.units).toEqual([]);
  });
});
