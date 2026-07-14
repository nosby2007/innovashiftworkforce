import { toMillis, dayBoundsMs } from './dates';

describe('toMillis', () => {
  it('reads a Firestore Timestamp-like object via toMillis()', () => {
    expect(toMillis({ toMillis: () => 12345 })).toBe(12345);
  });
  it('reads a raw {seconds} object', () => {
    expect(toMillis({ seconds: 10 })).toBe(10000);
  });
  it('parses a plain number', () => {
    expect(toMillis(99999)).toBe(99999);
  });
  it('returns 0 for null/undefined/invalid input', () => {
    expect(toMillis(null)).toBe(0);
    expect(toMillis(undefined)).toBe(0);
    expect(toMillis('not-a-number')).toBe(0);
  });
});

describe('dayBoundsMs', () => {
  it('returns UTC midnight for the start of day', () => {
    expect(dayBoundsMs('2026-07-14', false)).toBe(Date.UTC(2026, 6, 14, 0, 0, 0, 0));
  });
  it('returns 23:59:59.999 UTC for the end of day', () => {
    expect(dayBoundsMs('2026-07-14', true)).toBe(Date.UTC(2026, 6, 14, 23, 59, 59, 999));
  });
  it('returns 0 for malformed or empty date strings', () => {
    expect(dayBoundsMs('', false)).toBe(0);
    expect(dayBoundsMs('not-a-date', false)).toBe(0);
  });
  it('produces a start strictly before the matching end', () => {
    const start = dayBoundsMs('2026-01-01', false);
    const end = dayBoundsMs('2026-01-01', true);
    expect(start).toBeLessThan(end);
  });
});
