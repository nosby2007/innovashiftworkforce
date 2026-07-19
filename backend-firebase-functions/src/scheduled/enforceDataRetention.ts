import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { writeAudit } from '../infra/audit';

/**
 * Runs daily. Enforces docs/DATA_RETENTION_POLICY.md for the categories
 * that have no real legal retention floor a wrong number could violate:
 *  - direct-deposit bank info, purged shortly after termination (pure data
 *    minimization — no legitimate reason to keep it once employment ends)
 *  - audit logs, purged only once *past* HIPAA's own 6-year documentation
 *    retention ceiling (45 CFR 164.316(b)(2)(i)) — this never deletes
 *    anything HIPAA requires keeping
 *  - client error logs and expired contact-form rate locks, both pure
 *    diagnostics/abuse-prevention state with no retention value at all
 *
 * Deliberately does NOT touch time entries, payroll runs, the PTO ledger,
 * time-off requests, or employee documents — those have real legal
 * retention floors that vary by org jurisdiction and need a confirmed,
 * per-org figure before any automated deletion is safe. See
 * docs/DATA_RETENTION_POLICY.md §3.
 *
 * Walks orgs -> subcollections instead of a collectionGroup query, same as
 * cleanupArchivedNotifications, so this doesn't need a new collection-group
 * index.
 */

const BANK_INFO_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days post-termination
const AUDIT_LOG_RETENTION_MS = 6 * 365 * 24 * 60 * 60 * 1000; // 6 years (HIPAA ceiling)
const CLIENT_ERROR_LOG_RETENTION_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
const BATCH_LIMIT = 450;

function toMs(value: unknown): number {
  const asAny = value as { toMillis?: () => number } | null | undefined;
  if (asAny && typeof asAny.toMillis === 'function') return asAny.toMillis();
  return 0;
}

async function purgeExpiredBankInfo(db: FirebaseFirestore.Firestore, nowMs: number): Promise<number> {
  let purged = 0;
  const orgRefs = await db.collection('orgs').listDocuments();

  for (const orgRef of orgRefs) {
    const revokedSnap = await orgRef.collection('users')
      .where('active', '==', false)
      .limit(500)
      .get();

    for (const userDoc of revokedSnap.docs) {
      const data = userDoc.data() as any;
      const revokedAtMs = toMs(data.revokedAt);
      if (!revokedAtMs || nowMs - revokedAtMs < BANK_INFO_RETENTION_MS) continue;

      const bankRef = userDoc.ref.collection('private').doc('bankInfo');
      const bankSnap = await bankRef.get();
      if (!bankSnap.exists) continue;

      await bankRef.delete();
      purged += 1;

      await writeAudit(orgRef.id, {
        actorUserId: 'system',
        action: 'RETENTION_PURGE_BANK_INFO',
        entityType: 'user',
        entityId: userDoc.id,
        details: { reason: 'Direct deposit info purged 90+ days after termination per data retention policy.' },
      }).catch((e) => logger.error('[enforceDataRetention] failed to write audit for bank info purge', e));
    }
  }

  return purged;
}

async function purgeExpiredAuditLogs(db: FirebaseFirestore.Firestore, nowMs: number): Promise<number> {
  const cutoffMs = nowMs - AUDIT_LOG_RETENTION_MS;
  let purged = 0;
  const orgRefs = await db.collection('orgs').listDocuments();

  for (const orgRef of orgRefs) {
    const snap = await orgRef.collection('auditLogs')
      .where('createdAt', '<=', Timestamp.fromMillis(cutoffMs))
      .limit(BATCH_LIMIT)
      .get();
    if (snap.empty) continue;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    purged += snap.size;
  }

  return purged;
}

async function purgeExpiredClientErrorLogs(db: FirebaseFirestore.Firestore, nowMs: number): Promise<number> {
  const cutoffMs = nowMs - CLIENT_ERROR_LOG_RETENTION_MS;
  const snap = await db.collection('clientErrorLogs')
    .where('createdAt', '<=', Timestamp.fromMillis(cutoffMs))
    .limit(BATCH_LIMIT)
    .get();
  if (snap.empty) return 0;

  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

async function purgeExpiredContactRateLocks(db: FirebaseFirestore.Firestore, nowMs: number): Promise<number> {
  const snap = await db.collection('contactRateLocks')
    .where('expiresAt', '<=', Timestamp.fromMillis(nowMs))
    .limit(BATCH_LIMIT)
    .get();
  if (snap.empty) return 0;

  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

export const enforceDataRetention = onSchedule(
  { schedule: 'every 24 hours', region: 'us-east1', memory: '256MiB' },
  async () => {
    const admin = initFirebase();
    const db = admin.firestore();
    const nowMs = Date.now();

    const [bankInfoPurged, auditLogsPurged, errorLogsPurged, rateLocksPurged] = await Promise.all([
      purgeExpiredBankInfo(db, nowMs),
      purgeExpiredAuditLogs(db, nowMs),
      purgeExpiredClientErrorLogs(db, nowMs),
      purgeExpiredContactRateLocks(db, nowMs),
    ]);

    logger.info(
      `[enforceDataRetention] Purged ${bankInfoPurged} bank info record(s), ${auditLogsPurged} audit log(s) past 6yr, ` +
      `${errorLogsPurged} client error log(s) past 1yr, ${rateLocksPurged} expired contact rate lock(s).`
    );
  }
);
