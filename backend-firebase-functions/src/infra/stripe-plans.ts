import { defineSecret } from 'firebase-functions/params';

// Self-serve checkout only covers the two flat-rate tiers — Enterprise is
// custom pricing, sold through the demo-request/sales flow, not Stripe
// Checkout. Price ids aren't secret in the security sense, but they use
// Secret Manager (not a plain env var) because it's the only config
// mechanism this repo's CI deploy pipeline actually delivers — .env files
// are gitignored repo-wide and never reach the GitHub Actions checkout.
// Set with: firebase functions:secrets:set STRIPE_PRICE_STARTER (and _PRO).
export const stripePriceStarter = defineSecret('STRIPE_PRICE_STARTER');
export const stripePricePro = defineSecret('STRIPE_PRICE_PRO');

export const SELF_SERVE_PLANS = ['starter', 'pro'] as const;
export type SelfServePlan = (typeof SELF_SERVE_PLANS)[number];

export function isSelfServePlan(value: unknown): value is SelfServePlan {
  return typeof value === 'string' && (SELF_SERVE_PLANS as readonly string[]).includes(value);
}

export function priceIdForPlan(plan: SelfServePlan): string | undefined {
  if (plan === 'starter') return stripePriceStarter.value() || undefined;
  if (plan === 'pro') return stripePricePro.value() || undefined;
  return undefined;
}

/** Reverse lookup used by the webhook when a plan change originates from
 * Stripe's own customer portal rather than our checkout flow. */
export function planForPriceId(priceId: string | null | undefined): SelfServePlan | null {
  if (!priceId) return null;
  if (priceId === stripePriceStarter.value()) return 'starter';
  if (priceId === stripePricePro.value()) return 'pro';
  return null;
}
