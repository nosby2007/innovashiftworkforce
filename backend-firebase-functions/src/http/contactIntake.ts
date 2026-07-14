import { onRequest } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';

import { initFirebase } from '../infra/firebase';

function normalizeText(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashText(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

export const contactIntake = onRequest(async (req, res) => {
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

  res.json({ ok: true, id: requestRef.id });
});