import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';

/**
 * Runs every 15 minutes.
 * Finds any shift with status 'open' or 'published' whose endAt has already
 * passed, marks it as 'expired', sets marketplaceVisible=false and expiredAt.
 * Shifts are never deleted — they remain available to managers for audit.
 */
export const expireShifts = onSchedule(
  { schedule: 'every 15 minutes', region: 'us-east1', memory: '256MiB' },
  async () => {
    const admin = initFirebase();
    const db = admin.firestore();
    const now = Timestamp.now();

    // Query all orgs is not practical; instead query the subcollection group.
    const snap = await db
      .collectionGroup('shifts')
      .where('status', 'in', ['open', 'published'])
      .where('endAt', '<', now)
      .limit(500)
      .get();

    if (snap.empty) return;

    const batch = db.batch();
    const auditBatch = db.batch();
    let batchCount = 0;

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as any;
      // Skip if already has assignedUserId (shouldn't happen for open, but safety)
      if (data.assignedUserId) continue;

      batch.update(docSnap.ref, {
        status: 'expired',
        marketplaceVisible: false,
        expiredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        auditLog: FieldValue.arrayUnion({
          action: 'EXPIRED',
          actorUserId: 'system',
          at: Timestamp.now(),
          note: 'Auto-expired by scheduler: shift end time has passed.',
        }),
      });

      batchCount++;
      if (batchCount >= 490) break; // Firestore batch limit is 500
    }

    await batch.commit();

    logger.info(`[expireShifts] Expired ${batchCount} shifts.`);
  }
);
