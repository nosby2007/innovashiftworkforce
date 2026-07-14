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

function isAdminLikeRole(role: unknown): boolean {
  const value = normalizeRole(role);
  return ['admin', 'scheduler', 'manager', 'hr'].includes(value);
}

export const adminGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const authService = inject(AuthService);

  // 1) Pas connecté => login
  const user = await authService.waitForAuthState();
  if (!user) return router.parseUrl('/login');

  // 2) Token/claims => vérifier orgId + rôle
  const token = await user.getIdTokenResult(false);
  const claims: any = token.claims || {};

  const orgId = normalizeRole(claims.orgId);
  const accessRole = normalizeRole(claims.accessRole);
  const platformRole = claims.platformRole;

  // 3) Super admins use the separated /platform shell, not org-admin routes.
  const isSuperAdmin = platformRole === 'superAdmin';
  if (isSuperAdmin) return router.parseUrl('/platform');

  // 4) Cas standard: orgId + rôle admin-like
  if (orgId && isAdminLikeRole(accessRole)) return true;

  // 5) Fallback Firestore (bootstrap / claims en retard)
  const fallback = await authService.resolveOrgContext(user.uid);
  const fallbackOrgId = normalizeRole(fallback.orgId);
  const fallbackAccessRole = normalizeRole(fallback.accessRole);

  if (isSuperAdminRole(fallback.platformRole)) return router.parseUrl('/platform');
  if (fallbackOrgId && isAdminLikeRole(fallbackAccessRole)) return true;

  // Ne pas déconnecter implicitement un utilisateur authentifié.
  return router.parseUrl('/app/dashboard');
};
