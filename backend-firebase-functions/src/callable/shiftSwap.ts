import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { shiftRoleMatches } from '../domain/job-roles';
import { scoreSwapCandidate } from '../domain/swap-match';
import { toMillis } from '../domain/dates';
import { checkShiftEligibility, computeFatigueWindowMs, resolveFatigueRules, FatigueRules, ShiftSlice } from '../domain/shift-eligibility';

const ACTIVE_SHIFT_STATUSES = new Set(['assigned', 'claimed']);

function personName(user: any, uid: string): string {
  return String(user?.displayName || user?.email || user?.name || uid).trim();
}

function serializeShift(id: string, s: any) {
  return {
    id,
    title: String(s?.title || 'Shift'),
    status: String(s?.status || ''),
    locationName: String(s?.locationName || ''),
    requiredJobRole: s?.requiredJobRole ?? null,
    requiredJobRoles: Array.isArray(s?.requiredJobRoles) ? s.requiredJobRoles : [],
    startAtMs: toMillis(s?.startAt),
    endAtMs: toMillis(s?.endAt),
  };
}

function serializeRequest(id: string, r: any) {
  return {
    requestId: id,
    orgId: String(r?.orgId || ''),
    status: String(r?.status || ''),
    kind: String(r?.kind || 'cover'),
    shiftId: String(r?.shiftId || ''),
    shiftTitle: String(r?.shiftTitle || 'Shift'),
    shiftLocationName: String(r?.shiftLocationName || ''),
    sourceStartAtMs: toMillis(r?.sourceStartAt),
    sourceEndAtMs: toMillis(r?.sourceEndAt),
    requesterUid: String(r?.requesterUid || ''),
    requesterName: String(r?.requesterName || ''),
    targetUid: String(r?.targetUid || ''),
    targetName: String(r?.targetName || ''),
    targetShiftId: r?.targetShiftId ? String(r.targetShiftId) : null,
    targetShiftTitle: r?.targetShiftTitle ? String(r.targetShiftTitle) : null,
    targetShiftLocationName: r?.targetShiftLocationName ? String(r.targetShiftLocationName) : null,
    targetStartAtMs: toMillis(r?.targetStartAt),
    targetEndAtMs: toMillis(r?.targetEndAt),
    note: r?.note ? String(r.note) : null,
    decision: r?.decision ? String(r.decision) : null,
    decisionNote: r?.decisionNote ? String(r.decisionNote) : null,
    createdAtMs: toMillis(r?.createdAt),
    updatedAtMs: toMillis(r?.updatedAt),
    respondedAtMs: toMillis(r?.respondedAt),
    respondedBy: r?.respondedBy ? String(r.respondedBy) : null,
  };
}

async function notifyUser(db: any, orgId: string, uid: string, payload: {
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
      type: payload.type || 'shift_swap',
      title: payload.title,
      body: payload.body,
      read: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: payload.createdBy,
      meta: payload.meta || {},
    });
}

async function assertUserCanTakeShift(
  tx: any,
  db: any,
  orgId: string,
  uid: string,
  userData: any,
  shiftId: string,
  shift: any,
  excludedShiftIds: Set<string>,
  rules: FatigueRules,
) {
  if (!userData || userData.active === false) {
    throw new HttpsError('failed-precondition', 'Target staff member is inactive or unavailable.');
  }

  const jobRole = String(userData?.jobRole || '').trim();
  if (!shiftRoleMatches(jobRole, shift?.requiredJobRoles ?? shift?.requiredJobRole)) {
    throw new HttpsError('failed-precondition', `${personName(userData, uid)} does not match the required role for this shift.`);
  }

  const startMs = toMillis(shift?.startAt);
  const endMs = toMillis(shift?.endAt);
  if (!startMs || !endMs || endMs <= startMs) {
    throw new HttpsError('failed-precondition', 'Shift has an invalid schedule.');
  }

  const { windowStartMs, windowEndMs } = computeFatigueWindowMs(startMs, rules);

  const assignedSnap = await tx.get(
    db.collection('orgs').doc(orgId).collection('shifts')
      .where('assignedUserId', '==', uid)
      .where('startAt', '>=', Timestamp.fromMillis(windowStartMs))
      .where('startAt', '<', Timestamp.fromMillis(windowEndMs))
      .limit(500)
  );
  const otherShifts: ShiftSlice[] = assignedSnap.docs.map((doc: any) => {
    const other: any = doc.data();
    return { id: doc.id, startAtMs: toMillis(other.startAt), endAtMs: toMillis(other.endAt), status: String(other.status || '') };
  });

  const violation = checkShiftEligibility({
    targetShift: { id: shiftId, startAtMs: startMs, endAtMs: endMs },
    otherShifts,
    excludedShiftIds,
    rules,
    personLabel: personName(userData, uid),
  });
  if (violation) throw new HttpsError('failed-precondition', violation.message);

  return { shiftId, startMs, endMs };
}

