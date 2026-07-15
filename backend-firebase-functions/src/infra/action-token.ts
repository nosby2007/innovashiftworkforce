import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { defineSecret } from 'firebase-functions/params';

export const actionTokenSecret = defineSecret('ACTION_TOKEN_SECRET');

export interface ShiftActionTokenPayload {
  orgId: string;
  uid: string;
  shiftId: string;
  action: 'claim';
  exp: number; // epoch ms
  jti: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(payload).digest());
}

/**
 * Signs a short-lived, single-use token so a push notification's "Accept"
 * action can claim a shift without a live Firebase Auth session in the
 * service worker. jti is checked/consumed server-side by the caller.
 */
export function signShiftActionToken(
  params: Omit<ShiftActionTokenPayload, 'exp' | 'jti'>,
  secret: string,
  ttlMs = 15 * 60 * 1000
): string {
  const payload: ShiftActionTokenPayload = {
    ...params,
    exp: Date.now() + ttlMs,
    jti: randomBytes(12).toString('base64url'),
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyShiftActionToken(token: string, secret: string): ShiftActionTokenPayload {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('Malformed action token.');
  const [encodedPayload, signature] = parts;

  const expectedSignature = sign(encodedPayload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid action token signature.');
  }

  let payload: ShiftActionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Malformed action token payload.');
  }

  if (!payload.orgId || !payload.uid || !payload.shiftId || !payload.jti) {
    throw new Error('Incomplete action token payload.');
  }
  if (!payload.exp || Date.now() > payload.exp) {
    throw new Error('This link has expired.');
  }

  return payload;
}
