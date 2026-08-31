# Smartify AI — Phase 3 Decisions

Marketing site, built on top of the Phase 2 foundation. Nothing from Phase 1/2 was restarted — this only adds `packages/ui`, locale routing, content structure, and the pricing/testimonials features below.

---

## 1. Design tokens — `packages/ui`

A full token set now lives in `packages/ui/src/tokens.css` (CSS custom properties, the source of truth) and `tokens.ts` (JS mirror for Tailwind config / charts). Covers: brand colors (sampled from the logo — navy, blue, cyan, purple), neutral scale, backgrounds, text colors, success/warning/error, spacing (4px base), typography scale + weights, radius, shadows, borders, breakpoints, animation/transition, z-index.

Kept deliberately small: one shade set per brand color (not a full 50–900 ramp), a handful of semantic background/text aliases, and two shared primitives (`SmartifyButton`, `SmartifyContainer`) rather than a full component library. Both `apps/frontend` and any future dashboard consume this via a shared Tailwind preset (`smartifyTailwindPreset`), so there's one place to adjust the visual language.

The logo itself (`smartify-logo.png`) is used as-is in `apps/frontend/public/brand/` — not redrawn or reinterpreted.

## 2. Locale routing — Arabic-first

- Explicit routes: `/ar/...` and `/en/...`, no bare `/`.
- `middleware.ts` redirects any un-prefixed request to the persisted locale (via an `sf_locale` cookie) or `/ar` by default for first-time visitors — deliberately **not** using `Accept-Language`, so the language is always predictable and user-controlled.
- `app/[locale]/layout.tsx` sets `<html lang dir>` per locale (`rtl` for `ar`, `ltr` for `en`) and swaps font family (Arabic-optimized vs. Latin).
- `LanguageSwitcher` swaps the locale segment of the current path client-side; the cookie is refreshed by middleware on the next navigation.
- Architecture supports adding more locales later — just extend `SUPPORTED_LOCALES` and add an entry to `content/marketing.ts`.

## 3. Content structure — editable, not hardcoded

All homepage copy lives in `apps/frontend/content/marketing.ts` as a single typed `MarketingCopy` interface, with parallel `en`/`ar` objects, accessed through one function: `getMarketingCopy(locale)`. Components (`Hero`, `CurriculaSection`, etc.) only ever read from this object — no literal marketing strings inside JSX. Swapping this for a real CMS later means changing the body of `getMarketingCopy()`; component code doesn't change.

The copy itself is a realistic first draft (not lorem ipsum), built around the "Smarter Learning. Powered by AI." positioning and covering: AI personalization, curriculum-awareness, staying within the lesson, the four education systems, interactive explanations, progress tracking, parent visibility, and escalation to a real teacher session.

## 4. Pricing — real EGP structure, fetched live

- Added `PricingPlan` (Curriculum × Level → monthly price, included subjects, additional-subject price, all in EGP) and `QuestionPackage` (extra AI questions, price nullable/TBD, seeded `isActive: false` until real prices are set) to the Prisma schema.
- Added `SystemConfig` (generic key-value) for the one global tunable so far: `default_daily_ai_questions_per_subject = 10`.
- Seeded with the exact approved numbers for Local, National, British International, and American International.
- **British and American curricula are kept as separate `Curriculum` rows** with separate `PricingPlan` rows, even though today's numbers are identical — this is a business decision (they may diverge later), not a data-modeling shortcut.
- Backend: `GET /pricing` (public, no auth) returns the live table grouped by curriculum. Frontend `/[locale]/pricing` fetches this at request time (`revalidate: 300`) and renders it — no price appears as a literal in any component. The old illustrative FREE/BASIC/PLUS/PREMIUM USD tiers from the Phase 1 draft were removed from the seed entirely rather than left in as dead data.

## 5. Testimonials — real data only

- `Testimonials` component takes a `testimonials: Testimonial[]` prop and **renders nothing** when the array is empty — no skeleton, no placeholder text pretending social proof exists.
- Homepage currently passes an empty array (commented as "no real testimonials yet — replace with a real data fetch once submissions exist").
- In its place, a non-testimonial section (`LearningJourneysSection`, "Built for Every Learning Journey") gives the homepage visual balance using real structured copy instead of invented quotes — covering younger students, advanced students, parents, and the AI→teacher escalation path, per the spec's suggested alternative framing.

## What Phase 3 delivers (scope)

- `packages/ui`: tokens, Tailwind preset, `SmartifyButton`, `SmartifyContainer`
- Locale infrastructure: middleware, `[locale]` layout, `LanguageSwitcher`
- `content/marketing.ts`: bilingual homepage copy
- Homepage (`/[locale]`): navbar, hero, and all ten sections from the spec (testimonials section present but empty, learning-journeys alternative shown instead)
- `/[locale]/pricing`: live-fetched EGP pricing table
- `/[locale]/sign-in`, `/[locale]/sign-up`: Clerk-hosted auth pages, locale-aware
- Backend: `PricingModule` (`GET /pricing`, public)
- Database: `PricingPlan`, `QuestionPackage`, `SystemConfig` models + real EGP seed data

Out of scope for Phase 3 (later phases, per roadmap): `/curricula` and `/for-parents` pages are linked from the navbar but not yet built — they're straightforward extensions of the same pattern (locale-aware page + content module) and can be added incrementally; onboarding flow (Phase 4); actual dashboard behind auth (Phase 5); AI tutor (Phase 6).
