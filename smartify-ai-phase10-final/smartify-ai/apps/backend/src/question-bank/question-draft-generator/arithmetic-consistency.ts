/**
 * Deterministic arithmetic-consistency guard for generated Questions
 * (2026-10-03, V1).
 *
 * WHY: two published CURRENT Questions were mathematically wrong — a Grade 4
 * word problem whose explanation claims "75 plus 15 equals 80" (the correct 90
 * is not even an option), and a Year 1 "Which pair of numbers makes 10?" with
 * no option summing to 10. No validator checked arithmetic.
 *
 * PRINCIPLE — high precision over recall: a Question is INVALID only when exact
 * arithmetic PROVES a contradiction. Anything not provable is UNKNOWN, never
 * INVALID. This is NOT a math solver; V1 proves exactly:
 *
 *  1. EXPLANATION claims: an explicit chain "a op b [op c ...] (=|equals|is
 *     equal to) r" inside one explanation sentence (op: + - − × x * ÷ / plus
 *     minus times "multiplied by" "divided by"), evaluated with normal
 *     precedence in exact rational arithmetic. Skipped (UNKNOWN) when the
 *     sentence negates/hypothesises/estimates (not, wrong, mistake, thinks,
 *     about, round, ...), when the chain is not maximal (preceded or followed
 *     by an operator/equality), when a division result is not an integer
 *     (could be a remainder or rounding), or when r equals the exact value
 *     rounded to r's own decimal places.
 *  2. DIRECT computation prompts: "What is <chain>?", "Calculate/Find/
 *     Evaluate/Work out <chain>", "What is the sum|total|product of a and b?",
 *     "What is the difference between a and b?" (a >= b) — whole prompt only.
 *  3. PAIR prompts: "Which pair of numbers makes|adds up to|sums to N?" with
 *     every option a numeric pair "a and b" / "a + b".
 *  4. TRUE_FALSE prompts that are exactly one arithmetic claim (optionally
 *     wrapped in "True or False").
 * For 2-4 the marked answer must equal the solved value, and for MC a correct
 * option must exist when every option is numeric.
 *
 * Numbers: integers, comma thousands separators ("5,324" is 5324, never 5 and
 * 324), exact decimals, an optional leading currency symbol and one trailing
 * unit word on an OPTION. Pure — no I/O, no provider call.
 */

export type ArithmeticStatus = "VALID" | "INVALID" | "UNKNOWN";
export type ArithmeticReasonCode = "EXPLANATION_ARITHMETIC_MISMATCH" | "MARKED_ANSWER_MISMATCH" | "NO_CORRECT_OPTION";
export interface ArithmeticFinding { code: ArithmeticReasonCode; detail: string }
export interface ArithmeticResult { status: ArithmeticStatus; findings: ArithmeticFinding[]; verified: string[] }
export interface ArithmeticQuestion { type?: unknown; promptEn?: unknown; optionsJson?: unknown; correctAnswerJson?: unknown; explanationEn?: unknown }

// ---- exact rational arithmetic -------------------------------------------
type Rat = { n: bigint; d: bigint };
const abs = (x: bigint) => (x < 0n ? -x : x);
function gcd(a: bigint, b: bigint): bigint { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a || 1n; }
function rat(n: bigint, d: bigint): Rat { if (d === 0n) throw new RangeError("division by zero"); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; }
const add = (a: Rat, b: Rat) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rat, b: Rat) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rat, b: Rat) => rat(a.n * b.n, a.d * b.d);
const div = (a: Rat, b: Rat) => rat(a.n * b.d, a.d * b.n);
const eq = (a: Rat, b: Rat) => a.n === b.n && a.d === b.d;
const isInt = (a: Rat) => a.d === 1n;
const show = (a: Rat) => (isInt(a) ? a.n.toString() : `${a.n}/${a.d}`);

