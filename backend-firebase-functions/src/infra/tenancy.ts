/**
 * Shared tenancy guard — resolves authenticated caller context for any callable.
 * Usage:
 *   const ctx = resolveTenant(req);            // auth + orgId required
 *   const ctx = requireAdminTenant(req);       // + admin-like role required
 *   const ctx = requireSuperAdminTenant(req);  // + platform superAdmin required
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { requireAuth, getClaims, requireSuperAdmin } from './auth';
import { initFirebase } from './firebase';

export type AccessRole = 'staff' | 'manager' | 'scheduler' | 'admin' | 'hr';

export interface TenantContext {
  uid: string;
  orgId: string;
  role: AccessRole | null;
  isAdminLike: boolean;   // admin | scheduler | manager | hr
  isSuperAdmin: boolean;
}

const ADMIN_LIKE: ReadonlySet<string> = new Set(['admin', 'scheduler', 'manager', 'hr']);

export function resolveTenant(req: any): TenantContext {
  requireAuth(req);
  const claims = getClaims(req);

  if (!claims.orgId) {
    throw new HttpsError('failed-precondition', 'Missing orgId claim.');
  }

  const role = (String(claims.accessRole ?? '').trim() as AccessRole) || null;
  const platformRole = String(claims.platformRole ?? '').trim();
  const isSuperAdmin =
    platformRole === 'superAdmin' ||
    (claims as any)?.superAdmin === true;

  return {
    uid: claims.uid,
    orgId: claims.orgId,
    role,
    isAdminLike: isSuperAdmin || (role != null && ADMIN_LIKE.has(role)),
    isSuperAdmin,
  };
}

export async function resolveTenantWithFallback(req: any): Promise<TenantContext> {
  requireAuth(req);
  const claims = getClaims(req);

  if (claims.orgId) {
    return resolveTenant(req);
  }

  const admin = initFirebase();
  const db = admin.firestore();

  const [rootSnap, platformSnap] = await Promise.all([
    db.doc(`users/${claims.uid}`).get(),
    db.doc(`platformUsers/${claims.uid}`).get(),
  ]);

  const root = rootSnap.exists ? rootSnap.data() as any : null;
  const platform = platformSnap.exists ? platformSnap.data() as any : null;

  const orgId = String(root?.orgId ?? platform?.orgId ?? '').trim();
  if (!orgId) {
    throw new HttpsError('failed-precondition', 'Missing orgId claim.');
  }

  const role = (String(claims.accessRole ?? root?.accessRole ?? root?.role ?? '').trim() as AccessRole) || null;
  const platformRole = String(claims.platformRole ?? root?.platformRole ?? platform?.platformRole ?? '').trim();
  const isSuperAdmin =
    platformRole === 'superAdmin' ||
    (claims as any)?.superAdmin === true;

  return {
    uid: claims.uid,
    orgId,
    role,
    isAdminLike: isSuperAdmin || (role != null && ADMIN_LIKE.has(role)),
    isSuperAdmin,
  };
}

export function requireAdminTenant(req: any): TenantContext {
  const ctx = resolveTenant(req);
  if (!ctx.isAdminLike) {
    throw new HttpsError('permission-denied', 'Admin-level privileges required.');
  }
  return ctx;
}

export function requireSuperAdminTenant(req: any): TenantContext {
  const ctx = resolveTenant(req);
  if (!ctx.isSuperAdmin) {
    throw new HttpsError('permission-denied', 'Super-admin privileges required.');
  }
  return ctx;
}
