-- Subscription gains a second, distinct external identifier:
-- externalProviderSubscriptionId (the payment provider's own SUBSCRIPTION
-- id, e.g. Stripe "sub_...") separate from the existing
-- externalSubscriptionId (the CHECKOUT SESSION id, e.g. Stripe "cs_...").
--
-- These are two genuinely different Stripe identifiers that must not be
-- conflated: activation ("checkout.session.completed") is only ever
-- correlatable by the checkout session id (that's all we have at
-- checkout-creation time), while subscription-level lifecycle events
-- ("customer.subscription.deleted", "invoice.payment_failed") only ever
-- carry the real Stripe subscription id — never the checkout session id.
-- Before this migration, BillingService.applyWebhookEvent looked up ALL
-- three event types by externalSubscriptionId, so a real Stripe-initiated
-- cancellation or payment failure could never be correlated to a local
-- row and silently no-op'd.
--
-- Purely additive: a new nullable column plus an index. Existing rows get
-- externalProviderSubscriptionId = NULL, which is a fully valid, supported
-- state (historical subscriptions predating this fix simply never have a
-- provider subscription id recorded) — no backfill is possible or
-- required, since the real Stripe subscription id was never captured
-- before now and cannot be reconstructed from data we already have.

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "externalProviderSubscriptionId" TEXT;

-- CreateIndex
CREATE INDEX "Subscription_externalProviderSubscriptionId_idx" ON "Subscription"("externalProviderSubscriptionId");
