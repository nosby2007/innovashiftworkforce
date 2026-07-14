import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { getClaims, requireOrgAdminLike } from '../infra/auth';
import { writeAudit } from '../infra/audit';

export const adminRequestUserTransfer = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();
  const caller = getClaims(req);

  requireOrgAdminLike(caller);
  const callerOrgId = String(caller.orgId || '').trim();
  if (!callerOrgId) {
    throw new HttpsError('permission-denied', 'Caller has no organization scope.');
  }

  const uid = String(req.data?.uid || '').trim();
  const toOrgId = String(req.data?.toOrgId || '').trim();
  const reason = String(req.data?.reason || '').trim() || null;

  if (!uid) throw new HttpsError('invalid-argument', 'uid is required.');
  if (!toOrgId) throw new HttpsError('invalid-argument', 'toOrgId is required.');
  if (uid === caller.uid) throw new HttpsError('permission-denied', 'You cannot request transfer for your own account.');
  if (toOrgId === callerOrgId) throw new HttpsError('invalid-argument', 'Target organization must be different from the current organization.');

  const [authUser, rootSnap, targetOrgSnap] = await Promise.all([
    admin.auth().getUser(uid),
    db.doc(`users/${uid}`).get(),
    db.doc(`orgs/${toOrgId}`).get(),
  ]);

  if (!targetOrgSnap.exists) {
    throw new HttpsError('not-found', 'Target organization not found.');
  }

  const rootData: any = rootSnap.exists ? rootSnap.data() : {};
  const currentOrgId = String(rootData.orgId || '').trim();
  if (!currentOrgId || currentOrgId !== callerOrgId) {
    throw new HttpsError('permission-denied', 'User is not active in your organization.');
  }

  const now = Timestamp.now();
  const requestRef = db.collection('membershipTransferRequests').doc();
  await requestRef.set({
    requestId: requestRef.id,
    uid,
    userEmail: authUser.email ?? rootData.email ?? null,
    userDisplayName: authUser.displayName ?? rootData.displayName ?? null,
    fromOrgId: callerOrgId,
    toOrgId,
    accessRole: String(rootData.accessRole || '').trim() || 'staff',
    jobRole: String(rootData.jobRole || '').trim() || 'RN',
    requestedByUid: caller.uid,
    requestedByEmail: null,
    reason,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  await writeAudit(callerOrgId, {
    actorUserId: caller.uid,
    action: 'REQUEST_USER_TRANSFER',
    entityType: 'user',
    entityId: uid,
    targetOrgId: callerOrgId,
    requestedToOrgId: toOrgId,
    reason,
    requestId: requestRef.id,
  });

  return { ok: true, requestId: requestRef.id, status: 'pending' };
});
