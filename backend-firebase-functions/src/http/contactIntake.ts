import { onRequest } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';

import { initFirebase } from '../infra/firebase';
import { externalNotify, sendgridApiKey } from '../infra/external-notify';
import { notifyPlatformAdmins } from '../infra/platform-alerts';
import { evaluateContactAbuseCounter } from '../domain/abuse-detection';

// So a demo request is never just sitting invisibly in Firestore waiting for
// someone to happen to check the console — this fires immediately and
// doesn't depend on any admin being online. Configurable without a
// redeploy-of-logic via env var.
const DEMO_REQUEST_NOTIFY_EMAIL = process.env.DEMO_REQUEST_NOTIFY_EMAIL || 'contact@innovacarereview.com';

function normalizeText(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashText(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

export const contactIntake = onRequest({ secrets: [sendgridApiKey] }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const name = normalizeText(req.body?.name, 120);
  const organization = normalizeText(req.body?.organization, 160);
  const email = normalizeText(req.body?.email, 160).toLowerCase();
  const size = normalizeText(req.body?.size, 40);
  const message = normalizeText(req.body?.message, 4000);
  const honeypot = normalizeText(req.body?.website, 200);

  if (honeypot) {
    // Silent success to discourage bots probing public forms.
    res.status(202).json({ ok: true });
    return;
  }

  if (name.length < 2) {
    res.status(400).json({ ok: false, error: 'Name is required.' });
    return;
  }
  if (!organization) {
    res.status(400).json({ ok: false, error: 'Organization is required.' });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ ok: false, error: 'A valid work email is required.' });
    return;
  }
  if (!size) {
    res.status(400).json({ ok: false, error: 'Team size is required.' });
    return;
  }

  const admin = initFirebase();
  const db = admin.firestore();

  const now = Timestamp.now();
  const nowMs = now.toMillis();
  const ip = normalizeText(req.headers['x-forwarded-for'] || req.ip, 120) || 'unknown';
  const fingerprint = hashText(`${email}|${organization}|${size}|${message}`).slice(0, 40);
  const rateLockId = hashText(`${email}|${ip}`).slice(0, 40);
  const rateLockRef = db.collection('contactRateLocks').doc(rateLockId);
  const rateWindowMs = 60 * 1000;

  let blocked = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rateLockRef);
    const expiresAt = snap.exists ? (snap.data() as any)?.expiresAt : null;
    const expiresMs = expiresAt?.toMillis ? expiresAt.toMillis() : 0;
    if (expiresMs > nowMs) {
      blocked = true;
      return;
    }
    tx.set(rateLockRef, {
      email,
      ipAddress: ip,
      fingerprint,
      updatedAt: now,
      expiresAt: Timestamp.fromMillis(nowMs + rateWindowMs),
    }, { merge: true });
  });

  if (blocked) {
    // Track blocks per-IP (independent of the per-email|ip rate lock above,
    // which resets every 60s) so a bot rotating email addresses from one
    // network still gets caught over a rolling 1-hour window.
    const ipHash = hashText(ip).slice(0, 40);
    const abuseCounterRef = db.collection('contactAbuseCounters').doc(ipHash);
    let abuseCount = 0;
    let shouldAlertAbuse = false;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(abuseCounterRef);
      const data = snap.exists ? (snap.data() as any) : null;
      const existing = data ? {
        count: Number(data.count || 0),
        windowStartAtMs: data.windowStartAt?.toMillis ? data.windowStartAt.toMillis() : nowMs,
        alertedAt: data.alertedAt?.toMillis ? data.alertedAt.toMillis() : null,
      } : null;
      const evalResult = evaluateContactAbuseCounter(existing, nowMs);
      abuseCount = evalResult.count;
      shouldAlertAbuse = evalResult.shouldAlert;

      tx.set(abuseCounterRef, {
        ipHash,
        count: evalResult.count,
        windowStartAt: Timestamp.fromMillis(evalResult.windowStartAtMs),
        alertedAt: evalResult.alertedAt != null ? Timestamp.fromMillis(evalResult.alertedAt) : null,
        expiresAt: Timestamp.fromMillis(nowMs + 60 * 60 * 1000),
      }, { merge: true });
    });

    // Outside the transaction — Firestore can retry the callback above on
    // contention, and notifyPlatformAdmins does non-transactional writes +
    // network (FCM) calls that must only ever fire once per real block.
    if (shouldAlertAbuse) {
      await notifyPlatformAdmins({
        type: 'contact_abuse',
        severity: 'warning',
        title: 'Contact form abuse detected',
        body: `${abuseCount} blocked submissions from one network in the last hour.`,
        meta: { ipHash },
      });
    }

    res.status(429).json({ ok: false, error: 'Too many requests. Please retry in one minute.' });
    return;
  }

  const requestId = fingerprint;
  const requestRef = db.collection('contactRequests').doc(requestId);
  const requestSnap = await requestRef.get();
  if (requestSnap.exists) {
    const existing = requestSnap.data() as any;
    const createdMs = existing?.createdAt?.toMillis ? existing.createdAt.toMillis() : 0;
    if (createdMs > 0 && nowMs - createdMs < 24 * 60 * 60 * 1000) {
      res.json({ ok: true, id: requestRef.id, duplicate: true });
      return;
    }
  }

  await requestRef.set({
    name,
    organization,
    email,
    size,
    message: message || null,
    fingerprint,
    source: 'web-contact',
    status: 'new',
    createdAt: now,
    updatedAt: now,
    userAgent: normalizeText(req.get('user-agent'), 300) || null,
    ipAddress: ip,
  });

  // Awaited (not fire-and-forget) so both emails actually complete before
  // the response is sent — Cloud Functions doesn't guarantee unawaited work
  // survives past the response, and the whole point here is that this
  // request gets handled even if nobody happens to be watching the
  // dashboard. Either send failing doesn't affect the caller's success
  // response — the Firestore doc is already the durable record either way.
  await Promise.allSettled([
    externalNotify({
      channel: 'email',
      to: DEMO_REQUEST_NOTIFY_EMAIL,
      subject: `New demo request — ${organization}`,
      message: `${name} (${email}) at ${organization} requested a demo.\n\nTeam size: ${size}\n${message ? `Message: ${message}\n` : ''}\nRequest id: ${requestRef.id}`,
      meta: { requestId: requestRef.id, organization, size },
    }),
    externalNotify({
      channel: 'email',
      to: email,
      subject: 'We received your demo request',
      message: `Hi ${name},\n\nThanks for your interest in InnovaShift Workforce for ${organization}. Our team will reach out within one business day to schedule your demo.\n\nIn the meantime, feel free to reply to this email with any questions.`,
      meta: { requestId: requestRef.id },
    }),
    notifyPlatformAdmins({
      type: 'contact_request',
      severity: 'info',
      title: 'New demo request',
      body: `${name} — ${organization}`,
      meta: { requestId: requestRef.id, email },
    }),
  ]).then((outcomes) => {
    const labels = ['to team', 'to requester', 'to platform admins'];
    outcomes.forEach((outcome, i) => {
      if (outcome.status === 'rejected') {
        console.error(`[contactIntake] notification ${labels[i] ?? i} failed`, outcome.reason);
      }
    });
  });

  res.json({ ok: true, id: requestRef.id });
});