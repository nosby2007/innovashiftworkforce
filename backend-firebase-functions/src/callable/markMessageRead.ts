import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { messageReadDocId } from '../domain/refs';
import { Timestamp } from 'firebase-admin/firestore';

export const markMessageRead = onCall(async (req) => {
  const admin=initFirebase(); const db=admin.firestore();
  const ctx = await resolveTenantWithFallback(req);
  const orgId = ctx.orgId;
  const messageId=String(req.data?.messageId||''); if(!messageId) throw new HttpsError('invalid-argument','messageId is required.');
  const docId=messageReadDocId(messageId, ctx.uid);
  await db.collection('orgs').doc(orgId).collection('messageReads').doc(docId).set({
    orgId, messageId, userId: ctx.uid, readAt: Timestamp.now(),
  }, { merge:true });
  return { ok:true };
});
