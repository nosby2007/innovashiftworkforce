import { HttpsError } from 'firebase-functions/v2/https';

export function normalizeOrgPlan(plan: unknown): 'starter' | 'pro' | 'enterprise' {
  const value = String(plan || 'free').trim().toLowerCase();
  if (value === 'enterprise') return 'enterprise';
  if (value === 'pro') return 'pro';
  return 'starter';
}

export function getMaxEmployeesForPlan(plan: unknown): number | null {
  const normalized = normalizeOrgPlan(plan);
  if (normalized === 'enterprise') return null;
  if (normalized === 'pro') return 150;
  return 25;
}

export async function assertOrgCanAddActiveUser(db: FirebaseFirestore.Firestore, orgId: string, orgPlan: unknown, skipIfUidAlreadyActive?: string) {
  const maxEmployees = getMaxEmployeesForPlan(orgPlan);
  if (maxEmployees == null) return;

  const snap = await db.collection(`orgs/${orgId}/users`).get();
  const activeCount = snap.docs.filter((doc) => {
    if (skipIfUidAlreadyActive && doc.id === skipIfUidAlreadyActive && doc.data()?.active !== false) {
      return false;
    }
    return doc.data()?.active !== false;
  }).length;

  if (activeCount >= maxEmployees) {
    throw new HttpsError('failed-precondition', `Plan limit reached: ${maxEmployees} active employees allowed for this organization.`);
  }
}
