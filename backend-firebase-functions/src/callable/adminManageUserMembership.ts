import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { getClaims, requireOrgAdminLike, requireSuperAdmin } from '../infra/auth';
import { writeAudit } from '../infra/audit';
import { assertOrgCanAddActiveUser } from '../infra/plans';

type RunMembershipActionInput = {
  admin: ReturnType<typeof initFirebase>;
  caller: any;
  callerIsSuper: boolean;
  uid: string;
  action: 'revoke' | 'transfer' | 'suspend';
  fromOrgId?: string;
  toOrgId?: string;
  accessRole?: string;
  jobRole?: string;
  reason?: string | null;
};

export async function runMembershipAction(input: RunMembershipActionInput) {
  const { admin, caller, callerIsSuper, uid, action } = input;
  const db = admin.firestore();
  const fromOrgId = String(input.fromOrgId || '').trim();
  const toOrgId = String(input.toOrgId || '').trim();
  const accessRole = String(input.accessRole || '').trim() || 'staff';
  const jobRole = String(input.jobRole || '').trim() || 'RN';
  const reason = String(input.reason || '').trim() || null;

  if (!uid) throw new HttpsError('invalid-argument', 'uid is required.');
  if (!['revoke', 'transfer', 'suspend'].includes(action)) {
    throw new HttpsError('invalid-argument', 'action must be revoke, transfer, or suspend.');
  }
  if ((action === 'transfer') && !toOrgId) {
    throw new HttpsError('invalid-argument', 'toOrgId is required for transfers.');
  }

  const [authUser, rootSnap] = await Promise.all([
    admin.auth().getUser(uid),
    db.doc(`users/${uid}`).get(),
  ]);

  const rootData: any = rootSnap.exists ? rootSnap.data() : {};
  const currentOrgId = String(fromOrgId || rootData.orgId || '').trim();
  const currentAccessRole = String(rootData.accessRole || '').trim() || 'staff';
  const currentJobRole = String(rootData.jobRole || '').trim() || 'RN';
  const platformRole = authUser.customClaims?.platformRole === 'superAdmin' ? 'superAdmin' : null;

  if (!callerIsSuper && action === 'transfer') {
    throw new HttpsError('permission-denied', 'Only super admin can transfer users across organizations.');
  }

  if (!callerIsSuper) {
    if (uid === caller.uid) {
      throw new HttpsError('permission-denied', 'You cannot revoke or suspend your own account.');
    }

    const scopedOrgId = String(caller.orgId || '').trim();
    if (!scopedOrgId || scopedOrgId !== currentOrgId) {
      throw new HttpsError('permission-denied', 'Cross-organization membership update is not allowed.');
    }

    // A manager/scheduler is org-admin-like but must not be able to
    // revoke/suspend an admin or hr account — only an admin (or hr, for
    // other hr accounts) may act on peer/higher-privilege users.
    if (['admin', 'hr'].includes(currentAccessRole) && !['admin', 'hr'].includes(String(caller.accessRole))) {
      throw new HttpsError('permission-denied', 'Only admin/hr can modify an admin or hr account.');
    }
  }

  if (action === 'transfer') {
    const targetOrgSnap = await db.doc(`orgs/${toOrgId}`).get();
    if (!targetOrgSnap.exists) throw new HttpsError('not-found', 'Target organization not found.');
  }

  const now = Timestamp.now();

  if (action === 'revoke' || action === 'suspend') {
    const orgId = currentOrgId || String(rootData.orgId || '').trim();
    if (orgId) {
      await db.doc(`orgs/${orgId}/users/${uid}`).set({
        uid,
        orgId,
        accessRole: currentAccessRole,
        jobRole: currentJobRole,
        active: false,
        revokedAt: now,
        revokedBy: caller.uid,
        revokeReason: reason,
        updatedAt: now,
      }, { merge: true });
    }

    // Revoke (employment ended) keeps the Auth account enabled so the
    // former employee can still sign in — Firestore/rules access is still
    // fully cut off via orgId/accessRole going null below, except a
    // narrow self-read of their own historical payroll/payslips
    // (firestore.rules' formerOrgId() check), which is the point: they
    // need their paystubs for tax purposes after they're gone. Suspend
    // (a temporary hold, e.g. pending investigation) keeps today's full
    // lockout — that one's meant to cut off access immediately.
    await db.doc(`users/${uid}`).set({
      uid,
      email: authUser.email ?? rootData.email ?? null,
      displayName: authUser.displayName ?? rootData.displayName ?? null,
      orgId: null,
      accessRole: null,
      jobRole: rootData.jobRole ?? null,
      active: false,
      formerOrgId: action === 'revoke' ? orgId || null : rootData.formerOrgId ?? null,
      updatedAt: now,
      revokedAt: now,
      revokedBy: caller.uid,
      revokeReason: reason,
    }, { merge: true });

    await admin.auth().setCustomUserClaims(uid, {
      orgId: null,
      accessRole: null,
      platformRole,
    });

    if (platformRole !== 'superAdmin' && action === 'suspend') {
      await admin.auth().updateUser(uid, { disabled: true });
    }

    if (orgId) {
      await writeAudit(orgId, {
        actorUserId: caller.uid,
        action: action === 'revoke' ? 'REVOKE_USER' : 'SUSPEND_USER',
        entityType: 'user',
        entityId: uid,
        targetOrgId: orgId,
        reason,
      });
    }

    return { ok: true, uid, action, orgId: currentOrgId || null };
  }

  const targetOrgId = toOrgId;
  const targetOrgSnap = await db.doc(`orgs/${targetOrgId}`).get();
  if (!targetOrgSnap.exists) throw new HttpsError('not-found', 'Target organization not found.');

  await assertOrgCanAddActiveUser(db, targetOrgId, targetOrgSnap.data()?.plan, uid);

  const oldOrgId = currentOrgId || String(rootData.orgId || '').trim();
  if (!oldOrgId) {
    throw new HttpsError('failed-precondition', 'User is not attached to an organization to transfer from.');
  }

  await db.doc(`orgs/${oldOrgId}/users/${uid}`).set({
    uid,
    orgId: oldOrgId,
    accessRole: currentAccessRole,
    jobRole: currentJobRole,
    active: false,
    transferredToOrgId: targetOrgId,
    transferredAt: now,
    transferredBy: caller.uid,
    updatedAt: now,
  }, { merge: true });

  await db.doc(`orgs/${targetOrgId}/users/${uid}`).set({
    uid,
    email: authUser.email ?? rootData.email ?? null,
    displayName: authUser.displayName ?? rootData.displayName ?? null,
    orgId: targetOrgId,
    accessRole,
    jobRole,
    active: true,
    transferredFromOrgId: oldOrgId,
    transferredAt: now,
    transferredBy: caller.uid,
    updatedAt: now,
    createdAt: Timestamp.now(),
  }, { merge: true });

  await db.doc(`users/${uid}`).set({
    uid,
    email: authUser.email ?? rootData.email ?? null,
    displayName: authUser.displayName ?? rootData.displayName ?? null,
    orgId: targetOrgId,
    accessRole,
    jobRole,
    active: true,
    formerOrgId: null,
    transferredFromOrgId: oldOrgId,
    transferredAt: now,
    transferredBy: caller.uid,
    updatedAt: now,
  }, { merge: true });

  await admin.auth().setCustomUserClaims(uid, {
    orgId: targetOrgId,
    accessRole,
    platformRole,
  });
  await admin.auth().updateUser(uid, { disabled: false });

  await writeAudit(targetOrgId, {
    actorUserId: caller.uid,
    action: 'TRANSFER_USER',
    entityType: 'user',
    entityId: uid,
    targetOrgId,
    reason,
    fromOrgId: oldOrgId,
    accessRole,
    jobRole,
  });

  if (oldOrgId && oldOrgId !== targetOrgId) {
    await writeAudit(oldOrgId, {
      actorUserId: caller.uid,
      action: 'TRANSFER_USER_OUT',
      entityType: 'user',
      entityId: uid,
      targetOrgId: oldOrgId,
      transferredToOrgId: targetOrgId,
      reason,
    });
  }

  return { ok: true, uid, action: 'transfer', fromOrgId: oldOrgId, toOrgId: targetOrgId };
}

export const adminManageUserMembership = onCall(async (req) => {
  const admin = initFirebase();
  const caller = getClaims(req);
  let callerIsSuper = false;
  try {
    await requireSuperAdmin(caller);
    callerIsSuper = true;
  } catch {
    callerIsSuper = false;
  }

  if (!callerIsSuper) {
    requireOrgAdminLike(caller);
    if (!caller.orgId) {
      throw new HttpsError('permission-denied', 'Caller has no org scope.');
    }
  }

  const uid = String(req.data?.uid || '').trim();
  const action = String(req.data?.action || '').trim();
  return runMembershipAction({
    admin,
    caller,
    callerIsSuper,
    uid,
    action: action as 'revoke' | 'transfer' | 'suspend',
    fromOrgId: String(req.data?.orgId || '').trim(),
    toOrgId: String(req.data?.toOrgId || '').trim(),
    accessRole: String(req.data?.accessRole || '').trim() || 'staff',
    jobRole: String(req.data?.jobRole || '').trim() || 'RN',
    reason: String(req.data?.reason || '').trim() || null,
  });
});
