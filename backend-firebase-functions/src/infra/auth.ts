import { HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from './firebase';
export type AccessRole = 'staff'|'manager'|'scheduler'|'admin'|'hr';
export function requireAuth(ctx:any){ if(!ctx.auth) throw new HttpsError('unauthenticated','Authentication required.'); return ctx.auth; }
function normalizePlatformRole(role:any){ const v=String(role||'').trim(); return (v==='superAdmin'||v==='super_admin'||v==='super-admin') ? 'superAdmin' : v || undefined; }
function normalizeAccessRole(role:any){ const v=String(role||'').trim(); if(v==='super_admin'||v==='super-admin') return 'admin' as AccessRole; return v as AccessRole | undefined; }
export function getClaims(ctx:any){ const a=requireAuth(ctx); const t=a.token||{}; return { uid:a.uid as string, orgId:t.orgId as string|undefined, accessRole:normalizeAccessRole(t.accessRole), platformRole:normalizePlatformRole(t.platformRole) as string|undefined }; }
export function requireOrg(c:{orgId?:string}){ if(!c.orgId) throw new HttpsError('failed-precondition','Missing orgId claim.'); return c.orgId; }
export function requireOrgAdminLike(c:{accessRole?:AccessRole, platformRole?:string}){ if(normalizePlatformRole(c.platformRole)==='superAdmin') return true; if(!c.accessRole||!['admin','scheduler','hr','manager'].includes(c.accessRole)) throw new HttpsError('permission-denied','Admin-like required.'); return true; }

// Payroll, PTO decisions, and employee documents are discretionary/sensitive
// data — restricted to admin and hr, unlike requireOrgAdminLike's broader set.
export function requireOrgAdminOrHr(c:{accessRole?:AccessRole, platformRole?:string}){ if(normalizePlatformRole(c.platformRole)==='superAdmin') return true; if(!c.accessRole||!['admin','hr'].includes(c.accessRole)) throw new HttpsError('permission-denied','Admin/HR required.'); return true; }

export function requireAdminOrScheduler(claims: any) {
  const role = normalizeAccessRole(claims?.accessRole || claims?.role || null);
  if (!role || !['admin','scheduler','manager','hr'].includes(String(role))) {
    throw new HttpsError('permission-denied', 'Admin/Scheduler privileges required.');
  }
}

async function isBootstrapSuperAdmin(uid?: string): Promise<boolean> {
  if (!uid) return false;
  const admin = initFirebase();
  const db = admin.firestore();

  try {
    const [rootSnap, platformSnap] = await Promise.all([
      db.doc(`users/${uid}`).get(),
      db.doc(`platformUsers/${uid}`).get(),
    ]);

    const root = rootSnap.exists ? rootSnap.data() as any : null;
    const platform = platformSnap.exists ? platformSnap.data() as any : null;
    const platformRole = normalizePlatformRole(root?.platformRole ?? platform?.platformRole);
    const accessRole = normalizeAccessRole(root?.accessRole ?? root?.role);
    return platformRole === 'superAdmin' || accessRole === 'admin';
  } catch {
    return false;
  }
}

export async function requireSuperAdmin(claims: any) {
  const platformRole = normalizePlatformRole(claims?.platformRole || null);
  const is = platformRole === 'superAdmin' || claims?.superAdmin === true || claims?.admin === true && claims?.orgId == null;
  if (is) return true;

  const bootstrap = await isBootstrapSuperAdmin(claims?.uid);
  if (bootstrap) return true;

  throw new HttpsError('permission-denied', 'Super admin privileges required.');
}

