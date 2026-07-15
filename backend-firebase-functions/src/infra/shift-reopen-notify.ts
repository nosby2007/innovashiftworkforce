import { Timestamp } from 'firebase-admin/firestore';
import { resolveCompatibleAndAdminUids, notifyCompatibleStaffShiftAvailable } from './shift-available-notify';
import { sendPushToUids } from './push';

const BATCH_CHUNK_SIZE = 400;

export type ShiftReopenReason = 'time_off' | 'call_out';

export interface NotifyShiftReopenedParams {
  shiftId: string;
  shiftTitle: string;
  requiredJobRoles?: unknown;
  reason: ShiftReopenReason;
  vacatedUserId: string;
  vacatedUserName?: string | null;
  actorUid: string;
  actionTokenSecretValue: string;
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
 * call-out. Notifies role-compatible staff (so they know to pick it up,
 * with a push "Accept" action) and admin-like staff (so they know a shift
 * needs coverage). Shared by decideTimeOffRequest.ts and callOutShift.ts so
 * both paths behave identically.
 */
export async function notifyShiftReopened(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  params: NotifyShiftReopenedParams
): Promise<{ notifiedCompatible: number; notifiedAdmins: number }> {
  const { shiftId, shiftTitle, requiredJobRoles, reason, vacatedUserId, vacatedUserName, actorUid, actionTokenSecretValue } = params;
  const now = Timestamp.now();
  const vacatedLabel = vacatedUserName?.trim() || 'A team member';

  const { compatibleUids, adminUids } = await resolveCompatibleAndAdminUids(db, orgId, {
    requiredJobRoles,
    excludeUid: vacatedUserId,
  });

  await notifyCompatibleStaffShiftAvailable(db, orgId, {
    shiftId,
    shiftTitle,
    body: `"${shiftTitle}" is back on the marketplace and matches your role.`,
    compatibleUids,
    actorUid,
    actionTokenSecretValue,
  });

  const adminWrites: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  for (const uid of adminUids) {
    const itemRef = db.collection('orgs').doc(orgId).collection('userNotifications').doc(uid).collection('items').doc();
    adminWrites.push((batch) => batch.set(itemRef, {
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
  if (adminWrites.length > 0) {
    await commitInChunks(db, adminWrites);
    await sendPushToUids(orgId, adminUids, {
      title: 'Shift needs coverage',
      body: `${vacatedLabel}'s shift "${shiftTitle}" reopened because of ${reasonLabel(reason)}.`,
      data: { type: 'shift_reopened_admin', shiftId, orgId, deepLink: '/app/admin/scheduler' },
      link: '/app/admin/scheduler',
    });
  }

  return { notifiedCompatible: compatibleUids.length, notifiedAdmins: adminUids.length };
}
