import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import {
  AccrualTier,
  num,
  todayKeyUTC,
  grantsPerYear,
  isGrantDay,
  tenureMonths,
  pickTier,
  normalizeAccrualBalance as normalizeBalance,
} from '../domain/accrual';

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
      logger.info('[accrueTimeOff] No orgs with accrual enabled.');
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

    logger.info(`[accrueTimeOff] Processed ${orgsSnap.size} org(s) with accrual enabled.`);
  }
);
