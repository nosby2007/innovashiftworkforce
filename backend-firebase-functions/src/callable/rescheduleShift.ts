import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { Timestamp } from 'firebase-admin/firestore';

const MAX_ASSIGNED_HOURS_PER_DAY = 16;

function overlaps(aStart: any, aEnd: any, bStart: any, bEnd: any): boolean {
  const as = aStart?.toMillis ? aStart.toMillis() : Number(aStart);
  const ae = aEnd?.toMillis ? aEnd.toMillis() : Number(aEnd);
  const bs = bStart?.toMillis ? bStart.toMillis() : Number(bStart);
  const be = bEnd?.toMillis ? bEnd.toMillis() : Number(bEnd);
  return as < be && bs < ae;
}

function utcDayKeyFromMillis(ms: number): string {
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

export const rescheduleShift = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();

  const ctx = await resolveTenantWithFallback(req);
  if (!ctx.isAdminLike) {
    throw new HttpsError('permission-denied', 'Admin/Scheduler privileges required.');
  }
  const orgId = ctx.orgId;

  const shiftId = String(req.data?.shiftId || '').trim();
  const startAtMs = Number(req.data?.startAtMs || 0);
  const endAtMs = Number(req.data?.endAtMs || 0);

  if (!shiftId) throw new HttpsError('invalid-argument', 'shiftId is required.');
  if (!startAtMs || !endAtMs) throw new HttpsError('invalid-argument', 'startAtMs/endAtMs required.');
  if (endAtMs <= startAtMs) throw new HttpsError('invalid-argument', 'endAt must be after startAt.');

  const ref = db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Shift not found.');
    const s: any = snap.data() || {};
    if (s.status === 'completed' || s.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'Cannot reschedule completed/cancelled shift.');
    }

    const newStart = admin.firestore.Timestamp.fromMillis(startAtMs);
    const newEnd = admin.firestore.Timestamp.fromMillis(endAtMs);

    const assigneeUid = s.assignedUserId;
    if (assigneeUid) {
      const targetDay = utcDayKeyFromMillis(startAtMs);
      let targetDayHours = durationHours(newStart, newEnd);
      const q = db.collection('orgs').doc(orgId).collection('shifts')
        .where('assignedUserId', '==', assigneeUid)
        .limit(200);

      const qsnap = await tx.get(q);
      for (const d of qsnap.docs) {
        if (d.id === shiftId) continue;
        const other: any = d.data();
        if (!other?.startAt || !other?.endAt) continue;
        if (['cancelled', 'completed', 'expired', 'no_show'].includes(other.status)) continue;
        const otherStartMs = other.startAt?.toMillis ? other.startAt.toMillis() : Number(other.startAt || 0);
        if (otherStartMs && utcDayKeyFromMillis(otherStartMs) === targetDay) {
          targetDayHours += durationHours(other.startAt, other.endAt);
        }
        if (overlaps(newStart, newEnd, other.startAt, other.endAt)) {
          throw new HttpsError('failed-precondition', 'Overlap detected for assigned staff member.');
        }
      }

      if (targetDayHours > MAX_ASSIGNED_HOURS_PER_DAY) {
        throw new HttpsError('failed-precondition', `Reschedule would exceed ${MAX_ASSIGNED_HOURS_PER_DAY} scheduled hours for this staff member on that day.`);
      }
    }

    tx.update(ref, {
      startAt: newStart,
      endAt: newEnd,
      updatedAt: Timestamp.now(),
      updatedBy: ctx.uid,
    });
  });

  await writeAudit(orgId, {
    action: 'shift.reschedule',
    actorUid: ctx.uid,
    target: { shiftId },
    details: { startAtMs, endAtMs },
  });

  return { ok: true, shiftId };
});
