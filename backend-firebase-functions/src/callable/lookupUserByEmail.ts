import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { getClaims, requireSuperAdmin } from '../infra/auth';

export const lookupUserByEmail = onCall(async (req) => {
  const admin = initFirebase();
  const caller = getClaims(req);
  await requireSuperAdmin(caller);

  const email = String(req.data?.email || '').trim().toLowerCase();
  if (!email) throw new HttpsError('invalid-argument', 'email is required.');

  try {
    const user = await admin.auth().getUserByEmail(email);
    const rootSnap = await admin.firestore().doc(`users/${user.uid}`).get();

    const rootData: any = rootSnap.exists ? rootSnap.data() : {};
    const primaryOrgId = String(rootData.orgId || user.customClaims?.orgId || '').trim();
    const memberships: any[] = [];

    if (primaryOrgId) {
      const memberSnap = await admin.firestore().doc(`orgs/${primaryOrgId}/users/${user.uid}`).get();
      if (memberSnap.exists) {
        memberships.push({
          orgId: primaryOrgId,
          ...memberSnap.data(),
        });
      }
    }

    return {
      ok: true,
      uid: user.uid,
      email: user.email,
      displayName: user.displayName ?? null,
      disabled: user.disabled ?? false,
      orgId: primaryOrgId || null,
      accessRole: String(rootData.accessRole || user.customClaims?.accessRole || '').trim() || null,
      jobRole: String(rootData.jobRole || user.customClaims?.jobRole || '').trim() || null,
      active: rootData.active !== false,
      platformRole: String(rootData.platformRole || user.customClaims?.platformRole || '').trim() || null,
      memberships,
    };
  } catch (e: any) {
    if (e?.code === 'auth/user-not-found') {
      return {
        ok: true,
        found: false,
        email,
      };
    }
    if (e?.code === 'auth/invalid-email') {
      throw new HttpsError('invalid-argument', 'Enter a valid email address.');
    }
    console.error('lookupUserByEmail failed', e);
    throw new HttpsError('internal', 'Lookup failed.');
  }
});
