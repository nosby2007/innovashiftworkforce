import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { getClaims, requireSuperAdmin } from '../infra/auth';

const ALLOWED_STATUSES = new Set(['new', 'contacted', 'converted', 'dismissed']);

export const updateContactRequestStatus = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();
  const caller = getClaims(req);
  await requireSuperAdmin(caller);

  const requestId = String(req.data?.requestId || '').trim();
  const status = String(req.data?.status || '').trim();
  const convertedOrgId = req.data?.convertedOrgId ? String(req.data.convertedOrgId).trim() : null;
  if (!requestId) throw new HttpsError('invalid-argument', 'requestId is required.');
  if (!ALLOWED_STATUSES.has(status)) throw new HttpsError('invalid-argument', 'Invalid status.');

  const ref = db.collection('contactRequests').doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Demo request not found.');

  await ref.set({
    status,
    updatedAt: Timestamp.now(),
    reviewedBy: caller.uid,
    // Traceability from a lead back to the org it turned into — only set
    // when the caller actually created one (via Convert to Organization),
    // never inferred.
    ...(convertedOrgId ? { convertedOrgId } : {}),
  }, { merge: true });

  return { ok: true };
});
