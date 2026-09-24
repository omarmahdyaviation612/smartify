export type TutorConversationTurn = { role: string; content: string };

export type AdaptiveMathTeachingPlan = {
  stage: "CURRICULUM_FIRST" | "SIMPLIFY" | "ALTERNATIVE_REPRESENTATION" | "CONCRETE_BRIDGE";
  difficultySignals: number;
  method: string | null;
  avoidMethods: string[];
};

const STRUGGLE_PATTERN = /\b(?:i (?:do not|don't) understand|(?:can you )?explain (?:(?:it|that) )?(?:again|another way)|still (?:confused|don't get it)|i'?m stuck)\b|مش\s*(?:فاهم|فهم)|مش\s*مستوعب|(?:ممكن|عايز)\s*تشرح(?:ها)?\s*(?:تاني|بطريقة تانية)|لسه\s*مش\s*فاهم/iu;
const INCORRECT_FEEDBACK_PATTERN = /\b(not (?:quite|correct|right)|try again|that(?:'s| is) incorrect)\b|مش\s*(?:صح|مظبوط)|(?:حاول|جرب)\s*تاني/iu;
const METHOD_PATTERNS: Array<[string, RegExp]> = [
  ["number line", /number line|خط الأعداد/iu],
  ["concrete objects", /\b(?:apples|blocks|counters|objects)\b|(?:تفاح|مكعبات|أشياء)/iu],
  ["bar model", /bar model|نموذج الشريط/iu],
  ["decomposition", /decompos|break (?:the )?number|تجزئة|نفكك/iu],
  ["grouping", /group(?:ing|s)?|مجموعات/iu],
  ["pattern recognition", /pattern|نمط/iu],
  ["reverse checking", /check (?:it )?backwards|reverse check|نتأكد بالعكس/iu],
];
const ALTERNATIVE_METHODS = ["visual reasoning", "number line", "bar model", "decomposition", "grouping", "pattern recognition", "reverse checking"];

function isMathematics(subjectName: string): boolean {
  return /\b(math|mathematics|maths)\b|رياضيات/iu.test(subjectName);
}

function methodsUsed(turns: TutorConversationTurn[]): string[] {
  return METHOD_PATTERNS.filter(([, pattern]) => turns.some(turn => turn.role === "assistant" && pattern.test(turn.content))).map(([method]) => method);
}

/**
 * A conservative, deterministic summary of visible conversation evidence.
 * It never claims an answer is wrong by itself: an incorrect-answer signal
 * requires the tutor's own prior correction in the stored conversation.
 */
export function buildAdaptiveMathTeachingPlan(subjectName: string, turns: TutorConversationTurn[]): AdaptiveMathTeachingPlan | null {
  if (!isMathematics(subjectName)) return null;
  const recent = turns.slice(-20);
  const explicitStruggles = recent.filter(turn => turn.role === "user" && STRUGGLE_PATTERN.test(turn.content)).length;
  const correctedAttempts = recent.filter(turn => turn.role === "assistant" && INCORRECT_FEEDBACK_PATTERN.test(turn.content)).length;
  const difficultySignals = explicitStruggles + correctedAttempts;
  const avoidMethods = methodsUsed(recent);

  if (difficultySignals === 0) return { stage: "CURRICULUM_FIRST", difficultySignals, method: null, avoidMethods };
  if (difficultySignals === 1) return { stage: "SIMPLIFY", difficultySignals, method: null, avoidMethods };
  if (difficultySignals === 2) {
    return {
      stage: "ALTERNATIVE_REPRESENTATION",
      difficultySignals,
      method: ALTERNATIVE_METHODS.find(method => !avoidMethods.includes(method)) ?? "very small concrete example",
      avoidMethods,
    };
  }
  return { stage: "CONCRETE_BRIDGE", difficultySignals, method: "very small concrete example", avoidMethods };
}
