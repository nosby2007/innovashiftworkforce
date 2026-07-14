import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { getClaims, requireSuperAdmin } from '../infra/auth';
import { writeAudit } from '../infra/audit';
import { runMembershipAction } from './adminManageUserMembership';

export const reviewUserTransferRequest = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();
  const caller = getClaims(req);
  await requireSuperAdmin(caller);

  const requestId = String(req.data?.requestId || '').trim();
  const decision = String(req.data?.decision || '').trim();
  const reviewNote = String(req.data?.reviewNote || '').trim() || null;

  if (!requestId) throw new HttpsError('invalid-argument', 'requestId is required.');
  if (!['approve', 'reject'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'decision must be approve or reject.');
  }

  const requestRef = db.doc(`membershipTransferRequests/${requestId}`);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    throw new HttpsError('not-found', 'Transfer request not found.');
  }

  const requestData: any = requestSnap.data();
  if (String(requestData.status || '').trim() !== 'pending') {
    throw new HttpsError('failed-precondition', 'Transfer request has already been reviewed.');
  }

  const now = Timestamp.now();

  if (decision === 'approve') {
    await runMembershipAction({
      admin,
      caller,
      callerIsSuper: true,
      uid: String(requestData.uid || '').trim(),
      action: 'transfer',
      fromOrgId: String(requestData.fromOrgId || '').trim(),
      toOrgId: String(requestData.toOrgId || '').trim(),
      accessRole: String(requestData.accessRole || '').trim() || 'staff',
      jobRole: String(requestData.jobRole || '').trim() || 'RN',
      reason: reviewNote || requestData.reason || null,
    });
  }

  await requestRef.set({
    status: decision === 'approve' ? 'approved' : 'rejected',
    reviewedAt: now,
    reviewedByUid: caller.uid,
    reviewNote,
    updatedAt: now,
  }, { merge: true });

  await writeAudit(String(requestData.fromOrgId || '').trim(), {
    actorUserId: caller.uid,
    action: decision === 'approve' ? 'APPROVE_USER_TRANSFER_REQUEST' : 'REJECT_USER_TRANSFER_REQUEST',
    entityType: 'membershipTransferRequest',
    entityId: requestId,
    targetOrgId: String(requestData.fromOrgId || '').trim(),
    requestedToOrgId: String(requestData.toOrgId || '').trim(),
    uid: String(requestData.uid || '').trim(),
    reviewNote,
  });

  return { ok: true, requestId, status: decision === 'approve' ? 'approved' : 'rejected' };
});
