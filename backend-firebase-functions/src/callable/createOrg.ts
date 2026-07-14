import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { getClaims, requireSuperAdmin } from '../infra/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';


export const createOrg = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();

  const caller = getClaims(req);
  await requireSuperAdmin(caller);

  const orgId = String(req.data?.orgId || '').trim();
  const name  = String(req.data?.name  || '').trim();
  const plan  = String(req.data?.plan  || 'free').trim();
  const countryCode = String(req.data?.countryCode || 'US').trim().toUpperCase();
  const currencyCode = String(req.data?.currencyCode || 'USD').trim().toUpperCase();
  const payFrequency = String(req.data?.payFrequency || 'biweekly').trim();
  const taxProfile = String(req.data?.taxProfile || 'us_federal_state').trim();
  const payrollTaxNotes = String(req.data?.payrollTaxNotes || '').trim().slice(0, 2000);
  const bootstrapAdminEmail = String(req.data?.bootstrapAdminEmail || '').trim().toLowerCase();
  const bootstrapAdminDisplayName = String(req.data?.bootstrapAdminDisplayName || '').trim();
  const bootstrapAdminJobRole = String(req.data?.bootstrapAdminJobRole || 'Manager').trim();

  if (!orgId) throw new HttpsError('invalid-argument', 'orgId is required.');
  if (!name)  throw new HttpsError('invalid-argument', 'name is required.');

  const validPlans = ['free','starter','pro','enterprise'];
  const safePlan   = validPlans.includes(plan) ? plan : 'free';
  const validPayFrequencies = ['weekly','biweekly','semimonthly','monthly'];
  const safePayFrequency = validPayFrequencies.includes(payFrequency) ? payFrequency : 'biweekly';
  const validTaxProfiles = [
    'us_federal_state',
    'canada_federal_provincial',
    'cameroon_cnps_irpp',
    'west_africa_statutory',
    'nigeria_paye_pension',
    'ghana_paye_ssnit',
    'kenya_paye_nssf_nhif',
    'south_africa_paye_uif',
    'uae_no_income_tax',
    'manual',
  ];
  const safeTaxProfile = validTaxProfiles.includes(taxProfile) ? taxProfile : 'manual';

  const now = Timestamp.now();
  const base = {
    orgId, name, active: true,
    plan: safePlan, planStatus: 'active',
    countryCode: countryCode || 'US',
    currencyCode: currencyCode || 'USD',
    payFrequency: safePayFrequency,
    taxProfile: safeTaxProfile,
    payrollTaxNotes: payrollTaxNotes || null,
    createdAt: now, updatedAt: now, createdBy: caller.uid,
  };

  await db.collection('orgDirectory').doc(orgId).set(base, { merge: true });
  await db.collection('orgs').doc(orgId).set(base, { merge: true });

  let bootstrapAdminUid: string | null = null;
  let bootstrapAdminCreated = false;
  let bootstrapAdminPasswordResetLink: string | null = null;

  if (bootstrapAdminEmail) {
    let user;
    try {
      user = await admin.auth().getUserByEmail(bootstrapAdminEmail);
    } catch (e: any) {
      if (e?.code === 'auth/user-not-found') {
        user = await admin.auth().createUser({
          email: bootstrapAdminEmail,
          displayName: bootstrapAdminDisplayName || undefined,
          password: randomBytes(24).toString('base64url'),
        });
        bootstrapAdminCreated = true;
      } else {
        throw new HttpsError('internal', 'Unable to create or lookup bootstrap admin user.', e);
      }
    }

    bootstrapAdminUid = user.uid;

    bootstrapAdminPasswordResetLink = await admin.auth().generatePasswordResetLink(bootstrapAdminEmail, {
      url: 'https://atlanta-e04aa.web.app/login',
    });

    await admin.auth().setCustomUserClaims(bootstrapAdminUid, {
      orgId,
      accessRole: 'admin',
      platformRole: null,
    });

    await db.doc(`orgs/${orgId}/users/${bootstrapAdminUid}`).set({
      uid: bootstrapAdminUid,
      orgId,
      email: bootstrapAdminEmail,
      displayName: bootstrapAdminDisplayName || user.displayName || null,
      accessRole: 'admin',
      jobRole: bootstrapAdminJobRole || 'Manager',
      active: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: caller.uid,
    }, { merge: true });

    await db.doc(`users/${bootstrapAdminUid}`).set({
      uid: bootstrapAdminUid,
      orgId,
      email: bootstrapAdminEmail,
      displayName: bootstrapAdminDisplayName || user.displayName || null,
      accessRole: 'admin',
      jobRole: bootstrapAdminJobRole || 'Manager',
      platformRole: null,
      active: true,
      updatedAt: Timestamp.now(),
    }, { merge: true });
  }

  return {
    ok: true,
    orgId,
    plan: safePlan,
    bootstrapAdminUid,
    bootstrapAdminCreated,
    bootstrapAdminPasswordResetLink,
  };
});