const NUMBER_SRC = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
/** Exact value of a plain number string ("5,324", "2.75"); null when it is not one. */
export function parseNumber(s: string): Rat | null {
  const m = new RegExp(`^${NUMBER_SRC}$`).exec(s.trim());
  if (!m) return null;
  const [int, frac = ""] = s.trim().replace(/,/g, "").split(".");
  return rat(BigInt(int + frac), 10n ** BigInt(frac.length));
}
const decimalsOf = (s: string) => (s.includes(".") ? s.split(".")[1].length : 0);
function roundTo(a: Rat, places: number): Rat {
  const scale = 10n ** BigInt(places);
  const scaled = a.n * scale * 2n + (a.n >= 0n ? a.d : -a.d); // round half away from zero
  return rat(scaled / (2n * a.d), scale);
}

// ---- tokenizer -------------------------------------------------------------
type Tok = { k: "NUM"; v: Rat; raw: string } | { k: "OP"; op: "+" | "-" | "*" | "/" } | { k: "EQ" } | { k: "OTHER" };
const OP_WORDS: Array<[RegExp, "+" | "-" | "*" | "/"]> = [
  [/^multiplied by\b/, "*"], [/^divided by\b/, "/"], [/^plus\b/, "+"], [/^minus\b/, "-"], [/^times\b/, "*"],
  [/^[+]/, "+"], [/^[-−]/, "-"], [/^[×*]/, "*"], [/^x\b/, "*"], [/^[÷/]/, "/"],
];
function tokenize(text: string): Tok[] {
  const s = text.toLowerCase();
  const out: Tok[] = [];
  let i = 0;
  const numRe = new RegExp(`^[$£€]?(${NUMBER_SRC})`);
  while (i < s.length) {
    const rest = s.slice(i);
    if (/^\s/.test(rest)) { i++; continue; }
    const nm = numRe.exec(rest);
    if (nm && !(i > 0 && /[\w.,]/.test(s[i - 1]))) {
      const after = rest.slice(nm[0].length);
      // "2x", "3rd", "10cm", "50%", "3²" are not plain operands
      if (/^[a-z0-9%²³°]/.test(after)) { out.push({ k: "OTHER" }); i += nm[0].length; continue; }
      out.push({ k: "NUM", v: parseNumber(nm[1])!, raw: nm[1] }); i += nm[0].length; continue;
    }
    const eqm = /^(=|equals\b|is equal to\b)/.exec(rest);
    if (eqm) { out.push({ k: "EQ" }); i += eqm[0].length; continue; }
    const opm = OP_WORDS.find(([re]) => re.test(rest));
    if (opm) { out.push({ k: "OP", op: opm[1] }); i += opm[0].exec(rest)![0].length; continue; }
    const wm = /^[a-z']+|^./.exec(rest)!;
    out.push({ k: "OTHER" }); i += wm[0].length;
  }
  return out;
}

/** Normal precedence, exact. Throws on division by zero. */
function evaluate(nums: Rat[], ops: Array<"+" | "-" | "*" | "/">): Rat {
  const n = [nums[0]], o: Array<"+" | "-"> = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === "*" || ops[i] === "/") n[n.length - 1] = ops[i] === "*" ? mul(n[n.length - 1], nums[i + 1]) : div(n[n.length - 1], nums[i + 1]);
    else { o.push(ops[i] as "+" | "-"); n.push(nums[i + 1]); }
  }
  return o.reduce((acc, op, i) => (op === "+" ? add(acc, n[i + 1]) : sub(acc, n[i + 1])), n[0]);
}

type Claim = { text: string; value: Rat; rhs: Rat; rhsRaw: string; hasDivision: boolean };
/** Maximal "a op b ... = r" chains; `whole` requires the tokens to be exactly one claim. */
function claimsIn(tokens: Tok[], whole = false): Claim[] {
  const out: Claim[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].k !== "NUM" || (i > 0 && (tokens[i - 1].k === "OP" || tokens[i - 1].k === "EQ"))) continue;
    const nums: Rat[] = [(tokens[i] as any).v], ops: Array<"+" | "-" | "*" | "/"> = [];
    let j = i + 1;
    while (tokens[j]?.k === "OP" && tokens[j + 1]?.k === "NUM") { ops.push((tokens[j] as any).op); nums.push((tokens[j + 1] as any).v); j += 2; }
    if (!ops.length || tokens[j]?.k !== "EQ" || tokens[j + 1]?.k !== "NUM") continue;
    const after = tokens[j + 2];
    if (after && (after.k === "OP" || after.k === "EQ")) continue;
    if (whole && (i !== 0 || j + 2 !== tokens.length)) continue;
    let value: Rat;
    try { value = evaluate(nums, ops); } catch { continue; }
    const rhsTok = tokens[j + 1] as Extract<Tok, { k: "NUM" }>;
    out.push({ text: `${nums.map((v, k) => (k === 0 ? show(v) : `${ops[k - 1]} ${show(v)}`)).join(" ")} = ${rhsTok.raw}`, value, rhs: rhsTok.v, rhsRaw: rhsTok.raw, hasDivision: ops.includes("/") });
  }
  return out;
}

