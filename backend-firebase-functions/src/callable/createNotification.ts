import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';

function hashText(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

export const createNotification = onCall(async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();

  const ctx = await resolveTenantWithFallback(req);
  if (!ctx.isAdminLike) {
    throw new HttpsError('permission-denied', 'Admin/Scheduler privileges required.');
  }
  const orgId = ctx.orgId;

  const uid = String(req.data?.uid || '').trim();
  const title = String(req.data?.title || '').trim();
  const body = String(req.data?.body || '').trim().slice(0, 2000);
  const type = String(req.data?.type || 'system').trim();
  const idempotencyKey = String(req.data?.idempotencyKey || '').trim();

  if (!uid) throw new HttpsError('invalid-argument', 'uid is required.');
  if (!title) throw new HttpsError('invalid-argument', 'title is required.');
  if (title.length > 180) throw new HttpsError('invalid-argument', 'title is too long.');
  if (!['system', 'alert', 'reminder', 'message'].includes(type)) {
    throw new HttpsError('invalid-argument', 'type must be one of system, alert, reminder, message.');
  }

  const dedupeBucket = Math.floor(Date.now() / (2 * 60 * 1000));
  const dedupeSource = idempotencyKey || `${orgId}|${uid}|${type}|${title}|${body}|${ctx.uid}|${dedupeBucket}`;
  const dedupeId = hashText(dedupeSource).slice(0, 40);

  const col = db.collection('orgs').doc(orgId)
    .collection('userNotifications').doc(uid)
    .collection('items');
  const ref = col.doc(dedupeId);

  const existing = await ref.get();
  if (existing.exists) {
    return { ok: true, id: ref.id, duplicate: true };
  }

  await ref.set({
    orgId,
    uid,
    type,
    title,
    body,
    read: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    createdBy: ctx.uid,
    idempotencyKey: idempotencyKey || null,
  });

  await writeAudit(orgId, { action: 'notification.create', actorUid: ctx.uid, target: { uid }, details: { title, type } });

  return { ok: true, id: ref.id };
});
