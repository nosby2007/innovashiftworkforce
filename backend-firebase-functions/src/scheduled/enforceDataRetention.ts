import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { Timestamp } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import { initFirebase } from '../infra/firebase';
import { writeAudit } from '../infra/audit';

/**
 * Runs daily. Enforces docs/DATA_RETENTION_POLICY.md in two tiers:
 *
 * 1. Unconditional — categories with no legal retention floor a wrong
 *    number could violate, purged for every org regardless of settings:
 *     - direct-deposit bank info, purged shortly after termination (pure
 *       data minimization — no legitimate reason to keep it once
 *       employment ends)
 *     - audit logs, purged only once *past* HIPAA's own 6-year
 *       documentation retention ceiling (45 CFR 164.316(b)(2)(i))
 *     - client error logs and expired contact-form rate locks, both pure
 *       diagnostics/abuse-prevention state with no retention value
 *
 * 2. Confirmed-only — time entries, payroll runs, the PTO ledger,
 *    time-off requests, and employee documents have real legal retention
 *    floors that vary by org jurisdiction. These are only purged for an
 *    org that has explicitly set a `dataRetention.*Years` figure in Org
 *    Settings (admin-org-settings.page.ts) — i.e. a human has confirmed
 *    the number for their jurisdiction. An org that has never set these
 *    fields keeps everything forever, which is the safe default. See
 *    docs/DATA_RETENTION_POLICY.md §3.
 *
 * Walks orgs -> subcollections instead of collectionGroup queries, same as
 * cleanupArchivedNotifications, so this doesn't need new collection-group
 * indexes.
 */

const BANK_INFO_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days post-termination
const AUDIT_LOG_RETENTION_MS = 6 * 365 * 24 * 60 * 60 * 1000; // 6 years (HIPAA ceiling)
const CLIENT_ERROR_LOG_RETENTION_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
const BATCH_LIMIT = 450;

interface OrgDataRetention {
  timeEntriesYears?: number | null;
  payrollRunsYears?: number | null;
  accrualLedgerYears?: number | null;
  timeOffRequestsYears?: number | null;
  employeeDocumentsYearsAfterTermination?: number | null;
}

function toMs(value: unknown): number {
  const asAny = value as { toMillis?: () => number } | null | undefined;
  if (asAny && typeof asAny.toMillis === 'function') return asAny.toMillis();
  return 0;
}

function yearsToMs(years: number): number {
  return years * 365 * 24 * 60 * 60 * 1000;
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

// ── Confirmed-only categories (org must opt in via a set *Years figure) ──

async function writeRetentionAudit(orgId: string, action: string, category: string, years: number, count: number): Promise<void> {
  if (count <= 0) return;
  await writeAudit(orgId, {
    actorUserId: 'system',
    action,
    entityType: category,
    details: {
      reason: `${category} purged past the org-confirmed ${years}-year retention period.`,
      count,
    },
  }).catch((e) => logger.error(`[enforceDataRetention] failed to write audit for ${category} purge`, e));
}

async function purgeExpiredTimeEntries(db: FirebaseFirestore.Firestore, orgId: string, years: number, nowMs: number): Promise<number> {
  const cutoffMs = nowMs - yearsToMs(years);
  const snap = await db.collection('orgs').doc(orgId).collection('timeEntries')
    .where('checkInAt', '<=', Timestamp.fromMillis(cutoffMs))
    .limit(BATCH_LIMIT)
    .get();
  if (snap.empty) return 0;

  const batch = db.batch();
  let count = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as any;
    if (!data.checkOutAt) continue; // never purge an open/unfinished punch
    batch.delete(docSnap.ref);
    count += 1;
  }
  if (count === 0) return 0;
  await batch.commit();
  await writeRetentionAudit(orgId, 'RETENTION_PURGE_TIME_ENTRIES', 'timeEntries', years, count);
  return count;
}

async function purgeExpiredPayrollRuns(db: FirebaseFirestore.Firestore, orgId: string, years: number, nowMs: number): Promise<number> {
  const cutoffDateStr = new Date(nowMs - yearsToMs(years)).toISOString().slice(0, 10);
  const snap = await db.collection('orgs').doc(orgId).collection('payrollRuns')
    .where('periodEnd', '<=', cutoffDateStr)
    .limit(BATCH_LIMIT)
    .get();
  if (snap.empty) return 0;

  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  await writeRetentionAudit(orgId, 'RETENTION_PURGE_PAYROLL_RUNS', 'payrollRuns', years, snap.size);
  return snap.size;
}

async function purgeExpiredAccrualLedger(db: FirebaseFirestore.Firestore, orgId: string, years: number, nowMs: number): Promise<number> {
  const cutoffMs = nowMs - yearsToMs(years);
  const snap = await db.collection('orgs').doc(orgId).collection('accrualLedger')
    .where('createdAt', '<=', Timestamp.fromMillis(cutoffMs))
    .limit(BATCH_LIMIT)
    .get();
  if (snap.empty) return 0;

  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  await writeRetentionAudit(orgId, 'RETENTION_PURGE_ACCRUAL_LEDGER', 'accrualLedger', years, snap.size);
  return snap.size;
}

