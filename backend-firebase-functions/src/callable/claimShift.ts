import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { claimShiftForUser } from '../infra/claim-shift.core';

export const claimShift = onCall(async (req) => {
  const admin = initFirebase(); const db = admin.firestore();
  const ctx = await resolveTenantWithFallback(req);
  const orgId = ctx.orgId;
  const shiftId = String(req.data?.shiftId || ''); if (!shiftId) throw new HttpsError('invalid-argument', 'shiftId is required.');

  await claimShiftForUser(db, orgId, ctx.uid, shiftId);

  await writeAudit(orgId, { actorUserId: ctx.uid, action: 'SHIFT_CLAIMED', entityType: 'shift', entityId: shiftId });
  return { ok: true };
});
