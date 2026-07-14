import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { Timestamp } from 'firebase-admin/firestore';

export const unassignShift = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();

  const ctx = await resolveTenantWithFallback(req);
  if (!ctx.isAdminLike) {
    throw new HttpsError('permission-denied', 'Admin/Scheduler privileges required.');
  }
  const orgId = ctx.orgId;

  const shiftId = String(req.data?.shiftId || '').trim();
  if (!shiftId) throw new HttpsError('invalid-argument', 'shiftId is required.');

  const ref = db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Shift not found.');
    const s: any = snap.data() || {};
    if (s.status === 'completed' || s.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'Cannot unassign completed/cancelled shift.');
    }
    tx.update(ref, {
      status: 'open',
      assignedUserId: null,
      assignedUserName: null,
      assignedAt: null,
      assignedBy: null,
      claimedAt: null,
      marketplaceVisible: false,
      unassignedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      updatedBy: ctx.uid,
    });
  });

    await writeAudit(orgId, { action: 'shift.unassign', actorUid: ctx.uid, target: { shiftId } });

  return { ok: true, shiftId };
});
