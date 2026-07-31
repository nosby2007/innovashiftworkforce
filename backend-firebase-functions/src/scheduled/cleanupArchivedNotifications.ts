import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { initFirebase } from '../infra/firebase';

const RETENTION_DAYS = 10;

/**
 * Runs daily. When a user deletes a notification from the Notification
 * Center, NotificationsRepo.archive() soft-deletes it (archived=true) rather
 * than removing the document outright, so it can still be recovered if
 * needed. This sweep permanently deletes archived notifications once they've
 * sat past the RETENTION_DAYS grace period.
 *
 * Walks orgs -> userNotifications -> items instead of a collectionGroup
 * query so it only relies on Firestore's automatic single-field indexing
 * (collection-group scope needs an explicit index/field override, which
 * this avoids introducing).
 */
export const cleanupArchivedNotifications = onSchedule(
  { schedule: 'every 24 hours', region: 'us-east1', memory: '256MiB' },
  async () => {
    const admin = initFirebase();
    const db = admin.firestore();
    const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

    const orgRefs = await db.collection('orgs').listDocuments();
    let purged = 0;

    for (const orgRef of orgRefs) {
      const userRefs = await orgRef.collection('userNotifications').listDocuments();

      for (const userRef of userRefs) {
        const snap = await userRef.collection('items')
          .where('archived', '==', true)
          .limit(500)
          .get();
        if (snap.empty) continue;

        const batch = db.batch();
        let batchCount = 0;
        for (const docSnap of snap.docs) {
          const data = docSnap.data() as any;
          const archivedAtMs = data.archivedAt?.toMillis ? data.archivedAt.toMillis() : 0;
          if (archivedAtMs && archivedAtMs <= cutoffMs) {
            batch.delete(docSnap.ref);
            batchCount++;
          }
        }
        if (batchCount > 0) {
          await batch.commit();
          purged += batchCount;
        }
      }
    }

    logger.info(`[cleanupArchivedNotifications] Purged ${purged} notification(s) past the ${RETENTION_DAYS}-day retention window.`);
  }
);
