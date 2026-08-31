import type { Config } from "tailwindcss";
import { colors, fontFamily, radius } from "./tokens";

/**
 * Shared Tailwind preset — apps/frontend (and any future dashboard app)
 * extend this instead of redefining brand colors locally, so the token
 * set in tokens.css/tokens.ts stays the single source of truth.
 */
export const smartifyTailwindPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        navy: colors.navy,
        "sf-blue": colors.blue,
        "sf-cyan": colors.cyan,
        "sf-purple": colors.purple,
        neutral: colors.neutral,
        success: colors.success,
        warning: colors.warning,
        error: colors.error,
      },
      fontFamily: {
        sans: fontFamily.sans.split(", "),
        arabic: fontFamily.arabic.split(", "),
      },
      borderRadius: {
        sf: radius.md,
        "sf-lg": radius.lg,
        "sf-xl": radius.xl,
      },
      backgroundImage: {
        "ai-gradient": "linear-gradient(90deg, #2563eb 0%, #7c3aed 100%)",
      },
    },
  },
};
