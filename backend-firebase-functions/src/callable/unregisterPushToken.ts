import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { pushTokenDocId } from '../infra/push';

export const unregisterPushToken = onCall(async (req) => {
  const ctx = await resolveTenantWithFallback(req);
  const admin = initFirebase();
  const db = admin.firestore();

  const token = String(req.data?.token || '').trim();
  if (!token) throw new HttpsError('invalid-argument', 'token is required.');

  const docId = pushTokenDocId(token);
  await db.collection('orgs').doc(ctx.orgId).collection('users').doc(ctx.uid)
    .collection('pushTokens').doc(docId).delete();

  return { ok: true };
});
