import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { shiftRoleMatches } from '../domain/job-roles';

const MAX_COMPATIBLE_RECIPIENTS = 300;
const BATCH_CHUNK_SIZE = 400;
const ADMIN_LIKE_ROLES = ['admin', 'manager', 'scheduler', 'hr'];

export type ShiftReopenReason = 'time_off' | 'call_out';

export interface NotifyShiftReopenedParams {
  shiftId: string;
  shiftTitle: string;
  requiredJobRoles?: unknown;
  reason: ShiftReopenReason;
  vacatedUserId: string;
  vacatedUserName?: string | null;
  actorUid: string;
}

function reasonLabel(reason: ShiftReopenReason): string {
  return reason === 'call_out' ? 'a call-out' : 'approved time off';
}

async function commitInChunks(db: FirebaseFirestore.Firestore, writes: Array<(batch: FirebaseFirestore.WriteBatch) => void>) {
  for (let i = 0; i < writes.length; i += BATCH_CHUNK_SIZE) {
    const batch = db.batch();
    for (const apply of writes.slice(i, i + BATCH_CHUNK_SIZE)) apply(batch);
    await batch.commit();
  }
}

/**
 * Fans out notifications when a shift is unassigned and reopened to the
 * marketplace — either via admin-approved time off or a self-service
 * call-out. Notifies role-compatible staff (so they know to pick it up)
 * and admin-like staff (so they know a shift needs coverage). Shared by
 * decideTimeOffRequest.ts and callOutShift.ts so both paths behave
 * identically.
 */
export async function notifyShiftReopened(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  params: NotifyShiftReopenedParams
): Promise<{ notifiedCompatible: number; notifiedAdmins: number }> {
  const { shiftId, shiftTitle, requiredJobRoles, reason, vacatedUserId, vacatedUserName, actorUid } = params;
  const now = Timestamp.now();
  const vacatedLabel = vacatedUserName?.trim() || 'A team member';

  const usersRef = db.collection('orgs').doc(orgId).collection('users');
  const usersSnap = await usersRef.get();

  const compatibleUids: string[] = [];
  const adminUids: string[] = [];
  for (const doc of usersSnap.docs) {
    if (doc.id === vacatedUserId) continue;
    const data = doc.data() as any;
    if (data?.active === false) continue;

    if (ADMIN_LIKE_ROLES.includes(String(data?.accessRole || ''))) {
      adminUids.push(doc.id);
    }
    if (shiftRoleMatches(data?.jobRole, requiredJobRoles)) {
      compatibleUids.push(doc.id);
    }
  }

  let truncated = false;
  let notifyCompatibleUids = compatibleUids;
  if (compatibleUids.length > MAX_COMPATIBLE_RECIPIENTS) {
    truncated = true;
    notifyCompatibleUids = compatibleUids.slice(0, MAX_COMPATIBLE_RECIPIENTS);
  }
  if (truncated) {
    logger.warn(`[notifyShiftReopened] compatible-staff notification truncated for org ${orgId}, shift ${shiftId}: ${compatibleUids.length} matched, only notifying first ${MAX_COMPATIBLE_RECIPIENTS}.`);
  }

  const writes: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

  for (const uid of notifyCompatibleUids) {
    const itemRef = db.collection('orgs').doc(orgId).collection('userNotifications').doc(uid).collection('items').doc();
    writes.push((batch) => batch.set(itemRef, {
      orgId,
      uid,
      type: 'shift_available',
      title: 'Shift available',
      body: `"${shiftTitle}" is back on the marketplace and matches your role.`,
      read: false,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUid,
      meta: { shiftId, reason },
    }));
  }

  for (const uid of adminUids) {
    const itemRef = db.collection('orgs').doc(orgId).collection('userNotifications').doc(uid).collection('items').doc();
    writes.push((batch) => batch.set(itemRef, {
      orgId,
      uid,
      type: 'shift_reopened_admin',
      title: 'Shift needs coverage',
      body: `${vacatedLabel}'s shift "${shiftTitle}" reopened because of ${reasonLabel(reason)}.`,
      read: false,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUid,
      meta: { shiftId, reason, vacatedUserId },
    }));
  }

  if (writes.length > 0) {
    await commitInChunks(db, writes);
  }

  return { notifiedCompatible: notifyCompatibleUids.length, notifiedAdmins: adminUids.length };
}
