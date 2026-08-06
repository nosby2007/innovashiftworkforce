import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { Timestamp } from 'firebase-admin/firestore';
import { shiftRoleMatches } from '../domain/job-roles';
import { toMillis } from '../domain/dates';
import { checkShiftEligibility, computeFatigueWindowMs, resolveFatigueRules, ShiftSlice } from '../domain/shift-eligibility';

export const assignShift = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();

  const ctx = await resolveTenantWithFallback(req);
  if (!ctx.isAdminLike) {
    throw new HttpsError('permission-denied', 'Admin/Scheduler privileges required.');
  }
  const orgId = ctx.orgId;

  const shiftId = String(req.data?.shiftId || '').trim();
  const assigneeUid = String(req.data?.assigneeUid || '').trim();

  if (!shiftId) throw new HttpsError('invalid-argument', 'shiftId is required.');
  if (!assigneeUid) throw new HttpsError('invalid-argument', 'assigneeUid is required.');

  const shiftRef = db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId);
  const userRef  = db.collection('orgs').doc(orgId).collection('users').doc(assigneeUid);

  await db.runTransaction(async (tx) => {
    const orgRef = db.collection('orgs').doc(orgId);
    const [shiftSnap, userSnap, orgSnap] = await Promise.all([tx.get(shiftRef), tx.get(userRef), tx.get(orgRef)]);
    if (!shiftSnap.exists) throw new HttpsError('not-found', 'Shift not found.');
    if (!userSnap.exists) throw new HttpsError('not-found', 'Assignee not found in org.');

    const s: any = shiftSnap.data() || {};
    const userData: any = userSnap.data() || {};
    if (s.status === 'cancelled' || s.status === 'completed') {
      throw new HttpsError('failed-precondition', 'Cannot assign completed/cancelled shift.');
    }

    if (!shiftRoleMatches(userData.jobRole, s.requiredJobRoles ?? s.requiredJobRole)) {
      throw new HttpsError('failed-precondition', `This shift requires ${Array.isArray(s.requiredJobRoles) && s.requiredJobRoles.length ? s.requiredJobRoles.join(', ') : String(s.requiredJobRole || 'a specific role')} role.`);
    }

    const startMs = toMillis(s.startAt);
    const endMs = toMillis(s.endAt);
    if (!startMs || !endMs || endMs <= startMs) throw new HttpsError('failed-precondition', 'Shift startAt/endAt required.');

    const rules = resolveFatigueRules(orgSnap.exists ? orgSnap.data() : null);
    const { windowStartMs, windowEndMs } = computeFatigueWindowMs(startMs, rules);

    const qsnap = await tx.get(
      db.collection('orgs').doc(orgId).collection('shifts')
        .where('assignedUserId', '==', assigneeUid)
        .where('startAt', '>=', Timestamp.fromMillis(windowStartMs))
        .where('startAt', '<', Timestamp.fromMillis(windowEndMs))
        .limit(500)
    );
    const otherShifts: ShiftSlice[] = qsnap.docs.map((d) => {
      const other: any = d.data();
      return { id: d.id, startAtMs: toMillis(other.startAt), endAtMs: toMillis(other.endAt), status: String(other.status || '') };
    });

    const violation = checkShiftEligibility({
      targetShift: { id: shiftId, startAtMs: startMs, endAtMs: endMs },
      otherShifts,
      rules,
      personLabel: 'This staff member',
    });
    if (violation) throw new HttpsError('failed-precondition', violation.message);

    const assignedUserName = String(userData.displayName || userData.email || userData.name || assigneeUid).trim();

    tx.update(shiftRef, {
      status: 'assigned',
      assignedUserId: assigneeUid,
      assignedUserName,
      assignedAt: Timestamp.now(),
      assignedBy: ctx.uid,
      marketplaceVisible: false,
      updatedAt: Timestamp.now(),
      updatedBy: ctx.uid,
    });
  });

  // Create targeted notification (outside transaction)
  const notifRef = db.collection('orgs').doc(orgId)
    .collection('userNotifications').doc(assigneeUid)
    .collection('items').doc();

  await notifRef.set({
    orgId,
    uid: assigneeUid,
    type: 'shift-assigned',
    title: 'New shift assigned',
    body: `A shift has been assigned to you (ShiftId: ${shiftId}).`,
    read: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    createdBy: ctx.uid,
    meta: { shiftId },
  });

    await writeAudit(orgId, { action: 'shift.assign', actorUid: ctx.uid, target: { shiftId }, details: { assigneeUid } });

  return { ok: true, shiftId, assigneeUid };
});
