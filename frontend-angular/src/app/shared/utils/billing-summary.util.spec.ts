import { describe, it, expect } from 'vitest';
import { computeBillingSummary } from './billing-summary.util';

const PRICES = { free: 0, starter: 49, pro: 149, enterprise: null };

describe('computeBillingSummary', () => {
  it('sums MRR across active paying orgs by plan', () => {
    const s = computeBillingSummary([
      { plan: 'starter', planStatus: 'active' },
      { plan: 'starter', planStatus: 'active' },
      { plan: 'pro', planStatus: 'active' },
    ], PRICES);
    expect(s.totalMrrUsd).toBe(49 + 49 + 149);
    expect(s.rows.find((r) => r.plan === 'starter')?.activeCount).toBe(2);
    expect(s.rows.find((r) => r.plan === 'pro')?.mrrUsd).toBe(149);
  });

  it('excludes disabled orgs entirely', () => {
    const s = computeBillingSummary([{ plan: 'pro', planStatus: 'active', active: false }], PRICES);
    expect(s.totalMrrUsd).toBe(0);
  });

  it('excludes trialing orgs from MRR but counts them separately', () => {
    const s = computeBillingSummary([{ plan: 'pro', planStatus: 'trialing' }], PRICES);
    expect(s.totalMrrUsd).toBe(0);
    expect(s.trialingCount).toBe(1);
  });

  it('excludes past_due and canceled orgs from MRR', () => {
    const s = computeBillingSummary([
      { plan: 'pro', planStatus: 'past_due' },
      { plan: 'starter', planStatus: 'canceled' },
    ], PRICES);
    expect(s.totalMrrUsd).toBe(0);
  });

  it('tracks enterprise active orgs separately since pricing is custom', () => {
    const s = computeBillingSummary([{ plan: 'enterprise', planStatus: 'active' }], PRICES);
    expect(s.totalMrrUsd).toBe(0);
    expect(s.enterpriseActiveCount).toBe(1);
    expect(s.rows.find((r) => r.plan === 'enterprise')?.activeCount).toBe(1);
  });

  it('treats a missing or unknown plan as free', () => {
    const s = computeBillingSummary([{ planStatus: 'active' }, { plan: 'unknown_plan', planStatus: 'active' }], PRICES);
    expect(s.rows.find((r) => r.plan === 'free')?.activeCount).toBe(2);
    expect(s.totalMrrUsd).toBe(0);
  });
});
