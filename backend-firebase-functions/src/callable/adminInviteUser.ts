import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';
import { externalNotify, sendgridApiKey } from '../infra/external-notify';
import { assertOrgCanAddActiveUser } from '../infra/plans';

export const adminInviteUser = onCall({ secrets: [sendgridApiKey] }, async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();
  const ctx = await resolveTenantWithFallback(req);

  const email = String(req.data?.email || '').trim().toLowerCase();
  const displayName = String(req.data?.displayName || '').trim();
  const jobRole = String(req.data?.jobRole || 'RN');
  const requestedAccessRole = String(req.data?.accessRole || 'staff');

  if (!email) throw new HttpsError('invalid-argument', 'email is required.');
  
  const callerOrg = ctx.orgId;
  const callerRole = String(ctx.role ?? '');

  if (!callerOrg) {
    throw new HttpsError('permission-denied', 'Caller has no orgId claim.');
  }

  if (!ctx.isSuperAdmin && !['admin', 'hr', 'manager', 'scheduler'].includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only Admins/HR/Managers can invite users.');
  }

  const allowedRoles = ['staff', 'manager', 'scheduler', 'admin', 'hr'];
  if (!allowedRoles.includes(requestedAccessRole)) {
    throw new HttpsError('invalid-argument', 'Invalid accessRole.');
  }

  // Tenant policy: org admins/managers/hr/scheduler can invite employees only.
  // Elevated roles are provisioned by super-admin workflows.
  const accessRole = ctx.isSuperAdmin ? requestedAccessRole : 'staff';

  if (!ctx.isSuperAdmin && requestedAccessRole !== 'staff') {
    throw new HttpsError('permission-denied', 'Org-level invite can only create employee (staff) users.');
  }

  const orgSnap = await db.collection('orgs').doc(callerOrg).get();
  const orgIndustry = String((orgSnap.data() as any)?.industry || '').trim();

  let userRecord;
  let isNewUser = false;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (e: any) {
    if (e.code === 'auth/user-not-found') {
      // Create user
      userRecord = await admin.auth().createUser({
        email,
        displayName: displayName || undefined,
        password: randomBytes(24).toString('base64url'),
      });
      isNewUser = true;
    } else {
      throw new HttpsError('internal', 'Error checking user existence.', e);
    }
  }

  const targetUid = userRecord.uid;
  const passwordResetLink = await admin.auth().generatePasswordResetLink(email, {
    url: 'https://atlanta-e04aa.web.app/login',
  });

  // Prevent tenant hijacking: existing user must belong to same org unless super-admin.
  const [targetToken, rootUserSnap] = await Promise.all([
    admin.auth().getUser(targetUid),
    db.doc(`users/${targetUid}`).get(),
  ]);

  const existingClaimOrgId = String((targetToken.customClaims as any)?.orgId || '').trim();
  const existingRootOrgId = String((rootUserSnap.exists ? (rootUserSnap.data() as any)?.orgId : '') || '').trim();
  const existingOrgId = existingClaimOrgId || existingRootOrgId;

  if (!ctx.isSuperAdmin && existingOrgId && existingOrgId !== callerOrg) {
    throw new HttpsError('permission-denied', 'User already belongs to another tenant.');
  }

  const existingOrgUserSnap = await db.collection('orgs').doc(callerOrg).collection('users').doc(targetUid).get();
  const alreadyActiveInOrg = existingOrgUserSnap.exists && existingOrgUserSnap.data()?.active !== false;
  if (!alreadyActiveInOrg) {
    await assertOrgCanAddActiveUser(db, callerOrg, (orgSnap.data() as any)?.plan, targetUid);
  }

  // Set Claims
  await admin.auth().setCustomUserClaims(targetUid, {
    orgId: callerOrg,
    accessRole: accessRole as any,
    platformRole: null, // never grant superAdmin here
  });

  // Write to Firestore org directory
  await db.collection('orgs').doc(callerOrg).collection('users').doc(targetUid).set({
    uid: targetUid,
    email: email,
    displayName: displayName,
    orgId: callerOrg,
    accessRole,
    jobRole,
    active: true,
    createdAt: isNewUser ? Timestamp.now() : userRecord.metadata.creationTime,
    updatedAt: Timestamp.now(),
  }, { merge: true });

  // Root directory used by fallback tenant resolution.
  await db.doc(`users/${targetUid}`).set({
    uid: targetUid,
    email,
    displayName: displayName || userRecord.displayName || null,
    orgId: callerOrg,
    accessRole,
    jobRole,
    platformRole: null,
    active: true,
    updatedAt: Timestamp.now(),
  }, { merge: true });

  await writeAudit(callerOrg, {
    actorUserId: ctx.uid,
    action: isNewUser ? 'INVITE_NEW_USER' : 'ASSIGN_EXISTING_USER',
    entityType: 'user',
    entityId: targetUid,
    targetOrgId: callerOrg,
    accessRole,
    jobRole
  });

  await externalNotify({
    channel: 'email',
    to: email,
    subject: 'Your InnovaShift account is ready',
    message: `Your account was created for ${callerOrg}. Set your password here: ${passwordResetLink}`,
    meta: {
      orgId: callerOrg,
      uid: targetUid,
      actorUid: ctx.uid,
      industry: orgIndustry,
      action: isNewUser ? 'INVITE_NEW_USER' : 'ASSIGN_EXISTING_USER',
    },
  });

  return { ok: true, uid: targetUid, isNewUser, passwordResetLink };
});
