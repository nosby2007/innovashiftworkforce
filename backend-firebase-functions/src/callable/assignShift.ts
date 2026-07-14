import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { Timestamp } from 'firebase-admin/firestore';
import { shiftRoleMatches } from '../domain/job-roles';

const MAX_ASSIGNED_HOURS_PER_DAY = 16;

function overlaps(aStart: any, aEnd: any, bStart: any, bEnd: any): boolean {
  const as = aStart?.toMillis ? aStart.toMillis() : Number(aStart);
  const ae = aEnd?.toMillis ? aEnd.toMillis() : Number(aEnd);
  const bs = bStart?.toMillis ? bStart.toMillis() : Number(bStart);
  const be = bEnd?.toMillis ? bEnd.toMillis() : Number(bEnd);
  return as < be && bs < ae;
}

function utcDayKeyFromTs(ts: any): string {
  const ms = ts?.toMillis ? ts.toMillis() : Number(ts || 0);
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function durationHours(startAt: any, endAt: any): number {
  const startMs = startAt?.toMillis ? startAt.toMillis() : Number(startAt || 0);
  const endMs = endAt?.toMillis ? endAt.toMillis() : Number(endAt || 0);
  if (!startMs || !endMs || endMs <= startMs) return 0;
  return (endMs - startMs) / 3_600_000;
}

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
    const [shiftSnap, userSnap] = await Promise.all([tx.get(shiftRef), tx.get(userRef)]);
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

    const startAt = s.startAt;
    const endAt = s.endAt;
    if (!startAt || !endAt) throw new HttpsError('failed-precondition', 'Shift startAt/endAt required.');

    const targetDay = utcDayKeyFromTs(startAt);
    let targetDayHours = durationHours(startAt, endAt);

    const q = db.collection('orgs').doc(orgId).collection('shifts')
      .where('assignedUserId', '==', assigneeUid)
      .limit(200);

    const qsnap = await tx.get(q);
    for (const d of qsnap.docs) {
      const other: any = d.data();
      if (d.id === shiftId) continue;
      if (!other?.startAt || !other?.endAt) continue;
      if (['cancelled', 'completed', 'expired', 'no_show'].includes(other.status)) continue;
      if (utcDayKeyFromTs(other.startAt) === targetDay) {
        targetDayHours += durationHours(other.startAt, other.endAt);
      }
      if (overlaps(startAt, endAt, other.startAt, other.endAt)) {
        throw new HttpsError('failed-precondition', 'Overlap detected for this staff member.');
      }
    }

    if (targetDayHours > MAX_ASSIGNED_HOURS_PER_DAY) {
      throw new HttpsError('failed-precondition', `Assignment would exceed ${MAX_ASSIGNED_HOURS_PER_DAY} scheduled hours for this staff member on that day.`);
    }

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
