import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { getClaims, requireSuperAdmin } from '../infra/auth';

const PLANS = ['free', 'starter', 'pro', 'enterprise'];
const PLAN_STATUSES = ['active', 'trialing', 'past_due', 'canceled'];
const PAY_FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly'];
const TAX_PROFILES = [
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

function oneOf(value: any, allowed: string[], fallback: string): string {
  const text = String(value || '').trim();
  return allowed.includes(text) ? text : fallback;
}

export const updatePlatformOrg = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();
  const caller = getClaims(req);
  await requireSuperAdmin(caller);

  const orgId = String(req.data?.orgId || '').trim();
  if (!orgId) throw new HttpsError('invalid-argument', 'orgId is required.');

  const payload = {
    orgId,
    name: String(req.data?.name || '').trim(),
    industry: String(req.data?.industry || 'Healthcare').trim() || 'Healthcare',
    timezone: String(req.data?.timezone || 'America/New_York').trim() || 'America/New_York',
    contactEmail: String(req.data?.contactEmail || '').trim(),
    plan: oneOf(req.data?.plan, PLANS, 'free'),
    planStatus: oneOf(req.data?.planStatus, PLAN_STATUSES, 'active'),
    countryCode: String(req.data?.countryCode || 'US').trim().toUpperCase() || 'US',
    currencyCode: String(req.data?.currencyCode || 'USD').trim().toUpperCase() || 'USD',
    payFrequency: oneOf(req.data?.payFrequency, PAY_FREQUENCIES, 'biweekly'),
    taxProfile: oneOf(req.data?.taxProfile, TAX_PROFILES, 'manual'),
    payrollTaxNotes: String(req.data?.payrollTaxNotes || '').trim().slice(0, 2000),
    maxEmployees: Number(req.data?.maxEmployees || 0),
    defaultPayRate: Number(req.data?.defaultPayRate || 0),
    active: req.data?.active !== false,
    updatedAt: Timestamp.now(),
    updatedBy: caller.uid,
  };

  if (!payload.name) throw new HttpsError('invalid-argument', 'Organization name is required.');

  await Promise.all([
    db.collection('orgs').doc(orgId).set(payload, { merge: true }),
    db.collection('orgDirectory').doc(orgId).set(payload, { merge: true }),
  ]);

  return { ok: true, org: { ...payload, updatedAt: payload.updatedAt.toDate().toISOString() } };
});
