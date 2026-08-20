import { createHash } from 'node:crypto';
import { logger } from 'firebase-functions';
import { initFirebase } from './firebase';

const MAX_TOKENS_PER_SEND = 500; // FCM sendEachForMulticast limit
const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export function pushTokenDocId(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 40);
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  /** All values must be strings — FCM data payloads only support string values. */
  data?: Record<string, string>;
  /** Optional web notification action buttons (e.g. "Accept" from a shift-available push). */
  webActions?: Array<{ action: string; title: string }>;
  /** URL opened when the notification body (not an action button) is clicked, on web. */
  link?: string;
}

interface TokenRef {
  ref: FirebaseFirestore.DocumentReference;
  token: string;
}

/** Shared low-level sender — chunks at the FCM multicast limit and prunes
 *  any token doc FCM reports as no longer valid. Best-effort — failures
 *  here must never block the caller's Firestore writes. */
async function sendToTokenRefs(tokenRefs: TokenRef[], payload: PushNotificationPayload, logLabel: string): Promise<void> {
  if (!tokenRefs.length) return;

  const admin = initFirebase();
  const messaging = admin.messaging();

  for (let i = 0; i < tokenRefs.length; i += MAX_TOKENS_PER_SEND) {
    const chunk = tokenRefs.slice(i, i + MAX_TOKENS_PER_SEND);
    try {
      const res = await messaging.sendEachForMulticast({
        tokens: chunk.map((c) => c.token),
        notification: { title: payload.title, body: payload.body },
        data: payload.data || {},
        webpush: {
          fcmOptions: payload.link ? { link: payload.link } : undefined,
          notification: payload.webActions?.length
            ? ({ actions: payload.webActions } as any)
            : undefined,
        },
      });

      const cleanup: Array<Promise<unknown>> = [];
      res.responses.forEach((r, idx) => {
        if (!r.success && r.error?.code && INVALID_TOKEN_CODES.has(r.error.code)) {
          cleanup.push(chunk[idx].ref.delete().catch(() => {}));
        }
      });
      if (cleanup.length) await Promise.all(cleanup);
    } catch (err) {
      logger.warn(`[push] sendEachForMulticast failed for ${logLabel}`, err as any);
    }
  }
}

/**
 * Sends a push notification to every registered device for the given users
 * and prunes tokens FCM reports as no longer valid. Best-effort — failures
 * here must never block the caller's Firestore writes.
 */
export async function sendPushToUids(orgId: string, uids: string[], payload: PushNotificationPayload): Promise<void> {
  const uniqueUids = Array.from(new Set(uids.filter(Boolean)));
  if (!uniqueUids.length) return;

  const admin = initFirebase();
  const db = admin.firestore();

  const tokenRefs: TokenRef[] = [];
  await Promise.all(uniqueUids.map(async (uid) => {
    const snap = await db.collection('orgs').doc(orgId).collection('users').doc(uid).collection('pushTokens').get();
    for (const doc of snap.docs) {
      const token = String((doc.data() as any)?.token || '').trim();
      if (token) tokenRefs.push({ ref: doc.ref, token });
    }
  }));

  await sendToTokenRefs(tokenRefs, payload, `org ${orgId}`);
}

/**
 * Same as sendPushToUids but reads device tokens from the org-independent
 * platformUsers/{uid}/pushTokens registry — used for platform-level alerts
 * (see infra/platform-alerts.ts) where the recipient (a super admin) isn't
 * necessarily scoped to any single org.
 */
export async function sendPushToPlatformAdmins(uids: string[], payload: PushNotificationPayload): Promise<void> {
  const uniqueUids = Array.from(new Set(uids.filter(Boolean)));
  if (!uniqueUids.length) return;

  const admin = initFirebase();
  const db = admin.firestore();

  const tokenRefs: TokenRef[] = [];
  await Promise.all(uniqueUids.map(async (uid) => {
    const snap = await db.collection('platformUsers').doc(uid).collection('pushTokens').get();
    for (const doc of snap.docs) {
      const token = String((doc.data() as any)?.token || '').trim();
      if (token) tokenRefs.push({ ref: doc.ref, token });
    }
  }));

  await sendToTokenRefs(tokenRefs, payload, 'platform admins');
}
