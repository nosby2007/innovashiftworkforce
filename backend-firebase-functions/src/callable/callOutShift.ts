import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { notifyShiftReopened } from '../infra/shift-reopen-notify';
import { actionTokenSecret } from '../infra/action-token';

const BLOCKED_STATUSES = new Set(['in_progress', 'completed', 'cancelled', 'expired', 'no_show']);

/**
 * Self-service call-out: an assigned employee who can't make their shift
 * unassigns themselves, the shift reopens on the marketplace, and
 * role-compatible staff + admins are notified. Unlike unassignShift.ts,
 * this is not admin-gated — the caller may only act on their own shift.
 */
export const callOutShift = onCall({ secrets: [actionTokenSecret] }, async (req) => {
  const ctx = await resolveTenantWithFallback(req);
  const admin = initFirebase();
  const db = admin.firestore();
  const orgId = ctx.orgId;

  const shiftId = String(req.data?.shiftId || '').trim();
  const reason = req.data?.reason != null ? String(req.data.reason).trim().slice(0, 500) || null : null;
  if (!shiftId) throw new HttpsError('invalid-argument', 'shiftId is required.');

  const shiftRef = db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId);

  let shiftTitle = '';
  let requiredJobRoles: unknown = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(shiftRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Shift not found.');
    const s = snap.data() as any;

    if (s.assignedUserId !== ctx.uid) {
      throw new HttpsError('permission-denied', 'You can only call out of your own shift.');
    }
    if (BLOCKED_STATUSES.has(String(s.status || ''))) {
      throw new HttpsError('failed-precondition', `Cannot call out: shift is ${s.status}.`);
    }

    shiftTitle = String(s.title || 'Shift');
    requiredJobRoles = s.requiredJobRoles ?? s.requiredJobRole ?? null;

    const now = Timestamp.now();
    tx.update(shiftRef, {
      status: 'published',
      assignedUserId: null,
      assignedUserName: null,
      assignedAt: null,
      assignedBy: null,
      claimedAt: null,
      marketplaceVisible: true,
      unassignedAt: now,
      updatedAt: now,
      updatedBy: ctx.uid,
      auditLog: FieldValue.arrayUnion({
        action: 'CALLED_OUT',
        actorUserId: ctx.uid,
        at: now,
        note: reason ? `Called out: ${reason}` : 'Called out.',
      }),
    });
  });

  const [orgUserSnap, rootUserSnap] = await Promise.all([
    db.collection('orgs').doc(orgId).collection('users').doc(ctx.uid).get(),
    db.collection('users').doc(ctx.uid).get(),
  ]);
  const orgUser = orgUserSnap.exists ? (orgUserSnap.data() as any) : null;
  const rootUser = rootUserSnap.exists ? (rootUserSnap.data() as any) : null;
  const vacatedUserName = String(orgUser?.displayName ?? rootUser?.displayName ?? orgUser?.email ?? rootUser?.email ?? '').trim() || null;

  const notifyResult = await notifyShiftReopened(db, orgId, {
    shiftId,
    shiftTitle,
    requiredJobRoles,
    reason: 'call_out',
    vacatedUserId: ctx.uid,
    vacatedUserName,
    actorUid: ctx.uid,
    actionTokenSecretValue: actionTokenSecret.value(),
  });

  await writeAudit(orgId, {
    action: 'shift.call_out',
    actorUid: ctx.uid,
    target: { shiftId },
    details: { reason, ...notifyResult },
  });

  return { ok: true, shiftId, ...notifyResult };
});
