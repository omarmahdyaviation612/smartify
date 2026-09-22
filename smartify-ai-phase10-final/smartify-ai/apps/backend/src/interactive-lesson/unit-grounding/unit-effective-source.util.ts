/**
 * English Extra Book / Story support V1 (2026-09-20) — the ONE place
 * "which PDF does this Unit's real content actually come from" is decided.
 * A Unit normally inherits its Subject's main textbook (Subject.sourceFile);
 * Unit.sourceFileOverride is an exceptional per-Unit override for a Unit
 * that belongs to a Subject but was transcribed from a DIFFERENT PDF (e.g.
 * an English "Story" book distinct from the English course book).
 *
 * Every production path that needs a Unit's source PDF (grounding
 * extraction, fingerprinting, TOC-extraction re-validation at confirm
 * time) must go through this function rather than reading
 * Subject.sourceFile directly, so the override can never be silently
 * bypassed in one path while honored in another.
 */
export function resolveEffectiveSourceFile(unit: { sourceFileOverride: string | null }, subject: { sourceFile: string | null }): string | null {
  return unit.sourceFileOverride ?? subject.sourceFile;
}