async function purgeExpiredTimeOffRequests(db: FirebaseFirestore.Firestore, orgId: string, years: number, nowMs: number): Promise<number> {
  const cutoffMs = nowMs - yearsToMs(years);
  const snap = await db.collection('orgs').doc(orgId).collection('requests')
    .where('createdAt', '<=', Timestamp.fromMillis(cutoffMs))
    .limit(BATCH_LIMIT)
    .get();
  if (snap.empty) return 0;

  const batch = db.batch();
  let count = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as any;
    if (data.status === 'pending') continue; // never purge a genuinely unresolved request
    batch.delete(docSnap.ref);
    count += 1;
  }
  if (count === 0) return 0;
  await batch.commit();
  await writeRetentionAudit(orgId, 'RETENTION_PURGE_TIME_OFF_REQUESTS', 'timeOffRequests', years, count);
  return count;
}

async function purgeExpiredEmployeeDocuments(
  db: FirebaseFirestore.Firestore,
  bucket: Bucket,
  orgId: string,
  years: number,
  nowMs: number
): Promise<number> {
  const thresholdMs = yearsToMs(years);
  const revokedSnap = await db.collection('orgs').doc(orgId).collection('users')
    .where('active', '==', false)
    .limit(500)
    .get();

  let purged = 0;
  for (const userDoc of revokedSnap.docs) {
    const data = userDoc.data() as any;
    const revokedAtMs = toMs(data.revokedAt);
    if (!revokedAtMs || nowMs - revokedAtMs < thresholdMs) continue;

    const docsSnap = await db.collection('orgs').doc(orgId).collection('employeeDocuments')
      .where('userId', '==', userDoc.id)
      .limit(BATCH_LIMIT)
      .get();
    if (docsSnap.empty) continue;

    for (const docSnap of docsSnap.docs) {
      const storagePath = (docSnap.data() as any)?.storagePath;
      if (storagePath) {
        await bucket.file(storagePath).delete().catch(() => undefined);
      }
    }

    const batch = db.batch();
    docsSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    purged += docsSnap.size;

    await writeAudit(orgId, {
      actorUserId: 'system',
      action: 'RETENTION_PURGE_EMPLOYEE_DOCUMENTS',
      entityType: 'user',
      entityId: userDoc.id,
      details: {
        reason: `Employee documents purged ${years}+ year(s) after termination per confirmed org data retention policy.`,
        count: docsSnap.size,
      },
    }).catch((e) => logger.error('[enforceDataRetention] failed to write audit for employee document purge', e));
  }

  return purged;
}

async function enforceConfirmedRetentionForOrgs(
  db: FirebaseFirestore.Firestore,
  bucket: Bucket,
  nowMs: number
): Promise<{ timeEntries: number; payrollRuns: number; accrualLedger: number; timeOffRequests: number; employeeDocuments: number }> {
  const totals = { timeEntries: 0, payrollRuns: 0, accrualLedger: 0, timeOffRequests: 0, employeeDocuments: 0 };
  const orgsSnap = await db.collection('orgs').get();

  for (const orgDoc of orgsSnap.docs) {
    const retention: OrgDataRetention = (orgDoc.data() as any)?.dataRetention || {};
    const orgId = orgDoc.id;

    if (retention.timeEntriesYears) {
      totals.timeEntries += await purgeExpiredTimeEntries(db, orgId, retention.timeEntriesYears, nowMs);
    }
    if (retention.payrollRunsYears) {
      totals.payrollRuns += await purgeExpiredPayrollRuns(db, orgId, retention.payrollRunsYears, nowMs);
    }
    if (retention.accrualLedgerYears) {
      totals.accrualLedger += await purgeExpiredAccrualLedger(db, orgId, retention.accrualLedgerYears, nowMs);
    }
    if (retention.timeOffRequestsYears) {
      totals.timeOffRequests += await purgeExpiredTimeOffRequests(db, orgId, retention.timeOffRequestsYears, nowMs);
    }
    if (retention.employeeDocumentsYearsAfterTermination) {
      totals.employeeDocuments += await purgeExpiredEmployeeDocuments(db, bucket, orgId, retention.employeeDocumentsYearsAfterTermination, nowMs);
    }
  }

  return totals;
}

export const enforceDataRetention = onSchedule(
  { schedule: 'every 24 hours', region: 'us-east1', memory: '256MiB' },
  async () => {
    const admin = initFirebase();
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const nowMs = Date.now();

    const [bankInfoPurged, auditLogsPurged, errorLogsPurged, rateLocksPurged, confirmed] = await Promise.all([
      purgeExpiredBankInfo(db, nowMs),
      purgeExpiredAuditLogs(db, nowMs),
      purgeExpiredClientErrorLogs(db, nowMs),
      purgeExpiredContactRateLocks(db, nowMs),
      enforceConfirmedRetentionForOrgs(db, bucket, nowMs),
    ]);

    logger.info(
      `[enforceDataRetention] Unconditional: ${bankInfoPurged} bank info record(s), ${auditLogsPurged} audit log(s) past 6yr, ` +
      `${errorLogsPurged} client error log(s) past 1yr, ${rateLocksPurged} expired contact rate lock(s). ` +
      `Confirmed-only: ${confirmed.timeEntries} time entries, ${confirmed.payrollRuns} payroll runs, ` +
      `${confirmed.accrualLedger} accrual ledger entries, ${confirmed.timeOffRequests} time-off requests, ` +
      `${confirmed.employeeDocuments} employee documents.`
    );
  }
);