/** true/false when the claim is provably right/wrong; null when not provable (rounding, remainders). */
function judge(c: Claim): boolean | null {
  if (eq(c.value, c.rhs)) return true;
  if (c.hasDivision && !isInt(c.value)) return null; // remainder / rounding notation
  if (eq(roundTo(c.value, decimalsOf(c.rhsRaw)), c.rhs)) return null; // a rounded statement, not a contradiction
  return false;
}

const SKIP_CUES = /\b(not|no|never|incorrect|wrong|false|mistake\w*|error\w*|instead|rather|think|thinks|thought|say|says|said|claim\w*|believe\w*|estimat\w*|approximately|approx|about|roughly|round\w*|nearest|close to|if)\b|n't|≈|~/i;
const sentences = (t: string) => t.split(/(?<=[.!?;])\s+|\n+/).filter(Boolean);

/** Expression of a direct-computation prompt, or null when the prompt is not one. */
function directValue(prompt: string): { value: Rat; how: string } | null {
  const p = prompt.trim().replace(/\s+/g, " ");
  const N = NUMBER_SRC;
  let m = new RegExp(`^what is the (sum|total|product) of (${N}) and (${N}) ?\\?$`, "i").exec(p);
  if (m) { const a = parseNumber(m[2])!, b = parseNumber(m[3])!; return { value: m[1].toLowerCase() === "product" ? mul(a, b) : add(a, b), how: p }; }
  m = new RegExp(`^what is the difference between (${N}) and (${N}) ?\\?$`, "i").exec(p);
  if (m) { const a = parseNumber(m[1])!, b = parseNumber(m[2])!; const d = sub(a, b); return d.n >= 0n ? { value: d, how: p } : null; }
  m = /^(?:what is|calculate|find|evaluate|work out)(?: the value of)?:? (.+?) ?[?.]?$/i.exec(p);
  if (!m) return null;
  const toks = tokenize(m[1]);
  if (toks.length < 3 || toks.length % 2 === 0 || !toks.every((t, i) => (i % 2 === 0 ? t.k === "NUM" : t.k === "OP"))) return null;
  const nums = toks.filter((t): t is Extract<Tok, { k: "NUM" }> => t.k === "NUM").map((t) => t.v);
  const ops = toks.filter((t): t is Extract<Tok, { k: "OP" }> => t.k === "OP").map((t) => t.op);
  try {
    const value = evaluate(nums, ops);
    return ops.includes("/") && !isInt(value) ? null : { value, how: p };
  } catch { return null; }
}
// Unit words that change a number's value ("4 hundreds", "3 tenths") — such an option is never read as its bare number.
const VALUE_CHANGING_UNITS = /^(hundreds?|thousands?|tens?|ones?|millions?|billions?|dozens?|half|halves|quarters?|thirds?|percent|tenths?|hundredths?|thousandths?|times|units?|digits?|place|squared|cubed)$/i;
/** Numeric value of an option/answer: a number with optional leading currency and ONE trailing unit word. */
function optionValue(o: unknown): Rat | null {
  if (typeof o === "number") return parseNumber(String(o));
  if (typeof o !== "string") return null;
  const m = new RegExp(`^\\s*[$£€]?\\s*(${NUMBER_SRC})(?:\\s+([a-z]+))?\\s*$`, "i").exec(o);
  if (!m || (m[2] && VALUE_CHANGING_UNITS.test(m[2]))) return null;
  return parseNumber(m[1]);
}
function pairSum(o: unknown): Rat | null {
  if (typeof o !== "string") return null;
  const m = new RegExp(`^\\s*(${NUMBER_SRC})\\s*(?:and|\\+|&)\\s*(${NUMBER_SRC})\\s*$`, "i").exec(o);
  return m ? add(parseNumber(m[1])!, parseNumber(m[2])!) : null;
}

