import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { externalNotify, sendgridApiKey } from '../infra/external-notify';
import { writeAudit } from '../infra/audit';

export const externalNotifyCallable = onCall({ secrets: [sendgridApiKey] }, async (req) => {
  const ctx = await resolveTenantWithFallback(req);
  if (!ctx.isAdminLike) {
    throw new HttpsError('permission-denied', 'Admin/Scheduler privileges required.');
  }
  const orgId = ctx.orgId;

  const db = initFirebase().firestore();
  const orgSnap = await db.collection('orgs').doc(orgId).get();
  if ((orgSnap.data() as any)?.isDemo === true) {
    throw new HttpsError('failed-precondition', 'Sending external notifications is disabled in demo mode.');
  }

  const channel = String(req.data?.channel || '').trim() as any;
  const to = String(req.data?.to || '').trim();
  const subject = String(req.data?.subject || '').trim() || undefined;
  const message = String(req.data?.message || '').trim();

  if (!channel || !['email','sms'].includes(channel)) throw new HttpsError('invalid-argument', 'channel must be email|sms.');
  if (!to) throw new HttpsError('invalid-argument', 'to is required.');
  if (!message) throw new HttpsError('invalid-argument', 'message is required.');

  const res = await externalNotify({ channel, to, subject, message, meta: { orgId, actorUid: ctx.uid } });

  await writeAudit(orgId, {
    action: 'externalNotify.placeholder',
    actorUid: ctx.uid,
    target: { to, channel },
    details: { subject },
  });

  return res;
});
