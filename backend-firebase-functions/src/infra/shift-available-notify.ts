import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { shiftRoleMatches } from '../domain/job-roles';
import { sendPushToUids } from './push';
import { signShiftActionToken } from './action-token';

const MAX_COMPATIBLE_RECIPIENTS = 300;
const BATCH_CHUNK_SIZE = 400;
const ADMIN_LIKE_ROLES = ['admin', 'manager', 'scheduler', 'hr'];

const FUNCTIONS_BASE_URL = process.env.FUNCTIONS_BASE_URL || 'https://us-east1-atlanta-e04aa.cloudfunctions.net';

export interface CompatibleAndAdminUids {
  compatibleUids: string[];
  adminUids: string[];
}

/**
 * Scans an org's active users once and splits them into staff whose job
 * role matches a shift's requirements and admin-like staff (who should
 * always know coverage is needed). Shared by the "new shift published" and
 * "shift reopened" notification paths so both use identical matching.
 */
export async function resolveCompatibleAndAdminUids(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  params: { requiredJobRoles?: unknown; excludeUid?: string }
): Promise<CompatibleAndAdminUids> {
  const usersSnap = await db.collection('orgs').doc(orgId).collection('users').get();

  const compatibleUids: string[] = [];
  const adminUids: string[] = [];
  for (const doc of usersSnap.docs) {
    if (doc.id === params.excludeUid) continue;
    const data = doc.data() as any;
    if (data?.active === false) continue;

    if (ADMIN_LIKE_ROLES.includes(String(data?.accessRole || ''))) {
      adminUids.push(doc.id);
    }
    if (shiftRoleMatches(data?.jobRole, params.requiredJobRoles)) {
      compatibleUids.push(doc.id);
    }
  }

  let notifyCompatibleUids = compatibleUids;
  if (compatibleUids.length > MAX_COMPATIBLE_RECIPIENTS) {
    logger.warn(`[shift-available-notify] compatible-staff list truncated for org ${orgId}: ${compatibleUids.length} matched, only notifying first ${MAX_COMPATIBLE_RECIPIENTS}.`);
    notifyCompatibleUids = compatibleUids.slice(0, MAX_COMPATIBLE_RECIPIENTS);
  }

  return { compatibleUids: notifyCompatibleUids, adminUids };
}

async function commitInChunks(db: FirebaseFirestore.Firestore, writes: Array<(batch: FirebaseFirestore.WriteBatch) => void>) {
  for (let i = 0; i < writes.length; i += BATCH_CHUNK_SIZE) {
    const batch = db.batch();
    for (const apply of writes.slice(i, i + BATCH_CHUNK_SIZE)) apply(batch);
    await batch.commit();
  }
}

export interface NotifyShiftAvailableParams {
  shiftId: string;
  shiftTitle: string;
  body: string;
  compatibleUids: string[];
  actorUid: string;
  actionTokenSecretValue: string;
}

/**
 * Writes the in-app "shift available" notification for each compatible
 * staff member and, best-effort, pushes it to their registered devices with
 * a one-tap "Accept" action backed by a per-recipient signed claim link.
 */
export async function notifyCompatibleStaffShiftAvailable(db: FirebaseFirestore.Firestore, orgId: string, params: NotifyShiftAvailableParams): Promise<void> {
  const { shiftId, shiftTitle, body, compatibleUids, actorUid, actionTokenSecretValue } = params;
  if (!compatibleUids.length) return;

  const now = Timestamp.now();
  const writes: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

  for (const uid of compatibleUids) {
    const itemRef = db.collection('orgs').doc(orgId).collection('userNotifications').doc(uid).collection('items').doc();
    writes.push((batch) => batch.set(itemRef, {
      orgId,
      uid,
      type: 'shift_available',
      title: 'Shift available',
      body,
      read: false,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUid,
      meta: { shiftId },
    }));
  }
  await commitInChunks(db, writes);

  await Promise.all(compatibleUids.map(async (uid) => {
    const acceptToken = signShiftActionToken({ orgId, uid, shiftId, action: 'claim' }, actionTokenSecretValue);
    const acceptUrl = `${FUNCTIONS_BASE_URL}/shiftActionFromNotification?t=${encodeURIComponent(acceptToken)}`;
    await sendPushToUids(orgId, [uid], {
      title: 'Shift available',
      body,
      data: { type: 'shift_available', shiftId, orgId, acceptUrl, deepLink: '/app/marketplace' },
      webActions: [{ action: 'accept', title: 'Accept' }, { action: 'view', title: 'View' }],
      link: '/app/marketplace',
    });
  }));
}
