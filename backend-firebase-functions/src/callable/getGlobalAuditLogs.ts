import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { initFirebase } from '../infra/firebase';
import { getClaims, requireSuperAdmin } from '../infra/auth';

export const getGlobalAuditLogs = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();
  const caller = getClaims(req);

  // Strict check: only Super Admins can access platform-wide logs
  await requireSuperAdmin(caller);

  const limit = Math.min(Number(req.data?.limit || 50), 100);

  try {
    // Collection Group query allows us to search across all 'auditLogs' subcollections
    const snap = await db.collectionGroup('auditLogs')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return snap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        orgId: doc.ref.parent.parent?.id, // Get the parent orgId
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
      };
    });
  } catch (e: any) {
    logger.error('Error fetching global audit logs:', e);
    const code = String(e?.code ?? '').trim();
    const message = String(e?.message ?? '').trim();

    if (code === 'permission-denied' || code === '7' || message.includes('Missing or insufficient permissions')) {
      throw new HttpsError('permission-denied', 'Super admin privileges required.');
    }

    if (message.includes('index') || code === 'failed-precondition') {
      throw new HttpsError('failed-precondition', message || 'Firestore index required.');
    }

    throw new HttpsError('internal', 'Failed to fetch global audit logs.');
  }
});
