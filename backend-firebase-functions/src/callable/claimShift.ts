import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { shiftRoleMatches } from '../domain/job-roles';

const MAX_ASSIGNED_HOURS_PER_DAY = 16;

function utcDayKeyFromMillis(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function durationHours(startMs: number, endMs: number): number {
  if (!startMs || !endMs || endMs <= startMs) return 0;
  return (endMs - startMs) / 3_600_000;
}

export const claimShift = onCall(async (req) => {
  const admin = initFirebase(); const db = admin.firestore();
  const ctx = await resolveTenantWithFallback(req);
  const orgId = ctx.orgId;
  const shiftId = String(req.data?.shiftId || ''); if (!shiftId) throw new HttpsError('invalid-argument', 'shiftId is required.');
  const ref = db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Shift not found.');
    const s = snap.data() as any;

    // Allow claiming only open/published shifts that have no assignee
    if (!['open', 'published'].includes(s.status)) {
      if (s.status === 'expired') throw new HttpsError('failed-precondition', 'This shift has expired and is no longer available.');
      if (s.status === 'cancelled') throw new HttpsError('failed-precondition', 'This shift has been cancelled.');
      if (s.status === 'claimed' || s.status === 'assigned') throw new HttpsError('failed-precondition', 'This shift has already been claimed by another employee.');
      if (s.status === 'in_progress') throw new HttpsError('failed-precondition', 'This shift is already in progress.');
      if (s.status === 'completed') throw new HttpsError('failed-precondition', 'This shift is already completed.');
      throw new HttpsError('failed-precondition', 'Shift is not available for claiming.');
    }
    if (s.assignedUserId) throw new HttpsError('failed-precondition', 'This shift has already been claimed by another employee.');

    // Reject claim if shift has already ended
    const now = Date.now();
    const endMs = s.endAt?.toMillis ? s.endAt.toMillis() : Number(s.endAt || 0);
    if (endMs > 0 && endMs < now) {
      throw new HttpsError('failed-precondition', 'This shift has already ended and cannot be claimed.');
    }

    const [orgUserSnap, rootUserSnap] = await Promise.all([
      tx.get(db.collection('orgs').doc(orgId).collection('users').doc(ctx.uid)),
      tx.get(db.collection('users').doc(ctx.uid)),
    ]);
    const orgUser = orgUserSnap.exists ? (orgUserSnap.data() as any) : null;
    const rootUser = rootUserSnap.exists ? (rootUserSnap.data() as any) : null;
    const userJobRole = String(orgUser?.jobRole ?? rootUser?.jobRole ?? '').trim();
    const displayName = String(orgUser?.displayName ?? rootUser?.displayName ?? orgUser?.name ?? rootUser?.name ?? '').trim();
    const email = String(orgUser?.email ?? rootUser?.email ?? '').trim();
    const assignedUserName = displayName || email || ctx.uid;

    if (!shiftRoleMatches(userJobRole, s.requiredJobRoles ?? s.requiredJobRole)) {
      throw new HttpsError('failed-precondition', `This shift requires ${Array.isArray(s.requiredJobRoles) && s.requiredJobRoles.length ? s.requiredJobRoles.join(', ') : String(s.requiredJobRole || 'a specific role')} role.`);
    }

    const startMs = s.startAt?.toMillis ? s.startAt.toMillis() : Number(s.startAt || 0);
    if (!startMs || !endMs || endMs <= startMs) {
      throw new HttpsError('failed-precondition', 'Invalid shift schedule.');
    }

    const targetDay = utcDayKeyFromMillis(startMs);
    let targetDayHours = durationHours(startMs, endMs);

    const myAssignedSnap = await tx.get(
      db.collection('orgs').doc(orgId).collection('shifts')
        .where('assignedUserId', '==', ctx.uid)
        .limit(200)
    );

    for (const doc of myAssignedSnap.docs) {
      if (doc.id === shiftId) continue;
      const other = doc.data() as any;
      if (['cancelled', 'completed', 'expired', 'no_show'].includes(other.status)) continue;

      const otherStart = other.startAt?.toMillis ? other.startAt.toMillis() : Number(other.startAt || 0);
      const otherEnd = other.endAt?.toMillis ? other.endAt.toMillis() : Number(other.endAt || 0);
      if (!otherStart || !otherEnd || otherEnd <= otherStart) continue;

      if (utcDayKeyFromMillis(otherStart) === targetDay) {
        targetDayHours += durationHours(otherStart, otherEnd);
      }

      const overlaps = startMs < otherEnd && endMs > otherStart;
      if (overlaps) {
        throw new HttpsError('failed-precondition', 'Cannot request a shift that overlaps an already assigned shift.');
      }
    }

    if (targetDayHours > MAX_ASSIGNED_HOURS_PER_DAY) {
      throw new HttpsError('failed-precondition', `Cannot request more than ${MAX_ASSIGNED_HOURS_PER_DAY} scheduled hours in one day.`);
    }

    const auditEntry = {
      action: 'CLAIMED',
      actorUserId: ctx.uid,
      actorName: assignedUserName,
      at: Timestamp.now(),
      note: 'Shift claimed by employee.',
    };

    tx.update(ref, {
      assignedUserId: ctx.uid,
      assignedUserName,
      status: 'claimed',
      marketplaceVisible: false,
      claimedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      auditLog: FieldValue.arrayUnion(auditEntry),
    });
  });

  await writeAudit(orgId, { actorUserId: ctx.uid, action: 'SHIFT_CLAIMED', entityType: 'shift', entityId: shiftId });
  return { ok: true };
});
