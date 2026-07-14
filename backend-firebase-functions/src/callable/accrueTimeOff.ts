import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';

interface AccrualTier {
  minTenureMonths: number;
  ptoHoursPerYear: number;
  sickHoursPerYear: number;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function todayKeyUTC(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Mirrors the pay-period-start convention used by payroll.util.ts's currentPayrollPeriod
 *  on the client: Monday for weekly/biweekly, 1st/16th for semimonthly, 1st for monthly. */
function isPayPeriodStartDay(payFrequency: string, now: Date): boolean {
  switch (payFrequency) {
    case 'semimonthly':
      return now.getUTCDate() === 1 || now.getUTCDate() === 16;
    case 'monthly':
      return now.getUTCDate() === 1;
    case 'weekly':
    case 'biweekly':
    default:
      return now.getUTCDay() === 1; // Monday
  }
}

function grantsPerYear(cadence: string, payFrequency: string): number {
  if (cadence === 'monthly') return 12;
  if (cadence === 'annually') return 1;
  switch (payFrequency) {
    case 'weekly': return 52;
    case 'semimonthly': return 24;
    case 'monthly': return 12;
    case 'biweekly':
    default: return 26;
  }
}

function isGrantDay(cadence: string, payFrequency: string, now: Date): boolean {
  if (cadence === 'monthly') return now.getUTCDate() === 1;
  if (cadence === 'annually') return now.getUTCMonth() === 0 && now.getUTCDate() === 1;
  return isPayPeriodStartDay(payFrequency, now);
}

function tenureMonths(hireDate: string | null, createdAt: any, now: Date): number {
  let start: Date | null = null;
  if (hireDate) {
    const [y, m, d] = hireDate.split('-').map(Number);
    if (y && m && d) start = new Date(Date.UTC(y, m - 1, d));
  }
  if (!start && createdAt) {
    const ms = createdAt?.toMillis ? createdAt.toMillis() : Number(createdAt);
    if (ms) start = new Date(ms);
  }
  if (!start) return 0;
  let months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function pickTier(tiers: AccrualTier[], months: number): AccrualTier | null {
  const sorted = [...(tiers || [])].sort((a, b) => a.minTenureMonths - b.minTenureMonths);
  let selected: AccrualTier | null = null;
  for (const t of sorted) {
    if (t.minTenureMonths <= months) selected = t;
  }
  return selected || sorted[0] || null;
}

function normalizeBalance(data: any) {
  const balances = data?.balances || {};
  return {
    ptoBalance: num(data?.ptoBalance ?? balances?.pto ?? balances?.PTO),
    sickBalance: num(data?.sickBalance ?? balances?.sick ?? balances?.SICK),
    lastAccrualGrantDay: String(data?.lastAccrualGrantDay || ''),
  };
}

/**
 * Runs daily. For every org with accrualPolicy.enabled, on that org's next grant
 * day (per its accrual cadence / pay frequency), grants each active employee their
 * tenure-tier share of yearly PTO/sick hours, capped at maxBalanceHours, and records
 * an accrualLedger entry. Idempotent per user per day via lastAccrualGrantDay.
 */
export const accrueTimeOff = onSchedule(
  { schedule: 'every 24 hours', region: 'us-east1', memory: '256MiB' },
  async () => {
    const admin = initFirebase();
    const db = admin.firestore();
    const now = new Date();
    const todayKey = todayKeyUTC(now);

    const orgsSnap = await db.collection('orgs')
      .where('accrualPolicy.enabled', '==', true)
      .limit(200)
      .get();

    if (orgsSnap.empty) {
      console.log('[accrueTimeOff] No orgs with accrual enabled.');
      return;
    }

    for (const orgDoc of orgsSnap.docs) {
      const org = orgDoc.data() as any;
      const orgId = orgDoc.id;
      const policy = org.accrualPolicy || {};
      const cadence = String(policy.cadence || 'monthly');
      const payFrequency = String(org.payFrequency || 'biweekly');
      const tiers: AccrualTier[] = Array.isArray(policy.tiers) ? policy.tiers : [];
      const maxBalanceHours = num(policy.maxBalanceHours || 0);

      if (!tiers.length || !isGrantDay(cadence, payFrequency, now)) continue;

      const perYearDivisor = grantsPerYear(cadence, payFrequency);
      const usersSnap = await db.collection('orgs').doc(orgId).collection('users')
        .limit(500)
        .get();

      if (usersSnap.empty) continue;

      let batch = db.batch();
      let writesInBatch = 0;

      for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        const user = userDoc.data() as any;
        if (user.active === false) continue;
        const months = tenureMonths(user.hireDate || null, user.createdAt, now);
        const tier = pickTier(tiers, months);
        if (!tier) continue;

        const balRef = db.collection('orgs').doc(orgId).collection('accrualBalances').doc(uid);
        const balSnap = await balRef.get();
        const current = normalizeBalance(balSnap.exists ? balSnap.data() : {});
        if (current.lastAccrualGrantDay === todayKey) continue; // already granted today

        const ptoGrant = Math.max(0, num(tier.ptoHoursPerYear) / perYearDivisor);
        const sickGrant = Math.max(0, num(tier.sickHoursPerYear) / perYearDivisor);
        if (ptoGrant <= 0 && sickGrant <= 0) continue;

        const nextPto = maxBalanceHours > 0
          ? Math.min(maxBalanceHours, num(current.ptoBalance + ptoGrant))
          : num(current.ptoBalance + ptoGrant);
        const nextSick = maxBalanceHours > 0
          ? Math.min(maxBalanceHours, num(current.sickBalance + sickGrant))
          : num(current.sickBalance + sickGrant);

        const appliedPto = num(nextPto - current.ptoBalance);
        const appliedSick = num(nextSick - current.sickBalance);
        if (appliedPto <= 0 && appliedSick <= 0) {
          // Already at/above cap — still stamp the day so we don't re-check every run.
          batch.set(balRef, { lastAccrualGrantDay: todayKey, updatedAt: Timestamp.now() }, { merge: true });
          writesInBatch += 1;
        } else {
          batch.set(balRef, {
            orgId,
            uid,
            ptoBalance: nextPto,
            sickBalance: nextSick,
            lastAccrualGrantDay: todayKey,
            updatedAt: Timestamp.now(),
            asOf: Timestamp.now(),
          }, { merge: true });
          writesInBatch += 1;

          const ledgerRef = db.collection('orgs').doc(orgId).collection('accrualLedger').doc();
          batch.set(ledgerRef, {
            orgId,
            userId: uid,
            type: 'adjustment',
            label: 'Automatic accrual grant',
            hours: num(appliedPto + appliedSick),
            balanceAfter: nextPto,
            source: 'accrual_grant',
            createdAt: Timestamp.now(),
            createdBy: 'system',
          });
          writesInBatch += 1;
        }

        if (writesInBatch >= 480) {
          await batch.commit();
          batch = db.batch();
          writesInBatch = 0;
        }
      }

      if (writesInBatch > 0) {
        await batch.commit();
      }
    }

    console.log(`[accrueTimeOff] Processed ${orgsSnap.size} org(s) with accrual enabled.`);
  }
);
