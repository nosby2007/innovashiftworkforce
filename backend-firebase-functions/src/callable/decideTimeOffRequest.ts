import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { toMillis, dayBoundsMs } from '../domain/dates';

const INACTIVE_SHIFT_STATUSES = new Set(['cancelled', 'completed', 'expired', 'no_show']);

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function normalizeBalance(data: any) {
  const balances = data?.balances || {};
  const taken = data?.taken || {};
  const planned = data?.planned || {};
  return {
    ptoBalance: num(data?.ptoBalance ?? balances?.pto ?? balances?.PTO),
    sickBalance: num(data?.sickBalance ?? balances?.sick ?? balances?.SICK),
    ptoTaken: num(data?.ptoTaken ?? taken?.pto ?? taken?.PTO),
    sickTaken: num(data?.sickTaken ?? taken?.sick ?? taken?.SICK),
    plannedPto: num(data?.plannedPto ?? planned?.pto ?? planned?.PTO),
    plannedSick: num(data?.plannedSick ?? planned?.sick ?? planned?.SICK),
  };
}

async function notifyUser(db: FirebaseFirestore.Firestore, orgId: string, uid: string, payload: {
  title: string;
  body: string;
  type?: string;
  createdBy: string;
  meta?: Record<string, unknown>;
}) {
  await db.collection('orgs').doc(orgId)
    .collection('userNotifications').doc(uid)
    .collection('items').doc()
    .set({
      orgId,
      uid,
      type: payload.type || 'time_off',
      title: payload.title,
      body: payload.body,
      read: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: payload.createdBy,
      meta: payload.meta || {},
    });
}

/**
 * Approves/rejects a PTO/sick/unpaid time-off request. Runs server-side (unlike
 * the legacy client transaction it replaces) because approval must also be able
 * to unassign+republish shifts, and orgs/{orgId}/shifts is Cloud-Function-only
 * per firestore.rules — a client transaction cannot write to it.
 */
