import type { Config } from "tailwindcss";
import { smartifyTailwindPreset } from "../../packages/ui/src/tailwind-preset";

const config: Config = {
  presets: [smartifyTailwindPreset as Config],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};
export default config;
