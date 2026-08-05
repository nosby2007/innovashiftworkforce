import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * Industry config recommendations (FeaturesConfig.recommendedPlanFeatures)
 * must stay advisory-only — subscription entitlement is a separate axis
 * that industry config must never override. This source-scan is the
 * concrete enforcement: PlanEntitlementsService must never import from the
 * experience module.
 */
describe('PlanEntitlementsService source', () => {
  it('never imports from the experience config module', () => {
    const source = readFileSync('src/app/core/tenancy/plan-entitlements.service.ts', 'utf8');
    expect(source).not.toMatch(/from ['"].*experience/);
  });
});
