import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { shiftRoleMatches } from '../domain/job-roles';
import { dayBoundsMs } from '../domain/dates';

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

/**
 * Transactionally assigns an open/published shift to a user. Shared by the
 * claimShift callable (in-app "pick up shift" button) and the signed-link
 * accept action fired from a push notification, so both paths enforce the
 * exact same eligibility rules.
 */
export async function claimShiftForUser(db: FirebaseFirestore.Firestore, orgId: string, uid: string, shiftId: string): Promise<{ shiftTitle: string }> {
  const ref = db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId);
  let shiftTitle = '';

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Shift not found.');
    const s = snap.data() as any;
    shiftTitle = String(s.title || '');

    if (!['open', 'published'].includes(s.status)) {
      if (s.status === 'expired') throw new HttpsError('failed-precondition', 'This shift has expired and is no longer available.');
      if (s.status === 'cancelled') throw new HttpsError('failed-precondition', 'This shift has been cancelled.');
      if (s.status === 'claimed' || s.status === 'assigned') throw new HttpsError('failed-precondition', 'This shift has already been claimed by another employee.');
      if (s.status === 'in_progress') throw new HttpsError('failed-precondition', 'This shift is already in progress.');
      if (s.status === 'completed') throw new HttpsError('failed-precondition', 'This shift is already completed.');
      throw new HttpsError('failed-precondition', 'Shift is not available for claiming.');
    }
    if (s.assignedUserId) throw new HttpsError('failed-precondition', 'This shift has already been claimed by another employee.');

    const now = Date.now();
    const endMs = s.endAt?.toMillis ? s.endAt.toMillis() : Number(s.endAt || 0);
    if (endMs > 0 && endMs < now) {
      throw new HttpsError('failed-precondition', 'This shift has already ended and cannot be claimed.');
    }

    const [orgUserSnap, rootUserSnap] = await Promise.all([
      tx.get(db.collection('orgs').doc(orgId).collection('users').doc(uid)),
      tx.get(db.collection('users').doc(uid)),
    ]);
    const orgUser = orgUserSnap.exists ? (orgUserSnap.data() as any) : null;
    const rootUser = rootUserSnap.exists ? (rootUserSnap.data() as any) : null;
    const userJobRole = String(orgUser?.jobRole ?? rootUser?.jobRole ?? '').trim();
    const displayName = String(orgUser?.displayName ?? rootUser?.displayName ?? orgUser?.name ?? rootUser?.name ?? '').trim();
    const email = String(orgUser?.email ?? rootUser?.email ?? '').trim();
    const assignedUserName = displayName || email || uid;

    if (!shiftRoleMatches(userJobRole, s.requiredJobRoles ?? s.requiredJobRole)) {
      throw new HttpsError('failed-precondition', `This shift requires ${Array.isArray(s.requiredJobRoles) && s.requiredJobRoles.length ? s.requiredJobRoles.join(', ') : String(s.requiredJobRole || 'a specific role')} role.`);
    }

    const startMs = s.startAt?.toMillis ? s.startAt.toMillis() : Number(s.startAt || 0);
    if (!startMs || !endMs || endMs <= startMs) {
      throw new HttpsError('failed-precondition', 'Invalid shift schedule.');
    }

    // A staff member with approved PTO/time-off overlapping this shift's
    // window must not be able to claim it in the first place — mirrors the
    // same guard checkInOut.ts enforces at clock-in time.
    const timeOffSnap = await tx.get(
      db.collection('orgs').doc(orgId).collection('requests')
        .where('userId', '==', uid)
        .limit(200)
    );
    for (const doc of timeOffSnap.docs) {
      const r = doc.data() as any;
      if (String(r.type || '') !== 'time_off' || String(r.status || '') !== 'approved') continue;
      const rStart = dayBoundsMs(String(r.startDate || ''), false);
      const rEnd = dayBoundsMs(String(r.endDate || r.startDate || ''), true);
      if (rStart && rEnd && startMs < rEnd && rStart < endMs) {
        throw new HttpsError('failed-precondition', 'You have approved time off during this shift and cannot claim it.');
      }
    }

    const targetDay = utcDayKeyFromMillis(startMs);
    let targetDayHours = durationHours(startMs, endMs);

    const myAssignedSnap = await tx.get(
      db.collection('orgs').doc(orgId).collection('shifts')
        .where('assignedUserId', '==', uid)
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
      actorUserId: uid,
      actorName: assignedUserName,
      at: Timestamp.now(),
      note: 'Shift claimed by employee.',
    };

    tx.update(ref, {
      assignedUserId: uid,
      assignedUserName,
      status: 'claimed',
      marketplaceVisible: false,
      claimedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      auditLog: FieldValue.arrayUnion(auditEntry),
    });
  });

  return { shiftTitle };
}
