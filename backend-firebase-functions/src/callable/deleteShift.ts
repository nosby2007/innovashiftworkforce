import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';

export const deleteShift = onCall(async (req) => {
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
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Shift not found.');

  const data: any = snap.data() || {};
  if (['in_progress', 'completed'].includes(String(data.status || '').trim())) {
    throw new HttpsError('failed-precondition', 'Cannot delete an in-progress or completed shift.');
  }

  await ref.delete();

  await writeAudit(orgId, {
    action: 'shift.delete',
    actorUid: ctx.uid,
    target: { shiftId },
    details: {
      assignedUserId: data.assignedUserId || null,
      title: data.title || null,
      status: data.status || null,
    },
  });

  return { ok: true, shiftId };
});