import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';

/**
 * Deletes an erroneous time entry (e.g. a clock-in that should never have
 * been possible — a bug, a test artifact, a duplicate punch). Restricted to
 * 'admin' specifically, matching firestore.rules' own delete rule for this
 * collection (narrower than the general admin-like set, since this touches
 * payroll-relevant records). A reason is required and the full entry is
 * captured in the audit log before deletion, since the document itself
 * won't exist to inspect afterward.
 */
export const deleteTimeEntry = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();
  const ctx = await resolveTenantWithFallback(req);
  if (ctx.role !== 'admin' && !ctx.isSuperAdmin) {
    throw new HttpsError('permission-denied', 'Admin privileges required.');
  }

  const orgId = ctx.orgId;
  const entryId = String(req.data?.entryId || '').trim();
  const reason = String(req.data?.reason || '').trim();
  if (!entryId) throw new HttpsError('invalid-argument', 'entryId is required.');
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required to delete a time entry.');

  const ref = db.collection('orgs').doc(orgId).collection('timeEntries').doc(entryId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Time entry not found.');
  const data: any = snap.data() || {};

  const checkInMs = data.checkInAt?.toMillis ? data.checkInAt.toMillis() : null;
  if (checkInMs) {
    const entryDate = new Date(checkInMs).toISOString().slice(0, 10);
    const runsSnap = await db.collection('orgs').doc(orgId).collection('payrollRuns')
      .where('status', '==', 'finalized')
      .get();
    const isLocked = runsSnap.docs.some((doc) => {
      const r = doc.data() as any;
      return String(r.periodStart || '') <= entryDate && entryDate <= String(r.periodEnd || '');
    });
    if (isLocked) {
      throw new HttpsError('failed-precondition', 'This time entry falls within a finalized payroll period. Reopen that payroll run before deleting it.');
    }
  }

  await ref.delete();

  await writeAudit(orgId, {
    action: 'timeEntry.delete',
    actorUid: ctx.uid,
    target: { entryId },
    details: {
      userId: data.userId || null,
      shiftId: data.shiftId || null,
      checkInAt: data.checkInAt || null,
      checkOutAt: data.checkOutAt || null,
      reason,
    },
  });

  return { ok: true };
});