export function checkArithmeticConsistency(q: ArithmeticQuestion): ArithmeticResult {
  const findings: ArithmeticFinding[] = [];
  const verified: string[] = [];
  const prompt = typeof q.promptEn === "string" ? q.promptEn : "";
  const explanation = typeof q.explanationEn === "string" ? q.explanationEn : "";
  const options = Array.isArray(q.optionsJson) ? q.optionsJson : [];
  const marked = q.correctAnswerJson;

  // 1. explicit arithmetic claims in the explanation
  for (const sentence of sentences(explanation)) {
    if (SKIP_CUES.test(sentence)) continue;
    for (const c of claimsIn(tokenize(sentence))) {
      const ok = judge(c);
      if (ok === true) verified.push(`explanation: ${c.text}`);
      else if (ok === false) findings.push({ code: "EXPLANATION_ARITHMETIC_MISMATCH", detail: `explanation claims ${c.text}; exact value is ${show(c.value)}` });
    }
  }

  // 2. direct computation prompt
  const direct = directValue(prompt);
  if (direct) {
    const values = options.map(optionValue);
    const mv = optionValue(marked);
    if (values.length > 0 && values.every((v) => v !== null) && !values.some((v) => eq(v!, direct.value))) findings.push({ code: "NO_CORRECT_OPTION", detail: `no option equals ${show(direct.value)}` });
    if (mv) {
      if (eq(mv, direct.value)) verified.push(`answer: ${direct.how} = ${show(direct.value)}`);
      else findings.push({ code: "MARKED_ANSWER_MISMATCH", detail: `marked ${JSON.stringify(marked)}; ${direct.how} = ${show(direct.value)}` });
    }
  }

  // 3. "Which pair of numbers makes N?"
  const pm = new RegExp(`^\\s*which pair of numbers (?:makes|make|adds up to|add up to|sums to|has a sum of) (${NUMBER_SRC})\\s*\\??\\s*$`, "i").exec(prompt);
  if (pm && options.length > 0) {
    const target = parseNumber(pm[1])!;
    const sums = options.map(pairSum);
    if (sums.every((s) => s !== null)) {
      if (!sums.some((s) => eq(s!, target))) findings.push({ code: "NO_CORRECT_OPTION", detail: `no option pair sums to ${show(target)}` });
      const ms = pairSum(marked);
      if (ms && !eq(ms, target)) findings.push({ code: "MARKED_ANSWER_MISMATCH", detail: `marked ${JSON.stringify(marked)} sums to ${show(ms)}, not ${show(target)}` });
      else if (ms) verified.push(`pair: ${JSON.stringify(marked)} sums to ${show(target)}`);
    }
  }

  // 4. TRUE_FALSE whose prompt is exactly one arithmetic claim
  if (q.type === "TRUE_FALSE" && typeof marked === "string" && /^(true|false)$/i.test(marked.trim())) {
    const core = prompt.replace(/^\s*true or false\s*[:?.-]?\s*/i, "").replace(/\s*[.?]?\s*(true or false)?\s*\??\s*$/i, "");
    if (!SKIP_CUES.test(core)) {
      const [c] = claimsIn(tokenize(core), true);
      const ok = c ? judge(c) : null;
      if (ok !== null) {
        const truth = marked.trim().toLowerCase() === "true";
        if (truth === ok) verified.push(`true/false: ${c!.text} is ${ok}`);
        else findings.push({ code: "MARKED_ANSWER_MISMATCH", detail: `marked ${marked} but ${c!.text} is ${ok}` });
      }
    }
  }

  return { status: findings.length ? "INVALID" : verified.length ? "VALID" : "UNKNOWN", findings, verified };
}