export const decideTimeOffRequest = onCall(async (req) => {
  const ctx = await resolveTenantWithFallback(req);
  if (!ctx.isAdminLike) {
    throw new HttpsError('permission-denied', 'Admin/Scheduler privileges required.');
  }
  const admin = initFirebase();
  const db = admin.firestore();
  const orgId = ctx.orgId;

  const requestId = String(req.data?.requestId || '').trim();
  const decision = String(req.data?.decision || '').trim().toLowerCase();
  const managerNote = req.data?.managerNote != null
    ? (String(req.data.managerNote).trim().slice(0, 1000) || null)
    : null;
  const payRateInput = req.data?.payRate != null ? num(req.data.payRate) : null;
  const paidInput = req.data?.paid;

  if (!requestId) throw new HttpsError('invalid-argument', 'requestId is required.');
  if (!['approved', 'rejected'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'decision must be approved or rejected.');
  }

  const reqRef = db.collection('orgs').doc(orgId).collection('requests').doc(requestId);

  let userId = '';
  let requestType = '';
  let unassignedShifts: Array<{ id: string; title: string }> = [];

  await db.runTransaction(async (tx) => {
    // ---- reads (all reads must precede any writes in a Firestore transaction) ----
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists) throw new HttpsError('not-found', 'Time-off request not found.');
    const request = reqSnap.data() as any;
    if (String(request.type || '') !== 'time_off') {
      throw new HttpsError('failed-precondition', 'Not a time-off request.');
    }
    if (String(request.status || '') !== 'pending') {
      throw new HttpsError('failed-precondition', 'This request is no longer pending.');
    }

    userId = String(request.userId || '');
    requestType = String(request.requestType || 'pto');
    const hours = num(request.hours);
    const startDate = String(request.startDate || '');
    const endDate = String(request.endDate || startDate);

    const balRef = db.collection('orgs').doc(orgId).collection('accrualBalances').doc(userId);
    const balSnap = await tx.get(balRef);
    const current = normalizeBalance(balSnap.exists ? balSnap.data() : {});

    let candidateShiftDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    if (decision === 'approved' && userId) {
      const shiftsSnap = await tx.get(
        db.collection('orgs').doc(orgId).collection('shifts')
          .where('assignedUserId', '==', userId)
          .limit(200)
      );
      candidateShiftDocs = shiftsSnap.docs;
    }

    // ---- compute ----
    const startMs = dayBoundsMs(startDate, false);
    const endMs = dayBoundsMs(endDate, true);
    const shiftsToUnassign: Array<{ ref: FirebaseFirestore.DocumentReference; title: string }> = [];
    if (decision === 'approved' && startMs && endMs) {
      for (const doc of candidateShiftDocs) {
        const s = doc.data() as any;
        if (INACTIVE_SHIFT_STATUSES.has(String(s.status || '').trim())) continue;
        const sStart = toMillis(s.startAt);
        const sEnd = toMillis(s.endAt);
        if (!sStart || !sEnd) continue;
        const overlaps = sStart < endMs && startMs < sEnd;
        if (overlaps) shiftsToUnassign.push({ ref: doc.ref, title: String(s.title || 'Shift') });
      }
    }

    const paid = decision === 'approved' && requestType !== 'unpaid' && paidInput !== false;
    const payRate = num(payRateInput ?? request.payRate ?? 0);
    const now = Timestamp.now();

    // ---- writes ----
    tx.update(reqRef, {
      status: decision,
      managerNote,
      decidedAt: now,
      decidedBy: ctx.uid,
      updatedAt: now,
      paid,
      payRate: paid ? payRate : 0,
    });

    tx.set(db.collection('orgs').doc(orgId).collection('userRequests').doc(`${userId}_${requestId}`), {
      orgId,
      userId,
      requestId,
      type: 'time_off',
      status: decision,
      requestType,
      hours,
      paid,
      payRate: paid ? payRate : 0,
      updatedAt: now,
    }, { merge: true });

    if (decision === 'approved' && requestType !== 'unpaid') {
      const pto = requestType === 'pto';
      const next = {
        orgId,
        uid: userId,
        ptoBalance: pto ? Math.max(0, num(current.ptoBalance - hours)) : current.ptoBalance,
        sickBalance: !pto ? Math.max(0, num(current.sickBalance - hours)) : current.sickBalance,
        ptoTaken: pto ? num(current.ptoTaken + hours) : current.ptoTaken,
        sickTaken: !pto ? num(current.sickTaken + hours) : current.sickTaken,
        plannedPto: pto ? Math.max(0, num(current.plannedPto - hours)) : current.plannedPto,
        plannedSick: !pto ? Math.max(0, num(current.plannedSick - hours)) : current.plannedSick,
        updatedAt: now,
        asOf: now,
      };
      tx.set(balRef, next, { merge: true });
      tx.set(db.collection('orgs').doc(orgId).collection('accrualLedger').doc(), {
        orgId,
        userId,
        requestId,
        type: requestType,
        label: `${requestType.toUpperCase()} approved`,
        hours: -hours,
        balanceAfter: pto ? next.ptoBalance : next.sickBalance,
        source: 'time_off_approval',
        createdAt: now,
        createdBy: ctx.uid,
      });
    }

    for (const shift of shiftsToUnassign) {
      tx.update(shift.ref, {
        status: 'published',
        assignedUserId: null,
        assignedUserName: null,
        assignedAt: null,
        assignedBy: null,
        claimedAt: null,
        marketplaceVisible: true,
        unassignedAt: now,
        updatedAt: now,
        updatedBy: ctx.uid,
        auditLog: FieldValue.arrayUnion({
          action: 'PTO_UNASSIGNED',
          actorUserId: ctx.uid,
          at: now,
          note: 'Unassigned automatically: approved time off overlaps this shift.',
        }),
      });
    }

    unassignedShifts = shiftsToUnassign.map((s) => ({ id: s.ref.id, title: s.title }));
  });

  await notifyUser(db, orgId, userId, {
    title: decision === 'approved' ? 'Time-off approved' : 'Time-off declined',
    body: decision === 'approved'
      ? `Your ${requestType.toUpperCase()} request was approved.`
      : `Your ${requestType.toUpperCase()} request was declined.`,
    createdBy: ctx.uid,
    type: 'time_off_decision',
    meta: { requestId },
  });

  for (const shift of unassignedShifts) {
    await notifyUser(db, orgId, userId, {
      title: 'Shift removed from your schedule',
      body: `"${shift.title}" was unassigned because your approved time off overlaps it, and it's back in the marketplace.`,
      createdBy: ctx.uid,
      type: 'shift_unassigned_pto',
      meta: { requestId, shiftId: shift.id },
    });
  }

  await writeAudit(orgId, {
    action: 'pto.decide',
    actorUid: ctx.uid,
    target: { requestId, userId },
    details: { decision, unassignedShiftIds: unassignedShifts.map((s) => s.id) },
  });

  return { ok: true, requestId, decision, unassignedShiftIds: unassignedShifts.map((s) => s.id) };
});
