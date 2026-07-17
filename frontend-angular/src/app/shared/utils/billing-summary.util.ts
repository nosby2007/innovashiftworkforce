/**
 * Estimated MRR from list pricing × active paying orgs, for the super-admin
 * revenue view. Not a live Stripe amount — self-serve checkout isn't wired
 * to the pricing page yet (org.plan is set manually by super-admins today),
 * so this is the best available estimate rather than a billed total.
 */

export interface BillableOrg {
  active?: boolean;
  plan?: string;
  planStatus?: string;
}

export interface PlanBillingRow {
  plan: string;
  priceUsd: number | null;
  activeCount: number;
  mrrUsd: number;
}

export interface BillingSummary {
  rows: PlanBillingRow[];
  totalMrrUsd: number;
  trialingCount: number;
  enterpriseActiveCount: number;
}

export function computeBillingSummary(
  orgs: BillableOrg[],
  planPrices: Record<string, number | null>,
  enterprisePlanKey = 'enterprise',
): BillingSummary {
  const plans = Object.keys(planPrices);
  const rows = new Map<string, PlanBillingRow>(
    plans.map((plan) => [plan, { plan, priceUsd: planPrices[plan], activeCount: 0, mrrUsd: 0 }])
  );
  let trialingCount = 0;
  let enterpriseActiveCount = 0;

  for (const o of orgs) {
    if (o.active === false) continue;
    const planKey = plans.includes(o.plan || '') ? String(o.plan) : 'free';
    const status = (o.planStatus || 'active').toLowerCase();
    if (status === 'trialing') { trialingCount++; continue; }
    if (status !== 'active') continue; // past_due/canceled — not counted as paying

    const row = rows.get(planKey) || rows.get('free');
    if (!row) continue;
    row.activeCount++;
    if (row.plan === enterprisePlanKey) {
      enterpriseActiveCount++;
    } else if (row.priceUsd != null) {
      row.mrrUsd += row.priceUsd;
    }
  }

  const totalMrrUsd = Array.from(rows.values()).reduce((sum, r) => sum + r.mrrUsd, 0);
  return { rows: Array.from(rows.values()), totalMrrUsd, trialingCount, enterpriseActiveCount };
}
