import { describe, it, expect } from 'vitest';
import { isSandboxDailyCapFirstAlert, evaluateContactAbuseCounter } from './abuse-detection';

describe('isSandboxDailyCapFirstAlert', () => {
  it('is true when the lock doc has never been alerted on', () => {
    expect(isSandboxDailyCapFirstAlert(null)).toBe(true);
    expect(isSandboxDailyCapFirstAlert(undefined)).toBe(true);
    expect(isSandboxDailyCapFirstAlert({})).toBe(true);
    expect(isSandboxDailyCapFirstAlert({ alertedForDailyCap: false })).toBe(true);
  });

  it('is false once already alerted', () => {
    expect(isSandboxDailyCapFirstAlert({ alertedForDailyCap: true })).toBe(false);
  });
});

describe('evaluateContactAbuseCounter', () => {
  const HOUR_MS = 60 * 60 * 1000;
  const NOW = Date.UTC(2026, 3, 15, 14, 0, 0);

  it('starts a fresh window at count 1 with no alert', () => {
    const result = evaluateContactAbuseCounter(null, NOW);
    expect(result).toEqual({ count: 1, windowStartAtMs: NOW, alertedAt: null, shouldAlert: false });
  });

  it('increments within the same window without alerting below threshold', () => {
    const existing = { count: 5, windowStartAtMs: NOW, alertedAt: null };
    const result = evaluateContactAbuseCounter(existing, NOW + 1000);
    expect(result.count).toBe(6);
    expect(result.windowStartAtMs).toBe(NOW);
    expect(result.shouldAlert).toBe(false);
    expect(result.alertedAt).toBeNull();
  });

  it('alerts exactly once when crossing the threshold', () => {
    const existing = { count: 9, windowStartAtMs: NOW, alertedAt: null };
    const atThreshold = evaluateContactAbuseCounter(existing, NOW + 1000);
    expect(atThreshold.count).toBe(10);
    expect(atThreshold.shouldAlert).toBe(true);
    expect(atThreshold.alertedAt).toBe(NOW + 1000);

    // A subsequent block in the same window keeps counting but does not re-alert.
    const again = evaluateContactAbuseCounter(atThreshold, NOW + 2000);
    expect(again.count).toBe(11);
    expect(again.shouldAlert).toBe(false);
    expect(again.alertedAt).toBe(NOW + 1000);
  });

  it('resets the window and re-arms alerting once the window expires', () => {
    const existing = { count: 15, windowStartAtMs: NOW, alertedAt: NOW + 500 };
    const result = evaluateContactAbuseCounter(existing, NOW + HOUR_MS + 1);
    expect(result.count).toBe(1);
    expect(result.windowStartAtMs).toBe(NOW + HOUR_MS + 1);
    expect(result.alertedAt).toBeNull();
    expect(result.shouldAlert).toBe(false);
  });
});
