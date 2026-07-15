import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { Timestamp } from 'firebase-admin/firestore';
import { resolveCompatibleAndAdminUids, notifyCompatibleStaffShiftAvailable } from '../infra/shift-available-notify';
import { actionTokenSecret } from '../infra/action-token';

export const publishShift = onCall({ secrets: [actionTokenSecret] }, async (req) => {
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
  let shiftTitle = '';
  let requiredJobRoles: unknown = null;
  let locationName = '';
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
    shiftTitle = String(s.title || 'Shift');
    requiredJobRoles = s.requiredJobRoles ?? s.requiredJobRole ?? null;
    locationName = String(s.locationName || '');
    const newStatus = publish ? 'published' : 'open';
    tx.update(ref, {
      status: newStatus,
      marketplaceVisible: publish,
      updatedAt: Timestamp.now(),
      updatedBy: ctx.uid,
    });
  });

  await writeAudit(ctx.orgId, { action: 'shift.publish', actorUid: ctx.uid, target: { shiftId }, details: { publish } });

  if (publish) {
    const { compatibleUids } = await resolveCompatibleAndAdminUids(db, ctx.orgId, { requiredJobRoles, excludeUid: ctx.uid });
    await notifyCompatibleStaffShiftAvailable(db, ctx.orgId, {
      shiftId,
      shiftTitle,
      body: locationName ? `"${shiftTitle}" at ${locationName} is available and matches your role.` : `"${shiftTitle}" is available and matches your role.`,
      compatibleUids,
      actorUid: ctx.uid,
      actionTokenSecretValue: actionTokenSecret.value(),
    });
  }

  return { ok: true, shiftId, publish };
});
