"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mascot, type MascotMood } from "./Mascot";
import { burst, type ParticleEffect } from "./particles";
import { playSound, type SoundName } from "./sounds";
import { readBest, readLastVariant, useFxPrefs, writeBest, writeLastVariant } from "./fx-prefs";

type Locale = "ar" | "en";

/* ------------------------------------------------------------------ */
/* Speech bubble + mascot, used to guide the child ("tap here!")       */
/* ------------------------------------------------------------------ */

export function MascotGuide({
  mood = "idle",
  message,
  size = 88,
  className = "",
}: {
  mood?: MascotMood;
  message?: string;
  size?: number;
  className?: string;
}) {
  return (
    <div className={`flex items-end gap-3 ${className}`}>
      <Mascot mood={mood} size={size} className="shrink-0" />
      {message && (
        <div
          role="status"
          aria-live="polite"
          className="sf-kid-bubble relative mb-6 max-w-xs rounded-2xl border-2 border-sf-purple-100 bg-white px-4 py-3 text-sm font-semibold leading-6 text-navy-900 shadow-sm"
        >
          {message}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sound / effects switches                                            */
/* ------------------------------------------------------------------ */

export function FxToggle({ locale, className = "" }: { locale: Locale; className?: string }) {
  const { sound, motion, toggleSound, toggleMotion } = useFxPrefs();
  const ar = locale === "ar";
  const pill = (on: boolean) =>
    `rounded-full border px-3 py-1 text-xs transition-colors ${on ? "border-sf-purple-600 text-sf-purple-600" : "border-neutral-300 text-neutral-500"}`;
  return (
    <div className={`flex gap-2 ${className}`}>
      <button type="button" onClick={toggleSound} aria-pressed={sound} className={pill(sound)}>
        {sound ? "🔊" : "🔇"} {ar ? "أصوات الاحتفال" : "Fun sounds"}
      </button>
      <button type="button" onClick={toggleMotion} aria-pressed={motion} className={pill(motion)}>
        {motion ? "✨" : "◻️"} {ar ? "الحركة والاحتفالات" : "Animations"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Result celebration                                                  */
/* ------------------------------------------------------------------ */

type Tier = "perfect" | "improved" | "good" | "tryAgain";

interface Variant {
  id: string;
  effects: ParticleEffect[];
  sounds: SoundName[];
  mood: MascotMood;
  capToss?: boolean;
}

// Full-mark celebrations rotate so the child never knows which one is next.
const PERFECT_VARIANTS: Variant[] = [
  { id: "glitter", effects: ["glitter"], sounds: ["sparkle"], mood: "cheer" },
  { id: "clap", effects: ["confetti"], sounds: ["clap"], mood: "clap" },
  { id: "fireworks", effects: ["fireworks"], sounds: ["fanfare"], mood: "cheer" },
  { id: "stars", effects: ["stars", "glitter"], sounds: ["ding", "sparkle"], mood: "happy" },
  { id: "cap", effects: ["confetti", "glitter"], sounds: ["fanfare", "clap"], mood: "cheer", capToss: true },
];

const COPY = {
  ar: {
    perfect: [
      "الدرجة النهائية! إنت بطل 🏆",
      "ممتاز! ولا غلطة واحدة 🌟",
      "برافو عليك! كده إنت فاهم الدرس صح 👏",
      "عبقري! كل الإجابات صح 🎉",
      "الله عليك! شغل جامد جدًا ✨",
    ],
    improved: ["كسرت رقمك اللي فات! 🔥", "أحسن من المرة اللي فاتت! كمّل كده 🚀"],
    good: ["شغل حلو! فاضل حاجات بسيطة وتجيب الدرجة النهائية 💪", "قربت جدًا! بص على الغلطات وجرّب تاني 👀"],
    tryAgain: ["ولا يهمك! كل مرة بنتعلم حاجة جديدة. يلا نجرّب تاني سوا 💪", "الغلط بيعلّمنا! راجع الدرس وإنت هتعديها المرة الجاية 🌱"],
    score: (c: number, t: number) => `${c} من ${t}`,
    retry: "جرّب تاني",
  },
  en: {
    perfect: [
      "Full marks! You're a champion 🏆",
      "Perfect — not a single mistake 🌟",
      "Bravo! You really understood this lesson 👏",
      "Genius! Every answer is right 🎉",
      "Wow, amazing work ✨",
    ],
    improved: ["You beat your last score! 🔥", "Better than last time — keep going! 🚀"],
    good: ["Nice work! Just a little more for full marks 💪", "So close! Check the mistakes and try again 👀"],
    tryAgain: ["No worries — every try teaches us something. Let's try again together 💪", "Mistakes help us learn! Review the lesson and you'll get it next time 🌱"],
    score: (c: number, t: number) => `${c} out of ${t}`,
    retry: "Try again",
  },
};

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

function choosePerfectVariant(): Variant {
  const last = readLastVariant();
  const pool = PERFECT_VARIANTS.filter((v) => v.id !== last);
  return pick(pool);
}

function starsFor(ratio: number) {
  if (ratio >= 1) return 3;
  if (ratio >= 0.66) return 2;
  if (ratio >= 0.34) return 1;
  return 0;
}

export function CelebrationCard({
  correct,
  total,
  scope,
  locale,
  onRetry,
  extra,
}: {
  correct: number;
  total: number;
  /** Identifies the activity for "beat your score", e.g. `lesson:<topicId>`. */
  scope: string;
  locale: Locale;
  onRetry?: () => void;
  extra?: React.ReactNode;
}) {
  const copy = COPY[locale] ?? COPY.ar;
  const ratio = total > 0 ? correct / total : 0;

  // Decide everything once per result so re-renders don't reshuffle it.
  const plan = useMemo(() => {
    const prevBest = readBest(scope);
    let tier: Tier;
    if (total > 0 && correct === total) tier = "perfect";
    else if (prevBest !== null && ratio > prevBest) tier = "improved";
    else if (ratio >= 0.5) tier = "good";
    else tier = "tryAgain";
    const variant: Variant | null =
      tier === "perfect"
        ? choosePerfectVariant()
        : tier === "improved"
          ? { id: "improved", effects: ["stars"], sounds: ["ding"], mood: "happy" }
          : tier === "good"
            ? { id: "good", effects: [], sounds: ["pop"], mood: "happy" }
            : { id: "try", effects: [], sounds: [], mood: "encourage" };
    return { tier, variant, message: pick(copy[tier]) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correct, total, scope]);

  const fired = useRef(false);
  const [shownStars, setShownStars] = useState(0);
  const stars = starsFor(ratio);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const { variant } = plan;
    // Side effects live here (not in useMemo) so StrictMode double renders can't skew them.
    writeBest(scope, ratio);
    if (plan.tier === "perfect" && variant) writeLastVariant(variant.id);
    variant?.effects.forEach((e, i) => setTimeout(() => burst(e), i * 450));
    variant?.sounds.forEach((s, i) => setTimeout(() => playSound(s), i * 500));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  // Stars pop in one by one (separate effect: safe to re-run).
  useEffect(() => {
    setShownStars(0);
    const timers = Array.from({ length: stars }, (_, i) => setTimeout(() => setShownStars(i + 1), 350 + i * 350));
    return () => timers.forEach(clearTimeout);
  }, [stars]);

  const celebrating = plan.tier === "perfect" || plan.tier === "improved";

  return (
    <div
      className={`sf-kid-pop rounded-3xl border-2 p-6 text-center ${
        celebrating ? "border-yellow-300 bg-gradient-to-b from-yellow-50 via-white to-sf-purple-50" : "border-sf-purple-100 bg-white"
      }`}
    >
      <div className="flex justify-center">
        <Mascot mood={plan.variant?.mood ?? "happy"} size={130} className={plan.variant?.capToss ? "sf-kid-cap-toss" : ""} />
      </div>

      <div className="mt-2 flex justify-center gap-2" aria-label={`${stars}/3`}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`text-4xl transition-all duration-300 ${i < shownStars ? "sf-kid-star-in" : "opacity-25 grayscale"}`}
          >
            ⭐
          </span>
        ))}
      </div>

      <p className="mt-3 text-xl font-bold text-navy-900">{plan.message}</p>
      <p className="mt-1 text-2xl font-extrabold text-sf-purple-600">{copy.score(correct, total)}</p>
      {extra}

      {onRetry && plan.tier !== "perfect" && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-full bg-ai-gradient px-6 py-2 text-sm font-semibold text-white shadow"
        >
          {copy.retry}
        </button>
      )}
    </div>
  );
}
