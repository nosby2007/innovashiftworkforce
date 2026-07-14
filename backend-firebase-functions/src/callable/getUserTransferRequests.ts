import { onCall } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { getClaims, requireSuperAdmin } from '../infra/auth';

function serializeTimestamp(value: any) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return value;
}

export const getUserTransferRequests = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();
  const caller = getClaims(req);
  await requireSuperAdmin(caller);

  const limit = Math.min(Number(req.data?.limit || 50), 100);
  const statusFilter = String(req.data?.status || 'pending').trim();

  const snap = await db.collection('membershipTransferRequests')
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  const items = snap.docs
    .map((doc) => {
      const data: any = doc.data();
      return {
        requestId: doc.id,
        ...data,
        createdAt: serializeTimestamp(data.createdAt),
        updatedAt: serializeTimestamp(data.updatedAt),
        reviewedAt: serializeTimestamp(data.reviewedAt),
      };
    })
    .filter((item) => !statusFilter || item.status === statusFilter);

  return items;
});
