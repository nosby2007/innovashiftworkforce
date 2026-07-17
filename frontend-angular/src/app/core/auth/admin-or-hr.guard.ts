import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

function normalizeRole(value: unknown): string {
  return String(value ?? '').trim();
}

function isSuperAdminRole(role: unknown): boolean {
  const value = normalizeRole(role);
  return value === 'superAdmin' || value === 'super_admin' || value === 'super-admin';
}

// Payroll, PTO decisions, and employee documents are discretionary/sensitive
// data — restricted to admin and hr, unlike the broader admin-like set
// (admin/manager/scheduler/hr) most of the /admin shell uses.
function isAdminOrHrRole(role: unknown): boolean {
  const value = normalizeRole(role);
  return value === 'admin' || value === 'hr';
}

export const adminOrHrGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const authService = inject(AuthService);

  const user = await authService.waitForAuthState();
  if (!user) return router.parseUrl('/login');

  const token = await user.getIdTokenResult(false);
  const claims: any = token.claims || {};

  const orgId = normalizeRole(claims.orgId);
  const accessRole = normalizeRole(claims.accessRole);
  const platformRole = claims.platformRole;

  const isSuperAdmin = platformRole === 'superAdmin';
  if (isSuperAdmin) return router.parseUrl('/platform');

  if (orgId && isAdminOrHrRole(accessRole)) return true;

  const fallback = await authService.resolveOrgContext(user.uid);
  const fallbackOrgId = normalizeRole(fallback.orgId);
  const fallbackAccessRole = normalizeRole(fallback.accessRole);

  if (isSuperAdminRole(fallback.platformRole)) return router.parseUrl('/platform');
  if (fallbackOrgId && isAdminOrHrRole(fallbackAccessRole)) return true;

  // Admin-like but not admin/hr (manager/scheduler) — send back to the admin
  // dashboard rather than the staff shell, since they still belong in /admin.
  return router.parseUrl('/admin');
};