export const listShiftSwapCandidates = onCall(async (req) => {
  const ctx = await resolveTenantWithFallback(req);
  const admin = initFirebase();
  const db = admin.firestore();
  const orgId = ctx.orgId;

  const shiftId = String(req.data?.shiftId || '').trim();
  if (!shiftId) throw new HttpsError('invalid-argument', 'shiftId is required.');

  const shiftRef = db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId);
  const shiftSnap = await shiftRef.get();
  if (!shiftSnap.exists) throw new HttpsError('not-found', 'Shift not found.');
  const source = shiftSnap.data() as any;

  if (source.assignedUserId !== ctx.uid && !ctx.isAdminLike) {
    throw new HttpsError('permission-denied', 'You can only switch your own assigned shifts.');
  }
  if (!ACTIVE_SHIFT_STATUSES.has(String(source.status || '').trim())) {
    throw new HttpsError('failed-precondition', 'Only assigned or claimed shifts can be switched.');
  }

  const requesterSnap = await db.collection('orgs').doc(orgId).collection('users').doc(String(source.assignedUserId || ctx.uid)).get();
  const requester = requesterSnap.exists ? requesterSnap.data() as any : {};
  const requesterJobRole = String(requester?.jobRole || '').trim();

  const [usersSnap, shiftsSnap, orgSnap] = await Promise.all([
    db.collection('orgs').doc(orgId).collection('users').limit(1000).get(),
    db.collection('orgs').doc(orgId).collection('shifts')
      .where('startAt', '>=', Timestamp.fromMillis(Date.now()))
      .where('startAt', '<=', Timestamp.fromMillis(Date.now() + 45 * 24 * 60 * 60 * 1000))
      .orderBy('startAt', 'asc')
      .limit(1000)
      .get(),
    db.collection('orgs').doc(orgId).get(),
  ]);
  const rules = resolveFatigueRules(orgSnap.exists ? orgSnap.data() : null);

  const futureShiftsByUid = new Map<string, Array<ReturnType<typeof serializeShift>>>();
  for (const doc of shiftsSnap.docs) {
    if (doc.id === shiftId) continue;
    const s = doc.data() as any;
    const assignedUserId = String(s?.assignedUserId || '').trim();
    if (!assignedUserId) continue;
    if (!ACTIVE_SHIFT_STATUSES.has(String(s?.status || '').trim())) continue;
    if (!shiftRoleMatches(requesterJobRole, s.requiredJobRoles ?? s.requiredJobRole)) continue;
    const list = futureShiftsByUid.get(assignedUserId) || [];
    list.push(serializeShift(doc.id, s));
    futureShiftsByUid.set(assignedUserId, list);
  }

  const sourceSlice = { startAtMs: toMillis(source.startAt), endAtMs: toMillis(source.endAt) };

  const candidates = usersSnap.docs
    .filter((doc) => doc.id !== String(source.assignedUserId || ctx.uid))
    .map((doc) => {
      const user = doc.data() as any;
      const shifts = futureShiftsByUid.get(doc.id) || [];
      return {
        uid: doc.id,
        displayName: personName(user, doc.id),
        email: user?.email || null,
        jobRole: user?.jobRole || null,
        active: user?.active !== false,
        canCoverSource: user?.active !== false && shiftRoleMatches(user?.jobRole, source.requiredJobRoles ?? source.requiredJobRole),
        shifts,
        match: scoreSwapCandidate(sourceSlice, shifts, rules.minRestHours),
      };
    })
    .filter((user) => user.canCoverSource)
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, 200);

  return {
    ok: true,
    sourceShift: serializeShift(shiftId, source),
    candidates,
  };
});

