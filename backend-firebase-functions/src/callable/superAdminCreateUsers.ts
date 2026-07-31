import { onCall } from 'firebase-functions/v2/https';
import { randomBytes } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { getClaims, requireSuperAdmin } from '../infra/auth';
import { writeAudit } from '../infra/audit';
import { externalNotify, sendgridApiKey } from '../infra/external-notify';
import { assertOrgCanAddActiveUser } from '../infra/plans';

const ALLOWED_ACCESS_ROLES = new Set(['staff', 'manager', 'scheduler', 'admin', 'hr']);
const MAX_USERS_PER_CALL = 100;

interface RowResult {
  email: string;
  ok: boolean;
  uid?: string;
  isNewUser?: boolean;
  passwordResetLink?: string;
  error?: string;
}

/**
 * Super-admin only: creates (or assigns an existing auth account to) one or
 * more full employee records in a single call — used by both the "Add
 * Employee" form and the bulk/file-import table, which both just build a
 * `users` array of different lengths. Each row is processed independently
 * so one bad row (duplicate org, missing field) doesn't fail the whole
 * batch — failures come back per-row in `results`.
 */
export const superAdminCreateUsers = onCall({ secrets: [sendgridApiKey] }, async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();
  const caller = getClaims(req);
  await requireSuperAdmin(caller);

  const rowsRaw: unknown = req.data?.users;
  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
    return { results: [] as RowResult[] };
  }
  const rows = rowsRaw.slice(0, MAX_USERS_PER_CALL);

  const orgCache = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  const results: RowResult[] = [];
  const notifyPromises: Promise<unknown>[] = [];

  for (const raw of rows as any[]) {
    const email = String(raw?.email || '').trim().toLowerCase();
    try {
      if (!email) throw new Error('Email is required.');
      const displayName = String(raw?.displayName || '').trim();
      if (!displayName) throw new Error('Name is required.');
      const orgId = String(raw?.orgId || '').trim();
      if (!orgId) throw new Error('Organization is required.');
      const accessRole = String(raw?.accessRole || 'staff').trim();
      if (!ALLOWED_ACCESS_ROLES.has(accessRole)) throw new Error('Invalid access role.');
      const jobRole = String(raw?.jobRole || '').trim();

      let orgSnap = orgCache.get(orgId);
      if (!orgSnap) {
        orgSnap = await db.collection('orgs').doc(orgId).get();
        orgCache.set(orgId, orgSnap);
      }
      if (!orgSnap.exists) throw new Error(`Organization "${orgId}" not found.`);

      let userRecord;
      let isNewUser = false;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
      } catch (e: any) {
        if (e.code === 'auth/user-not-found') {
          userRecord = await admin.auth().createUser({
            email,
            displayName,
            password: randomBytes(24).toString('base64url'),
          });
          isNewUser = true;
        } else {
          throw e;
        }
      }
      const targetUid = userRecord.uid;

      const existingOrgUserSnap = await db.collection('orgs').doc(orgId).collection('users').doc(targetUid).get();
      const alreadyActiveInOrg = existingOrgUserSnap.exists && existingOrgUserSnap.data()?.active !== false;
      if (!alreadyActiveInOrg) {
        await assertOrgCanAddActiveUser(db, orgId, (orgSnap.data() as any)?.plan, targetUid);
      }

      await admin.auth().setCustomUserClaims(targetUid, {
        orgId,
        accessRole,
        platformRole: null, // never grant superAdmin through bulk creation
      });

      const now = Timestamp.now();
      const payRateNum = raw?.payRate != null && raw.payRate !== '' ? Number(raw.payRate) : null;
      const profileFields = {
        uid: targetUid,
        email,
        displayName,
        orgId,
        accessRole,
        jobRole: jobRole || null,
        title: jobRole || null,
        phone: raw?.phone ? String(raw.phone).trim() : null,
        employeeNumber: raw?.employeeNumber ? String(raw.employeeNumber).trim() : null,
        department: raw?.department ? String(raw.department).trim() : null,
        hireDate: raw?.hireDate ? String(raw.hireDate).trim() : null,
        payRate: Number.isFinite(payRateNum) ? payRateNum : null,
        payType: raw?.payType ? String(raw.payType).trim() : null,
        photoURL: raw?.photoURL ? String(raw.photoURL).trim() : null,
        active: true,
        updatedAt: now,
      };

      await db.collection('orgs').doc(orgId).collection('users').doc(targetUid).set({
        ...profileFields,
        createdAt: existingOrgUserSnap.exists ? (existingOrgUserSnap.data()?.createdAt ?? now) : now,
      }, { merge: true });

      await db.doc(`users/${targetUid}`).set({
        ...profileFields,
        platformRole: null,
      }, { merge: true });

      const passwordResetLink = await admin.auth().generatePasswordResetLink(email, {
        url: 'https://atlanta-e04aa.web.app/login',
      });

      await writeAudit(orgId, {
        actorUserId: caller.uid,
        action: isNewUser ? 'SUPERADMIN_CREATE_USER' : 'SUPERADMIN_ASSIGN_EXISTING_USER',
        entityType: 'user',
        entityId: targetUid,
        targetOrgId: orgId,
        accessRole,
        jobRole,
      });

      // Best-effort (a notification hiccup shouldn't fail an otherwise
      // successful account creation) but still collected and awaited below
      // — Cloud Functions doesn't guarantee unawaited work survives past
      // the callable's return.
      notifyPromises.push(externalNotify({
        channel: 'email',
        to: email,
        subject: 'Your InnovaShift account is ready',
        message: `Your account was created for ${orgId}. Set your password here: ${passwordResetLink}`,
        meta: {
          orgId,
          uid: targetUid,
          actorUid: caller.uid,
          action: isNewUser ? 'SUPERADMIN_CREATE_USER' : 'SUPERADMIN_ASSIGN_EXISTING_USER',
        },
      }).catch(() => {}));

      results.push({ email, ok: true, uid: targetUid, isNewUser, passwordResetLink });
    } catch (e: any) {
      results.push({ email: email || '(missing email)', ok: false, error: String(e?.message || e) });
    }
  }

  await Promise.allSettled(notifyPromises);
  return { results };
});
