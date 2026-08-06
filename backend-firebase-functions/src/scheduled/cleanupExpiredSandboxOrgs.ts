import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';

/**
 * Tears down expired "try a live demo" sandbox orgs (see
 * callable/provisionSandboxOrg.ts). Runs every 15 minutes — much finer than
 * enforceDataRetention.ts's daily sweep, since demoExpiresAt operates on
 * hours, not days, and an expired sandbox org's Auth user must not sit
 * live for up to a day after expiry.
 *
 * Each org is torn down inside its own try/catch so one failing org can
 * never block cleanup of the rest of the sweep — a gap enforceDataRetention
 * doesn't need to close (real customer orgs are never bulk-deleted there)
 * but this function must.
 */
export const cleanupExpiredSandboxOrgs = onSchedule(
  { schedule: 'every 15 minutes', region: 'us-east1', memory: '256MiB', timeoutSeconds: 300 },
  async () => {
    const admin = initFirebase();
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const nowMs = Date.now();

    const dueSnap = await db.collection('orgs')
      .where('isDemo', '==', true)
      .where('demoExpiresAt', '<=', Timestamp.fromMillis(nowMs))
      .limit(50)
      .get();

    let cleaned = 0;
    for (const orgDoc of dueSnap.docs) {
      const orgId = orgDoc.id;
      try {
        const orgData = orgDoc.data() as Record<string, unknown>;
        const demoAdminUid = String(orgData?.demoAdminUid || '');

        const usersSnap = await db.collection('orgs').doc(orgId).collection('users').get();
        const seenUids = new Set<string>();
        await Promise.all(usersSnap.docs.map((u) => {
          seenUids.add(u.id);
          return admin.auth().deleteUser(u.id).catch(() => undefined);
        }));
        if (demoAdminUid && !seenUids.has(demoAdminUid)) {
          await admin.auth().deleteUser(demoAdminUid).catch(() => undefined);
        }

        await db.doc(`orgDirectory/${orgId}`).delete().catch(() => undefined);
        if (demoAdminUid) {
          await db.doc(`users/${demoAdminUid}`).delete().catch(() => undefined);
        }

        await admin.firestore().recursiveDelete(db.collection('orgs').doc(orgId));

        await bucket.deleteFiles({ prefix: `orgs/${orgId}/` }).catch((e) =>
          logger.warn(`[cleanupExpiredSandboxOrgs] storage cleanup failed for ${orgId}`, e)
        );

        cleaned += 1;
      } catch (e) {
        logger.error(`[cleanupExpiredSandboxOrgs] failed to clean up sandbox org ${orgId}`, e);
      }
    }

    logger.info(`[cleanupExpiredSandboxOrgs] removed ${cleaned}/${dueSnap.size} expired sandbox org(s)`);
  }
);
