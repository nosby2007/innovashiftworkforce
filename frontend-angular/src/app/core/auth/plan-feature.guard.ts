import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PlanEntitlementsService, PlanFeature } from '../tenancy/plan-entitlements.service';
import { AuthService } from './auth.service';

export function planFeatureGuard(feature: PlanFeature, fallback = '/app/dashboard'): CanActivateFn {
  return async () => {
    const router = inject(Router);
    const plans = inject(PlanEntitlementsService);
    const auth = inject(AuthService);

    if (plans.has(feature)) return true;

    const user = await auth.waitForAuthState();
    if (!user) return router.parseUrl('/login');

    const resolved = await auth.resolveOrgContext(user.uid);
    const rawPlan = String(resolved.plan || 'free').trim().toLowerCase();
    const rawStatus = String(resolved.planStatus || 'active').trim().toLowerCase();
    const normalizedPlan = rawPlan === 'free' ? 'starter' : rawPlan;
    const activeStatus = rawStatus === 'active' || rawStatus === 'trialing';
    const effectivePlan = activeStatus ? normalizedPlan : 'starter';

    const rank = (plan: string) => ({ starter: 0, pro: 1, enterprise: 2 }[plan] ?? 0);
    const required = ({ adminAnalytics: 'pro', smartScheduler: 'pro', timesheetsExport: 'pro', auditLog: 'enterprise' } as const)[feature];

    return rank(effectivePlan) >= rank(required) ? true : router.parseUrl(fallback);
  };
}