export const requestShiftSwap = onCall(async (req) => {
  const ctx = await resolveTenantWithFallback(req);
  const admin = initFirebase();
  const db = admin.firestore();
  const orgId = ctx.orgId;

  const shiftId = String(req.data?.shiftId || '').trim();
  const targetUid = String(req.data?.targetUid || '').trim();
  const targetShiftId = String(req.data?.targetShiftId || '').trim() || null;
  const note = String(req.data?.note || '').trim().slice(0, 1000) || null;

  if (!shiftId) throw new HttpsError('invalid-argument', 'shiftId is required.');
  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid is required.');
  if (targetUid === ctx.uid) throw new HttpsError('invalid-argument', 'Choose another staff member.');

  const reqRef = db.collection('orgs').doc(orgId).collection('shiftSwapRequests').doc();
  let requesterName = '';
  let targetName = '';
  let shiftTitle = '';

  await db.runTransaction(async (tx) => {
    const sourceRef = db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId);
    const targetUserRef = db.collection('orgs').doc(orgId).collection('users').doc(targetUid);
    const requesterUserRef = db.collection('orgs').doc(orgId).collection('users').doc(ctx.uid);

    const reads: Promise<any>[] = [tx.get(sourceRef), tx.get(targetUserRef), tx.get(requesterUserRef)];
    const targetShiftRef = targetShiftId
      ? db.collection('orgs').doc(orgId).collection('shifts').doc(targetShiftId)
      : null;
    if (targetShiftRef) reads.push(tx.get(targetShiftRef));

    const [sourceSnap, targetUserSnap, requesterUserSnap, targetShiftSnap] = await Promise.all(reads);

    if (!sourceSnap.exists) throw new HttpsError('not-found', 'Shift not found.');
    if (!targetUserSnap.exists) throw new HttpsError('not-found', 'Target staff member not found.');
    if (!requesterUserSnap.exists) throw new HttpsError('not-found', 'Your staff profile was not found.');

    const source = sourceSnap.data() as any;
    const targetUser = targetUserSnap.data() as any;
    const requesterUser = requesterUserSnap.data() as any;

    if (source.assignedUserId !== ctx.uid) {
      throw new HttpsError('permission-denied', 'You can only request switches for your assigned shifts.');
    }
    if (!ACTIVE_SHIFT_STATUSES.has(String(source.status || '').trim())) {
      throw new HttpsError('failed-precondition', 'Only assigned or claimed shifts can be switched.');
    }
    if (toMillis(source.endAt) <= Date.now()) {
      throw new HttpsError('failed-precondition', 'Past shifts cannot be switched.');
    }
    if (targetUser.active === false) {
      throw new HttpsError('failed-precondition', 'Target staff member is inactive.');
    }
    if (!shiftRoleMatches(targetUser.jobRole, source.requiredJobRoles ?? source.requiredJobRole)) {
      throw new HttpsError('failed-precondition', 'Target staff member does not match the role required for your shift.');
    }

    let targetShift: any = null;
    if (targetShiftRef) {
      if (!targetShiftSnap?.exists) throw new HttpsError('not-found', 'Target shift not found.');
      targetShift = targetShiftSnap.data() as any;
      if (targetShift.assignedUserId !== targetUid) {
        throw new HttpsError('failed-precondition', 'The selected shift is not assigned to the target staff member.');
      }
      if (!ACTIVE_SHIFT_STATUSES.has(String(targetShift.status || '').trim())) {
        throw new HttpsError('failed-precondition', 'The selected target shift is not switchable.');
      }
      if (toMillis(targetShift.endAt) <= Date.now()) {
        throw new HttpsError('failed-precondition', 'Past target shifts cannot be switched.');
      }
      if (!shiftRoleMatches(requesterUser.jobRole, targetShift.requiredJobRoles ?? targetShift.requiredJobRole)) {
        throw new HttpsError('failed-precondition', 'You do not match the role required for the target shift.');
      }
    }

    const dupSnap = await tx.get(
      db.collection('orgs').doc(orgId).collection('shiftSwapRequests')
        .where('shiftId', '==', shiftId)
        .limit(50)
    );
    const duplicate = dupSnap.docs.some((doc) => {
      const item = doc.data() as any;
      return String(item.status || '') === 'pending'
        && String(item.requesterUid || '') === ctx.uid
        && String(item.targetUid || '') === targetUid
        && String(item.targetShiftId || '') === String(targetShiftId || '');
    });
    if (duplicate) {
      throw new HttpsError('already-exists', 'A matching shift switch request is already pending.');
    }

    const now = Timestamp.now();
    requesterName = personName(requesterUser, ctx.uid);
    targetName = personName(targetUser, targetUid);
    shiftTitle = String(source.title || 'Shift');

    tx.set(reqRef, {
      requestId: reqRef.id,
      orgId,
      status: 'pending',
      kind: targetShiftId ? 'swap' : 'cover',
      shiftId,
      shiftTitle,
      shiftLocationName: String(source.locationName || ''),
      sourceStartAt: source.startAt || null,
      sourceEndAt: source.endAt || null,
      requesterUid: ctx.uid,
      requesterName,
      requesterJobRole: requesterUser.jobRole || null,
      targetUid,
      targetName,
      targetJobRole: targetUser.jobRole || null,
      targetShiftId,
      targetShiftTitle: targetShift ? String(targetShift.title || 'Shift') : null,
      targetShiftLocationName: targetShift ? String(targetShift.locationName || '') : null,
      targetStartAt: targetShift?.startAt || null,
      targetEndAt: targetShift?.endAt || null,
      note,
      createdAt: now,
      updatedAt: now,
      createdBy: ctx.uid,
    });
  });

  await notifyUser(db, orgId, targetUid, {
    title: targetShiftId ? 'Shift trade request' : 'Shift cover request',
    body: `${requesterName} asked you to ${targetShiftId ? 'trade shifts' : 'cover a shift'}: ${shiftTitle}.`,
    createdBy: ctx.uid,
    meta: { requestId: reqRef.id, shiftId, targetShiftId },
  });

  await writeAudit(orgId, {
    action: 'shift_swap.request',
    actorUid: ctx.uid,
    target: { requestId: reqRef.id, shiftId, targetUid, targetShiftId },
  });

  return { ok: true, requestId: reqRef.id };
});

