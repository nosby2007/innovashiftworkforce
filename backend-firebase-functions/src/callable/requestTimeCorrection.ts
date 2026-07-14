import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

export const requestTimeCorrection = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();

  const ctx = await resolveTenantWithFallback(req);
  const orgId = ctx.orgId;

  const entryId = String(req.data?.entryId || '').trim();
  const reason = String(req.data?.reason || '').trim();
  const correctedCheckInAtMs = Number(req.data?.correctedCheckInAtMs || 0);
  const correctedCheckOutAtMs = Number(req.data?.correctedCheckOutAtMs || 0);

  if (!entryId) throw new HttpsError('invalid-argument', 'entryId is required.');
  if (!reason) throw new HttpsError('invalid-argument', 'reason is required.');
  if (correctedCheckInAtMs > 0 && correctedCheckOutAtMs > 0 && correctedCheckOutAtMs <= correctedCheckInAtMs) {
    throw new HttpsError('invalid-argument', 'correctedCheckOutAtMs must be after correctedCheckInAtMs.');
  }

  const ref = db.collection('orgs').doc(orgId).collection('timeEntries').doc(entryId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Time entry not found.');

    const entry = snap.data() as any;
    if (entry.userId !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Cannot request correction for another user.');
    }
    if (entry.exceptionStatus === 'pending') {
      throw new HttpsError('failed-precondition', 'A correction request is already pending for this entry.');
    }

    const requestedCheckInAt = correctedCheckInAtMs > 0 ? Timestamp.fromMillis(correctedCheckInAtMs) : null;
    const requestedCheckOutAt = correctedCheckOutAtMs > 0 ? Timestamp.fromMillis(correctedCheckOutAtMs) : null;
    const historyItem = {
      type: 'request',
      at: Timestamp.now(),
      actorUserId: ctx.uid,
      reason,
      previousCheckInAt: entry.checkInAt || null,
      previousCheckOutAt: entry.checkOutAt || null,
      requestedCheckInAt,
      requestedCheckOutAt,
    };

    const patch: any = {
      exceptionStatus: 'pending',
      correctionReason: reason,
      correctionRequestedBy: ctx.uid,
      correctionRequestedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      correctionHistory: FieldValue.arrayUnion(historyItem),
    };

    if (requestedCheckInAt) patch.requestedCheckInAt = requestedCheckInAt;
    if (requestedCheckOutAt) patch.requestedCheckOutAt = requestedCheckOutAt;

    tx.set(ref, patch, { merge: true });
  });

  await writeAudit(orgId, {
    actorUserId: ctx.uid,
    action: 'TIME_CORRECTION_REQUESTED',
    entityType: 'timeEntry',
    entityId: entryId,
    reason,
  });

  return { ok: true, entryId };
});
