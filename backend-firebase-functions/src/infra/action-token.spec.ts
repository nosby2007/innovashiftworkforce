import { describe, it, expect } from 'vitest';
import { signShiftActionToken, verifyShiftActionToken } from './action-token';

const SECRET = 'test-secret';

describe('shift action token', () => {
  it('round-trips a freshly signed token', () => {
    const token = signShiftActionToken({ orgId: 'org1', uid: 'user1', shiftId: 'shift1', action: 'claim' }, SECRET);
    const payload = verifyShiftActionToken(token, SECRET);
    expect(payload).toMatchObject({ orgId: 'org1', uid: 'user1', shiftId: 'shift1', action: 'claim' });
    expect(payload.jti).toBeTruthy();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signShiftActionToken({ orgId: 'org1', uid: 'user1', shiftId: 'shift1', action: 'claim' }, SECRET);
    expect(() => verifyShiftActionToken(token, 'wrong-secret')).toThrow(/signature/i);
  });

  it('rejects a tampered payload', () => {
    const token = signShiftActionToken({ orgId: 'org1', uid: 'user1', shiftId: 'shift1', action: 'claim' }, SECRET);
    const [encodedPayload, signature] = token.split('.');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    payload.shiftId = 'shift-attacker-controlled';
    const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect(() => verifyShiftActionToken(`${tamperedPayload}.${signature}`, SECRET)).toThrow(/signature/i);
  });

  it('rejects an expired token', () => {
    const token = signShiftActionToken({ orgId: 'org1', uid: 'user1', shiftId: 'shift1', action: 'claim' }, SECRET, -1000);
    expect(() => verifyShiftActionToken(token, SECRET)).toThrow(/expired/i);
  });

  it('rejects a malformed token', () => {
    expect(() => verifyShiftActionToken('not-a-real-token', SECRET)).toThrow(/malformed/i);
  });
});