export const respondShiftSwap = onCall(async (req) => {
  const ctx = await resolveTenantWithFallback(req);
  const admin = initFirebase();
  const db = admin.firestore();
  const orgId = ctx.orgId;

  const requestId = String(req.data?.requestId || '').trim();
  const decision = String(req.data?.decision || '').trim().toLowerCase();
  const decisionNote = String(req.data?.decisionNote || '').trim().slice(0, 1000) || null;
  if (!requestId) throw new HttpsError('invalid-argument', 'requestId is required.');
  if (!['accept', 'reject', 'cancel'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'decision must be accept, reject, or cancel.');
  }

  const reqRef = db.collection('orgs').doc(orgId).collection('shiftSwapRequests').doc(requestId);
  let requesterUid = '';
  let targetUid = '';
  let sourceShiftId = '';
  let targetShiftId: string | null = null;
  let requestKind = 'cover';
  let requesterName = '';
  let targetName = '';

  await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists) throw new HttpsError('not-found', 'Shift switch request not found.');
    const request = reqSnap.data() as any;

    if (String(request.status || '') !== 'pending') {
      throw new HttpsError('failed-precondition', 'This shift switch request is no longer pending.');
    }

    requesterUid = String(request.requesterUid || '');
    targetUid = String(request.targetUid || '');
    sourceShiftId = String(request.shiftId || '');
    targetShiftId = request.targetShiftId ? String(request.targetShiftId) : null;
    requestKind = String(request.kind || (targetShiftId ? 'swap' : 'cover'));
    requesterName = String(request.requesterName || requesterUid);
    targetName = String(request.targetName || targetUid);

    const callerCanCancel = decision === 'cancel' && (ctx.uid === requesterUid || ctx.isAdminLike);
    const callerCanReject = decision === 'reject' && (ctx.uid === targetUid || ctx.isAdminLike);
    const callerCanAccept = decision === 'accept' && (ctx.uid === targetUid || ctx.isAdminLike);
    if (!callerCanCancel && !callerCanReject && !callerCanAccept) {
      throw new HttpsError('permission-denied', 'You cannot respond to this shift switch request.');
    }

    const now = Timestamp.now();

    if (decision === 'cancel' || decision === 'reject') {
      tx.update(reqRef, {
        status: decision === 'cancel' ? 'cancelled' : 'rejected',
        decision,
        decisionNote,
        respondedAt: now,
        respondedBy: ctx.uid,
        updatedAt: now,
      });
      return;
    }

    const sourceRef = db.collection('orgs').doc(orgId).collection('shifts').doc(sourceShiftId);
    const targetUserRef = db.collection('orgs').doc(orgId).collection('users').doc(targetUid);
    const requesterUserRef = db.collection('orgs').doc(orgId).collection('users').doc(requesterUid);
    const orgRef = db.collection('orgs').doc(orgId);

    const reads: Promise<any>[] = [tx.get(sourceRef), tx.get(targetUserRef), tx.get(requesterUserRef), tx.get(orgRef)];
    const targetShiftRef = targetShiftId
      ? db.collection('orgs').doc(orgId).collection('shifts').doc(targetShiftId)
      : null;
    if (targetShiftRef) reads.push(tx.get(targetShiftRef));

    const [sourceSnap, targetUserSnap, requesterUserSnap, orgSnap, targetShiftSnap] = await Promise.all(reads);
    if (!sourceSnap.exists) throw new HttpsError('not-found', 'Source shift not found.');
    if (!targetUserSnap.exists) throw new HttpsError('not-found', 'Target staff member not found.');
    if (!requesterUserSnap.exists) throw new HttpsError('not-found', 'Requester staff member not found.');

    const source = sourceSnap.data() as any;
    const targetUser = targetUserSnap.data() as any;
    const requesterUser = requesterUserSnap.data() as any;
    const rules = resolveFatigueRules(orgSnap.exists ? orgSnap.data() : null);

    if (source.assignedUserId !== requesterUid) {
      throw new HttpsError('failed-precondition', 'The source shift is no longer assigned to the requester.');
    }
    if (!ACTIVE_SHIFT_STATUSES.has(String(source.status || '').trim())) {
      throw new HttpsError('failed-precondition', 'The source shift is no longer switchable.');
    }

    let targetShift: any = null;
    const excludedIds = new Set([sourceShiftId]);
    if (targetShiftId && targetShiftRef) {
      excludedIds.add(targetShiftId);
      if (!targetShiftSnap?.exists) throw new HttpsError('not-found', 'Target shift not found.');
      targetShift = targetShiftSnap.data() as any;
      if (targetShift.assignedUserId !== targetUid) {
        throw new HttpsError('failed-precondition', 'The target shift is no longer assigned to the requested staff member.');
      }
      if (!ACTIVE_SHIFT_STATUSES.has(String(targetShift.status || '').trim())) {
        throw new HttpsError('failed-precondition', 'The target shift is no longer switchable.');
      }
      await assertUserCanTakeShift(tx, db, orgId, requesterUid, requesterUser, targetShiftId, targetShift, excludedIds, rules);
    }

    await assertUserCanTakeShift(tx, db, orgId, targetUid, targetUser, sourceShiftId, source, excludedIds, rules);

    tx.update(sourceRef, {
      assignedUserId: targetUid,
      assignedUserName: personName(targetUser, targetUid),
      assignedAt: now,
      assignedBy: ctx.uid,
      status: 'assigned',
      marketplaceVisible: false,
      swapRequestId: requestId,
      updatedAt: now,
      updatedBy: ctx.uid,
      auditLog: FieldValue.arrayUnion({
        action: requestKind === 'swap' ? 'SWAP_APPROVED' : 'COVER_APPROVED',
        actorUserId: ctx.uid,
        at: now,
        note: `Shift reassigned from ${requesterUid} to ${targetUid}.`,
      }),
    });

    if (targetShiftRef && targetShiftId && targetShift) {
      tx.update(targetShiftRef, {
        assignedUserId: requesterUid,
        assignedUserName: personName(requesterUser, requesterUid),
        assignedAt: now,
        assignedBy: ctx.uid,
        status: 'assigned',
        marketplaceVisible: false,
        swapRequestId: requestId,
        updatedAt: now,
        updatedBy: ctx.uid,
        auditLog: FieldValue.arrayUnion({
          action: 'SWAP_APPROVED',
          actorUserId: ctx.uid,
          at: now,
          note: `Shift reassigned from ${targetUid} to ${requesterUid}.`,
        }),
      });
    }

    tx.update(reqRef, {
      status: 'approved',
      decision,
      decisionNote,
      respondedAt: now,
      respondedBy: ctx.uid,
      updatedAt: now,
    });
  });

  if (decision === 'accept') {
    await Promise.all([
      notifyUser(db, orgId, requesterUid, {
        title: requestKind === 'swap' ? 'Shift trade approved' : 'Shift cover approved',
        body: `${targetName} accepted your shift switch request.`,
        createdBy: ctx.uid,
        meta: { requestId, shiftId: sourceShiftId, targetShiftId },
      }),
      notifyUser(db, orgId, targetUid, {
        title: requestKind === 'swap' ? 'Shift trade confirmed' : 'Shift cover confirmed',
        body: `You are now assigned to ${requestKind === 'swap' ? 'the traded shift' : 'the covered shift'}.`,
        createdBy: ctx.uid,
        meta: { requestId, shiftId: sourceShiftId, targetShiftId },
      }),
    ]);
  } else {
    const notifyUid = decision === 'cancel' ? targetUid : requesterUid;
    await notifyUser(db, orgId, notifyUid, {
      title: decision === 'cancel' ? 'Shift switch cancelled' : 'Shift switch declined',
      body: decision === 'cancel'
        ? `${requesterName} cancelled a shift switch request.`
        : `${targetName} declined a shift switch request.`,
      createdBy: ctx.uid,
      meta: { requestId, shiftId: sourceShiftId, targetShiftId },
    });
  }

  await writeAudit(orgId, {
    action: 'shift_swap.respond',
    actorUid: ctx.uid,
    target: { requestId, shiftId: sourceShiftId, targetShiftId },
    details: { decision },
  });

  return { ok: true, requestId, decision };
});

