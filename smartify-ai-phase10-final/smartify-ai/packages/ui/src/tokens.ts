/**
 * TypeScript mirror of tokens.css — use where a raw JS value is needed
 * (Tailwind config, chart color arrays, inline style calculations).
 * The CSS custom properties in tokens.css remain the source of truth;
 * keep these in sync manually (an eslint rule or script can enforce
 * this later if drift becomes a real problem).
 */

export const colors = {
  navy: { 900: "#0b1530", 700: "#101d45", 500: "#1c2c5c" },
  blue: { 600: "#1d4ed8", 500: "#2563eb", 400: "#3b82f6" },
  cyan: { 500: "#22d3ee", 400: "#67e8f9" },
  purple: { 600: "#6d28d9", 500: "#7c3aed" },
  neutral: {
    0: "#ffffff",
    50: "#f7f9fc",
    100: "#eef2f8",
    200: "#e2e8f2",
    300: "#cbd5e3",
    400: "#94a3b8",
    500: "#64748b",
    600: "#475569",
    700: "#334155",
    800: "#1e293b",
    900: "#0f172a",
  },
  success: { 500: "#16a34a", 100: "#dcfce7" },
  warning: { 500: "#d97706", 100: "#fef3c7" },
  error: { 500: "#dc2626", 100: "#fee2e2" },
} as const;

export const aiGradient = "linear-gradient(90deg, #2563eb 0%, #7c3aed 100%)";

export const spacing = {
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
  20: "80px",
  24: "96px",
} as const;

export const fontFamily = {
  sans: '"Inter", "Segoe UI", system-ui, sans-serif',
  arabic: '"IBM Plex Sans Arabic", "Cairo", "Segoe UI", system-ui, sans-serif',
} as const;

export const fontSize = {
  xs: "12px",
  sm: "14px",
  base: "16px",
  lg: "18px",
  xl: "20px",
  "2xl": "24px",
  "3xl": "30px",
  "4xl": "36px",
  "5xl": "48px",
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export const radius = {
  sm: "6px",
  md: "10px",
  lg: "16px",
  xl: "24px",
  full: "9999px",
} as const;

export const breakpoints = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  "2xl": "1536px",
} as const;

export const zIndex = {
  base: 0,
  dropdown: 100,
  sticky: 200,
  overlay: 300,
  modal: 400,
  toast: 500,
} as const;

export const transition = {
  duration: { fast: "120ms", base: "200ms", slow: "320ms" },
  easing: { standard: "cubic-bezier(0.4, 0, 0.2, 1)", emphasized: "cubic-bezier(0.2, 0, 0, 1)" },
} as const;
