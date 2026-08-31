# Smartify AI — Phase 8: Subscriptions & Payments

Builds on Phases 1–7. Nothing prior was restarted, with one deliberate correction explained below.

## Schema correction: `Subscription` now points at `PricingPlan`, not the old `SubscriptionPlan`

The original Phase 1 draft schema had `Subscription.planId → SubscriptionPlan` (generic FREE/BASIC/PLUS/PREMIUM USD tiers). Phase 3 replaced that pricing model with real, approved EGP pricing (`PricingPlan`, keyed by Curriculum × Level) but never updated `Subscription`'s foreign key, because nothing was built against it yet. Phase 8 is the first phase that actually needs a working `Subscription`, so this gets fixed now rather than building real billing on top of a schema that points at dead data.

`SubscriptionPlan` is removed outright (nothing in the codebase ever queried it after Phase 3). `Subscription` now has:
- `pricingPlanId → PricingPlan`
- `additionalSubjectsCount` — subjects bought beyond the plan's included count
- `monthlyTotalEGP` — snapshotted at subscribe time (`plan.monthlyPriceEGP + additionalSubjectsCount × plan.additionalSubjectPriceEGP`), so later price changes to `PricingPlan` don't silently alter what an existing subscriber is being charged
- `status`: `"pending" | "active" | "canceled" | "past_due"` — starts `pending` the moment checkout begins, flips to `active` only once a webhook confirms payment

This is a schema *correction*, not a redesign — no other phase's functionality (onboarding, dashboard, practice, quizzes, AI tutor) touches `Subscription` at all, so nothing else was affected.

## Payment provider abstraction — same shape as the AI provider layer

`apps/backend/src/payments/` mirrors `apps/backend/src/ai/` deliberately: a `PaymentProvider` interface (`createCheckoutSession`, `verifyAndParseWebhook`, `cancelSubscription`), a `PaymentProviderFactory` that resolves the active provider from a database row (`PaymentProviderConfig`, mirroring `AIProviderConfig`), and real vs. stub implementations:

- **`StripeProvider`** — a real implementation using the `stripe` SDK. Creates a subscription-mode Checkout Session priced in EGP (Stripe supports EGP directly), verifies webhook signatures with `stripe.webhooks.constructEvent`, and can cancel a subscription. Like `OpenAIProvider` in Phase 6, it fails fast and clearly (`ServiceUnavailableException`) if `STRIPE_SECRET_KEY` isn't set, rather than crashing inside the SDK.
- **`PaymobProvider`, `PayPalProvider`** — real stub classes implementing the full interface, each throwing "not implemented yet." Paymob is genuinely relevant given the Egyptian market this targets, but its auth-token/order/payment-key flow is meaningfully different from Stripe's and deserves real implementation time, not a rushed approximation.

All three `PaymentProviderConfig` rows are seeded `isActive: false`. **No payment provider is live by default** — activating one is a deliberate, explicit step (set the real secret env vars, flip the DB row) for whoever deploys this, never something this phase pretends is ready.

## Billing flow

1. `GET /billing/plans` — pricing plans for the student's own curriculum only (never lets someone check out a plan for a curriculum they're not enrolled in).
2. `POST /billing/checkout` — validates the plan belongs to the student's curriculum, computes `monthlyTotalEGP`, **creates the local `Subscription` row first** (status `pending`) before ever calling the payment provider — so the webhook always has something concrete to activate, and a failed/abandoned checkout leaves an honest `pending` record rather than nothing.
3. Payment provider webhook (`POST /webhooks/billing/:providerKey`) — signature-verified, translated into a generic `WebhookEvent`, applied via `BillingService.applyWebhookEvent()` which flips the `Subscription` row to `active`/`canceled`/`past_due`. The local `Subscription` table is the source of truth the rest of the app reads from — nothing else queries Stripe directly.
4. `POST /billing/cancel` — cancels on the provider side (if one is configured) and flips local status.

Webhook body handling follows the exact pattern established for Clerk in Phase 2: `/webhooks/billing/*` is registered with `express.raw()` in `main.ts` before Nest's default JSON parser, since signature verification needs the untouched raw bytes.

## Frontend

`/[locale]/billing` — current subscription card (plan, price, status, cancel button when active) plus a plan picker (from the student's own curriculum's real `PricingPlan` rows) with an additional-subjects input, computing the total price live. `/[locale]/billing/success` is the Checkout redirect landing page. Both handle the "payments not configured yet" case the same honest way Phase 6 handles the AI Tutor's missing key — a clear message, not a broken redirect.

## What Phase 8 does NOT include

- Admin UI for managing `PaymentProviderConfig`/`AIProviderConfig` (Phase 9).
- Question Package (extra AI questions) purchasing — pricing is still genuinely TBD per the Phase 3 decision; wiring it up would mean inventing a number that was explicitly deferred.
- Proration, upgrades/downgrades mid-cycle, invoices/receipts UI, or multiple concurrent subscriptions per student (the schema assumes one active subscription per student, a reasonable MVP simplification).
- Paymob/PayPal real implementations.

## Verification status — explicitly unverified, same honesty pattern as Phase 6

**No real Stripe account, keys, or webhook has been exercised in this environment.** The checkout-session creation, webhook signature verification, and cancellation code paths are written and structurally consistent with Stripe's documented API, but none of it has processed a real request. Add to the integration-test milestone (alongside the Clerk and AI Tutor items from Phases 4 and 6): create a real Stripe test-mode account, set `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, flip `PaymentProviderConfig.stripe.isActive` to `true`, and run a full checkout → webhook → `Subscription.status = "active"` cycle with Stripe's test card before trusting this in production.
