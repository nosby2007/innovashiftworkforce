import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { OrgContextService } from '../tenancy/org-context.service';
import { AuthService } from './auth.service';

function isSuperAdminRole(role: unknown): boolean {
  const value = String(role ?? '').trim();
  return value === 'superAdmin' || value === 'super_admin' || value === 'super-admin';
}

export const superAdminGuard: CanActivateFn = async () => {
  const ctx = inject(OrgContextService);
  const router = inject(Router);
  const auth = inject(AuthService);

  if (isSuperAdminRole(ctx.platformRole())) return true;

  const currentUser = await auth.waitForAuthState();
  if (currentUser) {
    const claims = await currentUser.getIdTokenResult(false);
    if (isSuperAdminRole(claims.claims?.['platformRole'])) return true;

    const fallback = await auth.resolveOrgContext(currentUser.uid);
    if (isSuperAdminRole(fallback.platformRole)) return true;
  }

  router.navigateByUrl('/app/dashboard');
  return false;
};
