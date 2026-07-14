import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { getClaims, requireOrgAdminLike, requireSuperAdmin } from '../infra/auth';
import { writeAudit } from '../infra/audit';

export const reviewEmployeeDocument = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();
  const caller = getClaims(req);

  const orgId = String(req.data?.orgId || '').trim();
  const documentId = String(req.data?.documentId || '').trim();
  const decision = String(req.data?.decision || '').trim();
  const reviewNote = String(req.data?.reviewNote || '').trim() || null;

  if (!orgId) throw new HttpsError('invalid-argument', 'orgId is required.');
  if (!documentId) throw new HttpsError('invalid-argument', 'documentId is required.');
  if (!['verified', 'rejected'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'decision must be verified or rejected.');
  }

  let callerIsSuper = false;
  try {
    await requireSuperAdmin(caller);
    callerIsSuper = true;
  } catch {
    callerIsSuper = false;
  }

  if (!callerIsSuper) {
    requireOrgAdminLike(caller);
    if (String(caller.orgId || '').trim() !== orgId) {
      throw new HttpsError('permission-denied', 'Cross-organization document review is not allowed.');
    }
  }

  const ref = db.doc(`orgs/${orgId}/employeeDocuments/${documentId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Employee document not found.');

  const data: any = snap.data() || {};
  const now = Timestamp.now();
  await ref.set({
    status: decision,
    reviewedAt: now,
    reviewedBy: caller.uid,
    reviewNote,
    updatedAt: now,
  }, { merge: true });

  await writeAudit(orgId, {
    actorUserId: caller.uid,
    action: decision === 'verified' ? 'DOCUMENT_VERIFIED' : 'DOCUMENT_REJECTED',
    entityType: 'employeeDocument',
    entityId: documentId,
    targetUserId: data.userId || null,
    targetUserName: data.userDisplayName || data.userEmail || null,
    documentType: data.type || null,
    documentTitle: data.title || null,
    reviewNote,
  });

  return { ok: true, status: decision };
});