export const listShiftSwapRequests = onCall(async (req) => {
  const ctx = await resolveTenantWithFallback(req);
  const admin = initFirebase();
  const db = admin.firestore();
  const orgId = ctx.orgId;
  const requestedStatus = String(req.data?.status || '').trim();
  const limitRaw = Number(req.data?.limit || 100);
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 100));

  const items = new Map<string, any>();
  const col = db.collection('orgs').doc(orgId).collection('shiftSwapRequests');

  if (ctx.isAdminLike) {
    const snap = await col.orderBy('createdAt', 'desc').limit(limit).get();
    for (const doc of snap.docs) items.set(doc.id, doc.data());
  } else {
    const [outgoing, incoming] = await Promise.all([
      col.where('requesterUid', '==', ctx.uid).limit(limit).get(),
      col.where('targetUid', '==', ctx.uid).limit(limit).get(),
    ]);
    for (const doc of outgoing.docs) items.set(doc.id, doc.data());
    for (const doc of incoming.docs) items.set(doc.id, doc.data());
  }

  let rows = Array.from(items.entries()).map(([id, data]) => serializeRequest(id, data));
  if (requestedStatus) rows = rows.filter((r) => r.status === requestedStatus);
  rows.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

  return {
    ok: true,
    items: rows.slice(0, limit),
  };
});
