// Self-serve checkout only covers the two flat-rate tiers — Enterprise is
// custom pricing, sold through the demo-request/sales flow, not Stripe
// Checkout. Real Stripe Price IDs come from env config (set them up as
// Firebase Functions config or in the deploy environment); nothing here is
// a live price until those are configured.
export const SELF_SERVE_PLANS = ['starter', 'pro'] as const;
export type SelfServePlan = (typeof SELF_SERVE_PLANS)[number];

export function isSelfServePlan(value: unknown): value is SelfServePlan {
  return typeof value === 'string' && (SELF_SERVE_PLANS as readonly string[]).includes(value);
}

function priceEnvFor(plan: SelfServePlan): string | undefined {
  if (plan === 'starter') return process.env.STRIPE_PRICE_STARTER;
  if (plan === 'pro') return process.env.STRIPE_PRICE_PRO;
  return undefined;
}

export function priceIdForPlan(plan: SelfServePlan): string | undefined {
  return priceEnvFor(plan);
}

/** Reverse lookup used by the webhook when a plan change originates from
 * Stripe's own customer portal rather than our checkout flow. */
export function planForPriceId(priceId: string | null | undefined): SelfServePlan | null {
  if (!priceId) return null;
  for (const plan of SELF_SERVE_PLANS) {
    if (priceEnvFor(plan) === priceId) return plan;
  }
  return null;
}
