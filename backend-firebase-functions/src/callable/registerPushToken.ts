import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { pushTokenDocId } from '../infra/push';

const ALLOWED_PLATFORMS = new Set(['web', 'android', 'ios']);
const MAX_TOKENS_PER_USER = 10;

export const registerPushToken = onCall(async (req) => {
  const ctx = await resolveTenantWithFallback(req);
  const admin = initFirebase();
  const db = admin.firestore();

  const token = String(req.data?.token || '').trim();
  const platform = String(req.data?.platform || '').trim().toLowerCase();

  if (!token) throw new HttpsError('invalid-argument', 'token is required.');
  if (token.length > 4096) throw new HttpsError('invalid-argument', 'token is too long.');
  if (!ALLOWED_PLATFORMS.has(platform)) throw new HttpsError('invalid-argument', 'platform must be one of web, android, ios.');

  const tokensCol = db.collection('orgs').doc(ctx.orgId).collection('users').doc(ctx.uid).collection('pushTokens');
  const docId = pushTokenDocId(token);
  const now = Timestamp.now();

  await tokensCol.doc(docId).set({
    token,
    platform,
    updatedAt: now,
    createdAt: now,
  }, { merge: true });

  // Cap devices per user — drop the oldest beyond the limit rather than growing unbounded.
  const snap = await tokensCol.orderBy('updatedAt', 'desc').get();
  if (snap.size > MAX_TOKENS_PER_USER) {
    const stale = snap.docs.slice(MAX_TOKENS_PER_USER);
    await Promise.all(stale.map((d) => d.ref.delete()));
  }

  return { ok: true };
});
