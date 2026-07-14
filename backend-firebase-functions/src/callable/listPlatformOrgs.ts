import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { initFirebase } from '../infra/firebase';
import { getClaims, requireSuperAdmin } from '../infra/auth';

function serialize(value: any): any {
  if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serialize(entry)]));
  }
  return value;
}

function toMs(value: any): number {
  if (!value) return 0;
  if (value?.toMillis && typeof value.toMillis === 'function') return value.toMillis();
  if (value?.toDate && typeof value.toDate === 'function') return value.toDate().getTime();
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

export const listPlatformOrgs = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();
  const caller = getClaims(req);
  await requireSuperAdmin(caller);

  const max = Math.min(Math.max(Number(req.data?.limit || 250), 1), 500);

  try {
    const [orgsSnap, directorySnap] = await Promise.all([
      db.collection('orgs').limit(max).get(),
      db.collection('orgDirectory').limit(max).get(),
    ]);

    const byId = new Map<string, any>();

    for (const doc of directorySnap.docs) {
      const data = doc.data();
      byId.set(doc.id, { ...serialize(data), orgId: String(data.orgId || doc.id) });
    }

    for (const doc of orgsSnap.docs) {
      const data = doc.data();
      const orgId = String(data.orgId || doc.id);
      byId.set(orgId, { ...(byId.get(orgId) || {}), ...serialize(data), orgId });
    }

    const items = Array.from(byId.values())
      .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt) || String(a.name || a.orgId).localeCompare(String(b.name || b.orgId)))
      .slice(0, max);

    return { ok: true, items };
  } catch (e: any) {
    logger.error('listPlatformOrgs failed', e);
    throw new HttpsError('internal', 'Unable to load organizations.');
  }
});
