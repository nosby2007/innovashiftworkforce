import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { Timestamp } from 'firebase-admin/firestore';

export const publishShift = onCall(async (req) => {
  const ctx = await resolveTenantWithFallback(req);
  if (!ctx.isAdminLike) {
    throw new HttpsError('permission-denied', 'Admin/Scheduler privileges required.');
  }
  const admin = initFirebase();
  const db = admin.firestore();

  const shiftId = String(req.data?.shiftId || '').trim();
  const publish = Boolean(req.data?.publish);

  if (!shiftId) throw new HttpsError('invalid-argument', 'shiftId is required.');

  const ref = db.collection('orgs').doc(ctx.orgId).collection('shifts').doc(shiftId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Shift not found.');
    const s: any = snap.data() || {};
    if (s.status === 'cancelled' || s.status === 'completed') {
      throw new HttpsError('failed-precondition', 'Cannot publish completed/cancelled shift.');
    }
    if (s.assignedUserId || ['assigned', 'claimed', 'in_progress'].includes(String(s.status || '').trim())) {
      throw new HttpsError('failed-precondition', 'Assigned or in-progress shifts cannot be published or unpublished.');
    }
    if (!['draft', 'open', 'published'].includes(String(s.status || '').trim())) {
      throw new HttpsError('failed-precondition', 'Shift status is not publishable.');
    }
    const newStatus = publish ? 'published' : 'open';
    tx.update(ref, {
      status: newStatus,
      marketplaceVisible: publish,
      updatedAt: Timestamp.now(),
      updatedBy: ctx.uid,
    });
  });

  await writeAudit(ctx.orgId, { action: 'shift.publish', actorUid: ctx.uid, target: { shiftId }, details: { publish } });

  return { ok: true, shiftId, publish };
});
