import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

const DEFAULT_BREAK_REQUIRED_AFTER_HOURS = 6;
const DEFAULT_MIN_REQUIRED_BREAK_MINUTES = 30;

function toMillis(value: any): number {
  return value?.toMillis ? value.toMillis() : Number(value || 0);
}

export const approveTimeCorrection = onCall(async (req) => {
  const admin=initFirebase(); const db=admin.firestore();
  const ctx = await resolveTenantWithFallback(req);
  const orgId = ctx.orgId;
  if (!ctx.isAdminLike) throw new HttpsError('permission-denied', 'Admin-like required.');

  const entryId=String(req.data?.entryId||''); const decision=String(req.data?.decision||'');
  if(!entryId) throw new HttpsError('invalid-argument','entryId is required.');
  if(!['approved','rejected'].includes(decision)) throw new HttpsError('invalid-argument','decision must be approved or rejected.');
  const decisionReason = String(req.data?.decisionReason || '').trim();
  const force = !!req.data?.force;

  const correctedCheckInAtMs = Number(req.data?.correctedCheckInAtMs || 0);
  const correctedCheckOutAtMs = Number(req.data?.correctedCheckOutAtMs || 0);
  if (correctedCheckInAtMs > 0 && correctedCheckOutAtMs > 0 && correctedCheckOutAtMs <= correctedCheckInAtMs) {
    throw new HttpsError('invalid-argument', 'correctedCheckOutAtMs must be after correctedCheckInAtMs.');
  }

  const ref = db.collection('orgs').doc(orgId).collection('timeEntries').doc(entryId);
  const orgSnap = await db.collection('orgs').doc(orgId).get();
  const org = orgSnap.exists ? (orgSnap.data() as any) : {};
  const breakRequiredAfterHours = Number(org?.breakRequiredAfterHours || DEFAULT_BREAK_REQUIRED_AFTER_HOURS);
  const minRequiredBreakMinutes = Math.max(
    DEFAULT_MIN_REQUIRED_BREAK_MINUTES,
    Number(org?.minRequiredBreakMinutes || DEFAULT_MIN_REQUIRED_BREAK_MINUTES)
  );
  let resolvedShiftId = '';
  let resolvedUserId = '';
  let resolvedCheckOut: FirebaseFirestore.Timestamp | null = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Time entry not found.');

    const entry = snap.data() as any;
    resolvedShiftId = String(entry.shiftId || '').trim();
    resolvedUserId = String(entry.userId || '').trim();
    if (entry.exceptionStatus !== 'pending' && !force) {
      throw new HttpsError('failed-precondition', 'Only pending correction requests can be decided.');
    }

    const now = Timestamp.now();
    const prevCheckIn = entry.checkInAt || null;
    const prevCheckOut = entry.checkOutAt || null;

    let newCheckIn = prevCheckIn;
    let newCheckOut = prevCheckOut;

    if (decision === 'approved') {
      if (correctedCheckInAtMs > 0) newCheckIn = Timestamp.fromMillis(correctedCheckInAtMs);
      else if (entry.requestedCheckInAt) newCheckIn = entry.requestedCheckInAt;

      if (correctedCheckOutAtMs > 0) newCheckOut = Timestamp.fromMillis(correctedCheckOutAtMs);
      else if (entry.requestedCheckOutAt) newCheckOut = entry.requestedCheckOutAt;

      const inMs = newCheckIn?.toMillis ? newCheckIn.toMillis() : Number(newCheckIn || 0);
      const outMs = newCheckOut?.toMillis ? newCheckOut.toMillis() : Number(newCheckOut || 0);
      if (inMs > 0 && outMs > 0 && outMs <= inMs) {
        throw new HttpsError('invalid-argument', 'Resolved check-out must be after check-in.');
      }
      resolvedCheckOut = newCheckOut || null;
    }

    const decisionRecord = {
      decision,
      decidedBy: ctx.uid,
      decidedAt: now,
      decisionReason: decisionReason || null,
      previousCheckInAt: prevCheckIn,
      previousCheckOutAt: prevCheckOut,
      newCheckInAt: decision === 'approved' ? (newCheckIn || null) : prevCheckIn,
      newCheckOutAt: decision === 'approved' ? (newCheckOut || null) : prevCheckOut,
    };

    const patch: any = {
      exceptionStatus: decision,
      approvedBy: ctx.uid,
      approvedAt: now,
      updatedAt: now,
      correctionLastDecision: decisionRecord,
      correctionHistory: FieldValue.arrayUnion({
        type: 'decision',
        at: now,
        actorUserId: ctx.uid,
        decision,
        reason: decisionReason || null,
        previousCheckInAt: prevCheckIn,
        previousCheckOutAt: prevCheckOut,
        newCheckInAt: decision === 'approved' ? (newCheckIn || null) : prevCheckIn,
        newCheckOutAt: decision === 'approved' ? (newCheckOut || null) : prevCheckOut,
      }),
    };

    if (decision === 'approved') {
      patch.checkInAt = newCheckIn;
      patch.checkOutAt = newCheckOut;

      // If an admin correction closes the day, the entry must no longer remain
      // in a break state or keep an open break marker.
      if (newCheckOut) {
        patch.onBreak = false;
        patch.breakStartedAt = null;

        const checkInMs = toMillis(newCheckIn);
        const breakStartedMs = toMillis(entry.breakStartedAt);
        const checkOutMs = newCheckOut.toMillis();
        let resolvedBreakMs = Math.max(0, Number(entry.totalBreakMs || 0));
        let openBreakClosedMs = 0;
        let autoBreakDeductionMs = 0;

        if (entry.onBreak && breakStartedMs > 0 && checkOutMs >= breakStartedMs) {
          openBreakClosedMs = Math.max(0, checkOutMs - breakStartedMs);
          resolvedBreakMs += openBreakClosedMs;
        }

        if (checkInMs > 0 && checkOutMs > checkInMs) {
          const grossWorkedMs = Math.max(0, checkOutMs - checkInMs);
          const requiredThresholdMs = Math.max(1, breakRequiredAfterHours) * 60 * 60 * 1000;
          const minBreakMs = Math.max(1, minRequiredBreakMinutes) * 60 * 1000;
          if (grossWorkedMs >= requiredThresholdMs && resolvedBreakMs < minBreakMs) {
            autoBreakDeductionMs = minBreakMs - resolvedBreakMs;
            resolvedBreakMs += autoBreakDeductionMs;
          }
        }

        patch.totalBreakMs = resolvedBreakMs;
        if (openBreakClosedMs > 0 || autoBreakDeductionMs > 0) {
          patch.breakPolicyLastAppliedAt = now;
          patch.breakPolicyHistory = FieldValue.arrayUnion({
            type: 'correction_break_policy',
            at: now,
            actorUserId: ctx.uid,
            thresholdHours: Math.max(1, breakRequiredAfterHours),
            minimumBreakMinutes: Math.max(1, minRequiredBreakMinutes),
            openBreakClosedMs,
            autoBreakDeductionMs,
            totalBreakMs: resolvedBreakMs,
            note: autoBreakDeductionMs > 0
              ? 'Automatic meal break deduction applied during admin correction.'
              : 'Open break was closed during admin correction.',
          });
        }
      }
    }

    tx.set(ref, patch, { merge: true });
  });

  if (decision === 'approved' && resolvedShiftId && resolvedUserId && resolvedCheckOut) {
    const shiftRef = db.collection('orgs').doc(orgId).collection('shifts').doc(resolvedShiftId);
    const shiftSnap = await shiftRef.get();
    if (shiftSnap.exists) {
      const shift = shiftSnap.data() as any;
      if (String(shift.assignedUserId || '').trim() === resolvedUserId && String(shift.status || '').trim() === 'in_progress') {
        await shiftRef.set({
          status: 'completed',
          clockOutAt: resolvedCheckOut,
          updatedAt: Timestamp.now(),
          auditLog: FieldValue.arrayUnion({
            action: 'CLOCKED_OUT_BY_CORRECTION',
            actorUserId: ctx.uid,
            at: Timestamp.now(),
            note: `Shift closed from approved time correction. TimeEntry: ${entryId}`,
          }),
        }, { merge: true });
      }
    }
  }

  await writeAudit(orgId,{
    actorUserId: ctx.uid,
    action:'TIME_CORRECTION_DECISION',
    entityType:'timeEntry',
    entityId: entryId,
    decision,
    decisionReason: decisionReason || null,
  });
  return { ok:true };
});
