import { pickBalancedDiagnostic } from "./diagnostic-balance.util";

type Q = { id: string; subject: string };
const make = (subject: string, n: number): Q[] => Array.from({ length: n }, (_, i) => ({ id: `${subject}${i + 1}`, subject }));
const pick = (qs: Q[], order: string[], limit = 10) => pickBalancedDiagnostic(qs, (q) => q.subject, order, limit);
const count = (qs: Q[]) => qs.reduce<Record<string, number>>((m, q) => ({ ...m, [q.subject]: (m[q.subject] ?? 0) + 1 }), {});

describe("pickBalancedDiagnostic", () => {
  it("2026-10-09 replay: English created first no longer takes all 10 slots", () => {
    // createdAt order: every English question first, then the other subjects.
    const qs = [...make("en", 12), ...make("ar", 6), ...make("math", 6), ...make("sci", 6)];
    const out = pick(qs, ["ar", "math", "sci", "en"]);
    expect(out).toHaveLength(10);
    expect(count(out)).toEqual({ ar: 3, math: 3, sci: 2, en: 2 });
  });

  it("keeps each subject's own order and groups questions by subject", () => {
    const qs = [...make("en", 5), ...make("math", 5)];
    expect(pick(qs, ["math", "en"]).map((q) => q.id)).toEqual(["math1", "math2", "math3", "math4", "math5", "en1", "en2", "en3", "en4", "en5"]);
  });

  it("gives a short subject's unused slots to the others", () => {
    const qs = [...make("en", 10), ...make("ar", 1), ...make("math", 10)];
    const out = pick(qs, ["ar", "math", "en"]);
    expect(out).toHaveLength(10);
    expect(count(out)).toEqual({ ar: 1, math: 5, en: 4 });
  });

  it("returns everything when fewer than the limit exist, and nothing for no questions", () => {
    expect(pick(make("en", 3), ["en", "ar"])).toHaveLength(3);
    expect(pick([], ["en"])).toEqual([]);
  });

  it("serves subjects missing from the order list after the listed ones", () => {
    const out = pick([...make("x", 3), ...make("en", 3)], ["en"], 4);
    expect(out.map((q) => q.id)).toEqual(["en1", "en2", "x1", "x2"]);
  });
});
