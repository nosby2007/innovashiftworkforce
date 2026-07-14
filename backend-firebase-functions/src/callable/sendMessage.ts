import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { writeAudit } from '../infra/audit';
import { externalNotify, sendgridApiKey } from '../infra/external-notify';

type TargetType = 'single' | 'multi' | 'orgAll' | 'platformAll';

type Recipient = {
  orgId: string;
  uid: string;
  email?: string | null;
};

export const sendMessage = onCall({ secrets: [sendgridApiKey] }, async (req) => {
  const admin = initFirebase();
  const db = admin.firestore();

  const ctx = await resolveTenantWithFallback(req);
  if (!ctx.isAdminLike && !ctx.isSuperAdmin) {
    throw new HttpsError('permission-denied', 'Admin-level privileges required.');
  }

  const title = String(req.data?.title || '').trim();
  const body = String(req.data?.body || '').trim();
  const type = String(req.data?.type || 'announcement').trim();
  const targetType = String(req.data?.targetType || 'orgAll').trim() as TargetType;
  const inApp = req.data?.inApp !== false;
  const internet = req.data?.internet === true;
  const internetChannel = String(req.data?.internetChannel || 'email').trim();
  const userIds = Array.isArray(req.data?.userIds)
    ? (req.data.userIds as any[]).map((x) => String(x || '').trim()).filter(Boolean)
    : [];

  if (!title) throw new HttpsError('invalid-argument', 'title is required.');
  if (!body) throw new HttpsError('invalid-argument', 'body is required.');
  if (!['single', 'multi', 'orgAll', 'platformAll'].includes(targetType)) {
    throw new HttpsError('invalid-argument', 'targetType must be single|multi|orgAll|platformAll.');
  }
  if (internet && !['email', 'sms'].includes(internetChannel)) {
    throw new HttpsError('invalid-argument', 'internetChannel must be email|sms.');
  }

  if (targetType === 'platformAll' && !ctx.isSuperAdmin) {
    throw new HttpsError('permission-denied', 'Only super-admin can send platform-wide messages.');
  }

  const recipients: Recipient[] = [];

  if (targetType === 'single' || targetType === 'multi') {
    if (!userIds.length) {
      throw new HttpsError('invalid-argument', 'userIds is required for single/multi targetType.');
    }

    const unique = Array.from(new Set(userIds));
    if (unique.length > 200) {
      throw new HttpsError('invalid-argument', 'Too many userIds (max 200).');
    }

    const userSnaps = await Promise.all(
      unique.map((uid) => db.collection('orgs').doc(ctx.orgId).collection('users').doc(uid).get())
    );

    for (const snap of userSnaps) {
      if (!snap.exists) continue;
      const u = snap.data() as any;
      recipients.push({ orgId: ctx.orgId, uid: snap.id, email: u?.email || null });
    }

    if (!recipients.length) {
      throw new HttpsError('not-found', 'No recipients found in this organization.');
    }
  }

  if (targetType === 'orgAll') {
    const snap = await db.collection('orgs').doc(ctx.orgId).collection('users').limit(1000).get();
    recipients.push(
      ...snap.docs.map((d) => {
        const u = d.data() as any;
        return { orgId: ctx.orgId, uid: d.id, email: u?.email || null } as Recipient;
      })
    );

    if (!recipients.length) {
      throw new HttpsError('not-found', 'No users found in this organization.');
    }
  }

  if (targetType === 'platformAll') {
    const snap = await db.collectionGroup('users').limit(2000).get();
    for (const d of snap.docs) {
      const path = d.ref.path;
      if (!path.startsWith('orgs/')) continue;
      const orgId = path.split('/')[1] || '';
      if (!orgId) continue;
      const u = d.data() as any;
      recipients.push({ orgId, uid: d.id, email: u?.email || null });
    }

    if (!recipients.length) {
      throw new HttpsError('not-found', 'No platform users found.');
    }
  }

  const now = Timestamp.now();
  const uniqueRecipientKey = new Set<string>();
  const deduped = recipients.filter((r) => {
    const k = `${r.orgId}:${r.uid}`;
    if (uniqueRecipientKey.has(k)) return false;
    uniqueRecipientKey.add(k);
    return true;
  });

  if (inApp) {
    const writes: Promise<any>[] = [];

    if (targetType === 'orgAll' || targetType === 'platformAll') {
      const orgIds = Array.from(new Set(deduped.map((r) => r.orgId)));
      for (const orgId of orgIds) {
        const msgRef = db.collection('orgs').doc(orgId).collection('messages').doc();
        writes.push(
          msgRef.set({
            orgId,
            title,
            body,
            type,
            audience: targetType === 'platformAll' ? 'platformAll' : 'orgAll',
            createdBy: ctx.uid,
            createdAt: now,
          })
        );
      }
    }

    for (const r of deduped) {
      const notifRef = db.collection('orgs').doc(r.orgId)
        .collection('userNotifications').doc(r.uid)
        .collection('items').doc();

      writes.push(
        notifRef.set({
          orgId: r.orgId,
          uid: r.uid,
          type,
          title,
          body,
          read: false,
          createdAt: now,
          updatedAt: now,
          createdBy: ctx.uid,
          meta: {
            targetType,
            internet,
          },
        })
      );
    }

    await Promise.all(writes);
  }

  if (internet) {
    const targets = deduped.filter((r) => Boolean(r.email));
    const sends: Promise<any>[] = [];
    for (const r of targets) {
      sends.push(
        externalNotify({
          channel: internetChannel as 'email' | 'sms',
          to: String(r.email),
          subject: title,
          message: body,
          meta: { orgId: r.orgId, uid: r.uid, actorUid: ctx.uid, targetType },
        })
      );
    }
    await Promise.all(sends);
  }

  await writeAudit(ctx.orgId, {
    actorUserId: ctx.uid,
    action: 'MESSAGE_SENT',
    entityType: 'message',
    entityId: 'bulk',
    targetType,
    recipientCount: deduped.length,
    internet,
    internetChannel,
    title,
  });

  return {
    ok: true,
    targetType,
    recipientCount: deduped.length,
    inApp,
    internet,
  };
});
