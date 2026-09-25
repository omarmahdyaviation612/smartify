import type { VisualInstruction } from "@smartify/shared-types";

const MAX = 100;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const boundedInt = (n: unknown, min = 0, max = MAX): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

export function validateVisualInstruction(raw: unknown): VisualInstruction | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as any;
  if (typeof v.altText !== "string" || !v.altText.trim() || /[<>]|https?:\/\//i.test(v.altText)) return null;
  if (v.kind === "MULTIPLICATION_GROUPS" && boundedInt(v.groups, 1) && boundedInt(v.itemsPerGroup, 1) && v.item === "apple" || v.kind === "MULTIPLICATION_GROUPS" && boundedInt(v.groups, 1) && boundedInt(v.itemsPerGroup, 1) && ["dot", "block"].includes(v.item)) return { kind: v.kind, groups: v.groups, itemsPerGroup: v.itemsPerGroup, item: v.item, altText: v.altText };
  if (v.kind === "FRACTION_BAR" && boundedInt(v.denominator, 1) && boundedInt(v.numerator, 0, v.denominator) && Array.isArray(v.segments) && v.segments.length === v.denominator && v.segments.every((x: unknown) => x === "filled" || x === "empty") && v.segments.filter((x: string) => x === "filled").length === v.numerator) return v;
  if (v.kind === "NUMBER_LINE" && finite(v.min) && finite(v.max) && v.min < v.max && Math.abs(v.max - v.min) <= MAX && Array.isArray(v.marks) && v.marks.every((n: unknown) => finite(n) && (n as number) >= v.min && (n as number) <= v.max) && (!v.jumps || v.jumps.every((j: any) => finite(j.from) && finite(j.to) && j.from >= v.min && j.to <= v.max))) return v;
  if (v.kind === "BAR_MODEL" && Array.isArray(v.bars) && v.bars.length > 0 && v.bars.length <= 10 && v.bars.every((b: any) => boundedInt(b?.value, 1)) && (v.total === undefined || v.total === v.bars.reduce((s: number, b: any) => s + b.value, 0))) return v;
  if (v.kind === "PLACE_VALUE_BLOCKS" && ["thousands", "hundreds", "tens", "ones"].every((k) => v[k] === undefined || boundedInt(v[k]))) return v;
  return null;
}

export function parseTutorVisual(content: string): { text: string; visual: VisualInstruction | null } {
  const marker = /<!--SMARTIFY_VISUAL\s+([\s\S]*?)\s*-->/g;
  let visual: VisualInstruction | null = null;
  const text = content.replace(marker, (_full, payload: string) => {
    try { visual = validateVisualInstruction(JSON.parse(payload)) ?? visual; } catch { /* malformed internal marker is discarded */ }
    return "";
  }).replace(/```(?:json)?\s*```/gi, "").replace(/[ \t]+\n/g, "\n").trim();
  return { text, visual };
}

const SHOW = /\b(show|draw|visuali[sz]e|picture|diagram)\b|\b visually\b|وريني|ارسم|بصري/iu;
export function deriveRequestedMathVisual(message: string, subjectName: string): VisualInstruction | null {
  if (!/\b(math|mathematics|maths)\b|رياضيات/iu.test(subjectName) || !SHOW.test(message)) return null;
  const fraction = message.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  if (fraction) {
    const numerator = Number(fraction[1]), denominator = Number(fraction[2]);
    if (denominator > 0 && numerator <= denominator && denominator <= MAX) return validateVisualInstruction({ kind: "FRACTION_BAR", numerator, denominator, segments: Array.from({ length: denominator }, (_, i) => i < numerator ? "filled" : "empty"), altText: `${numerator} of ${denominator} equal parts are shaded.` });
  }
  const product = message.match(/(\d{1,2})\s*(?:×|x|\*)\s*(\d{1,2})/i);
  if (product) {
    const groups = Number(product[1]), itemsPerGroup = Number(product[2]);
    if (groups > 0 && itemsPerGroup > 0 && groups <= MAX && itemsPerGroup <= MAX) return validateVisualInstruction({ kind: "MULTIPLICATION_GROUPS", groups, itemsPerGroup, item: "apple", altText: `${groups} equal groups with ${itemsPerGroup} apples in each group.` });
  }
  const division = message.match(/(\d{1,2})\s*(?:÷|\/|divided by)\s*(\d{1,2})/i);
  if (division) {
    const total = Number(division[1]), groups = Number(division[2]);
    if (total > 0 && groups > 0 && total % groups === 0 && groups <= MAX && total / groups <= MAX) return validateVisualInstruction({ kind: "MULTIPLICATION_GROUPS", groups, itemsPerGroup: total / groups, item: "block", altText: `${total} objects split into ${groups} equal groups.` });
  }
  return null;
}
