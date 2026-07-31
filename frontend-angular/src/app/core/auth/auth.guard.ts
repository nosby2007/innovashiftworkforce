import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { OrgContextService } from '../tenancy/org-context.service';

/** Base guard: requires any authenticated user */
export const authGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const auth = inject(AuthService);
  const ctx = inject(OrgContextService);

  const user = await auth.waitForAuthState();
  if (!user) return router.parseUrl('/login');

  if (!ctx.uid() || ctx.uid() !== user.uid || !ctx.orgId()) {
    const [claims, fallback] = await Promise.all([
      auth.getClaims(false),
      auth.resolveOrgContext(user.uid),
    ]);
    const orgId = claims.orgId ?? fallback.orgId ?? null;
    const profile = await auth.getUserProfile(user.uid, orgId);

    ctx.setContext({
      orgId,
      uid: user.uid,
      accessRole: claims.accessRole ?? fallback.accessRole ?? null,
      platformRole: claims.platformRole ?? fallback.platformRole ?? null,
      jobRole: claims.jobRole ?? fallback.jobRole ?? null,
      displayName: profile.displayName ?? user.displayName ?? null,
      email: profile.email ?? user.email ?? null,
      plan: fallback.plan ?? null,
      planStatus: fallback.planStatus ?? null,
      countryCode: fallback.countryCode ?? null,
      currencyCode: fallback.currencyCode ?? null,
      payFrequency: fallback.payFrequency ?? null,
      taxProfile: fallback.taxProfile ?? null,
      formerOrgId: fallback.formerOrgId ?? null,
    });
  }

  if (!ctx.orgId()) {
    return ctx.formerOrgId() ? router.parseUrl('/pay-history') : router.parseUrl('/login');
  }

  return true;
};
