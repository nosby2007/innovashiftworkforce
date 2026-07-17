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

/**
 * Demo requests submitted through the public Contact page (contactIntake)
 * land in a root-level `contactRequests` collection with no matching
 * firestore.rules entry, so the client can't read it directly — this
 * callable is the only way to see them, gated to super admins.
 */
export const listContactRequests = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();
  const caller = getClaims(req);
  await requireSuperAdmin(caller);

  const max = Math.min(Math.max(Number(req.data?.limit || 100), 1), 300);

  try {
    const snap = await db.collection('contactRequests').orderBy('createdAt', 'desc').limit(max).get();
    const items = snap.docs.map((doc) => ({ id: doc.id, ...serialize(doc.data()) }));
    return { ok: true, items };
  } catch (e: any) {
    logger.error('listContactRequests failed', e);
    throw new HttpsError('internal', 'Unable to load demo requests.');
  }
});
