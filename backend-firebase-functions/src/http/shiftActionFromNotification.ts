import { onRequest } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { writeAudit } from '../infra/audit';
import { claimShiftForUser } from '../infra/claim-shift.core';
import { actionTokenSecret, verifyShiftActionToken } from '../infra/action-token';

const APP_URL = process.env.APP_URL || 'https://innovashiftworkforce.com';

function redirectTo(res: any, path: string, params: Record<string, string>) {
  const url = new URL(path, APP_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  res.redirect(302, url.toString());
}

/**
 * Fired when a user taps "Accept" on a shift-available push notification.
 * Uses a short-lived signed token instead of a Firebase Auth session
 * because the browser/OS may invoke this outside of an open app tab.
 */
export const shiftActionFromNotification = onRequest({ secrets: [actionTokenSecret] }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const token = String(req.query?.t || '');
  const admin = initFirebase();
  const db = admin.firestore();

  let payload;
  try {
    payload = verifyShiftActionToken(token, actionTokenSecret.value());
  } catch (err: any) {
    redirectTo(res, '/app/marketplace', { pushAction: 'error', reason: err?.message || 'invalid_token' });
    return;
  }

  const { orgId, uid, shiftId, jti } = payload;

  // Single-use: claim the jti before attempting the shift claim itself.
  const useRef = db.collection('orgs').doc(orgId).collection('actionTokenUses').doc(jti);
  try {
    await useRef.create({ uid, shiftId, action: payload.action, usedAt: Timestamp.now() });
  } catch {
    redirectTo(res, '/app/marketplace', { pushAction: 'error', reason: 'already_used' });
    return;
  }

  try {
    await claimShiftForUser(db, orgId, uid, shiftId);
    await writeAudit(orgId, { actorUserId: uid, action: 'SHIFT_CLAIMED', entityType: 'shift', entityId: shiftId, details: { via: 'push_notification' } });
    redirectTo(res, '/app/marketplace', { pushAction: 'claimed', shiftId });
  } catch (err: any) {
    redirectTo(res, '/app/marketplace', { pushAction: 'error', reason: err?.message || 'claim_failed', shiftId });
  }
});
