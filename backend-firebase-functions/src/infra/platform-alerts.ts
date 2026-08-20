import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { initFirebase } from './firebase';
import { sendPushToPlatformAdmins } from './push';

export type PlatformAlertType = 'contact_request' | 'sandbox_abuse' | 'contact_abuse';
export type PlatformAlertSeverity = 'info' | 'warning';

export interface PlatformAlertInput {
  type: PlatformAlertType;
  severity: PlatformAlertSeverity;
  title: string;
  body: string;
  meta?: Record<string, unknown>;
}

/**
 * Writes a shared platformNotifications doc (read by every super admin —
 * "read" state is tracked per-admin via the readBy array rather than one
 * doc per recipient, since the audience is small and shares one inbox) and
 * best-effort pushes every registered super-admin device. Never throws —
 * this fires from public, unauthenticated entry points (contactIntake.ts,
 * provisionSandboxOrg.ts) and must never be the reason a legitimate request
 * fails.
 */
export async function notifyPlatformAdmins(input: PlatformAlertInput): Promise<void> {
  try {
    const admin = initFirebase();
    const db = admin.firestore();

    const adminsSnap = await db.collection('users').where('platformRole', '==', 'superAdmin').get();
    const uids = adminsSnap.docs.map((d) => d.id);

    await db.collection('platformNotifications').add({
      type: input.type,
      severity: input.severity,
      title: input.title,
      body: input.body,
      meta: input.meta || null,
      createdAt: Timestamp.now(),
      readBy: [],
    });

    if (uids.length) {
      await sendPushToPlatformAdmins(uids, {
        title: input.title,
        body: input.body,
        data: { type: input.type },
        link: '/platform/alerts',
      });
    }
  } catch (err) {
    logger.warn(`[platform-alerts] notifyPlatformAdmins failed for type=${input.type}`, err as any);
  }
}
