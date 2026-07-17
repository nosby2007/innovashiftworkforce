import { describe, it, expect } from 'vitest';
import { scoreShiftMatch } from './shift-match.util';
import { Shift } from '../models/shift.model';

function ts(ms: number) {
  return { toMillis: () => ms };
}

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 's1',
    orgId: 'org1',
    title: 'Standard Shift',
    locationName: 'Main Clinic',
    startAt: ts(Date.UTC(2026, 0, 10, 8, 0)),
    endAt: ts(Date.UTC(2026, 0, 10, 16, 0)),
    status: 'open',
    ...overrides,
  } as Shift;
}

describe('scoreShiftMatch', () => {
  it('flags a great fit when the role matches and there is no conflict', () => {
    const shift = makeShift({ requiredJobRole: 'RN' });
    const m = scoreShiftMatch(shift, [], 'RN');
    expect(m.label).toBe('great_fit');
    expect(m.hasConflict).toBe(false);
    expect(m.score).toBeGreaterThan(0);
  });

  it('treats a shift with no required role as always matching', () => {
    const shift = makeShift({ requiredJobRole: undefined });
    const m = scoreShiftMatch(shift, [], 'RN');
    expect(m.label).toBe('great_fit');
  });

  it('flags a role mismatch', () => {
    const shift = makeShift({ requiredJobRole: 'RN' });
    const m = scoreShiftMatch(shift, [], 'CNA');
    expect(m.label).toBe('role_mismatch');
    expect(m.score).toBeLessThan(0);
  });

  it('flags a hard conflict when the shift overlaps an existing assigned shift', () => {
    const shift = makeShift({ id: 'new', requiredJobRole: 'RN', startAt: ts(Date.UTC(2026, 0, 10, 8, 0)), endAt: ts(Date.UTC(2026, 0, 10, 16, 0)) });
    const existing = makeShift({ id: 'existing', requiredJobRole: 'RN', status: 'assigned', startAt: ts(Date.UTC(2026, 0, 10, 12, 0)), endAt: ts(Date.UTC(2026, 0, 10, 20, 0)) });
    const m = scoreShiftMatch(shift, [existing], 'RN');
    expect(m.label).toBe('conflict');
    expect(m.hasConflict).toBe(true);
    expect(m.score).toBeLessThan(-500);
  });

  it('flags a tight turnaround when rest between shifts is under 8 hours but does not conflict', () => {
    const shift = makeShift({ id: 'new', requiredJobRole: 'RN', startAt: ts(Date.UTC(2026, 0, 11, 2, 0)), endAt: ts(Date.UTC(2026, 0, 11, 10, 0)) });
    // Existing shift ends 6 hours before the new one starts.
    const existing = makeShift({ id: 'existing', requiredJobRole: 'RN', status: 'assigned', startAt: ts(Date.UTC(2026, 0, 10, 12, 0)), endAt: ts(Date.UTC(2026, 0, 10, 20, 0)) });
    const m = scoreShiftMatch(shift, [existing], 'RN');
    expect(m.label).toBe('tight_turnaround');
    expect(m.hasConflict).toBe(false);
  });

  it('ignores cancelled/expired/no_show shifts when checking for conflicts', () => {
    const shift = makeShift({ id: 'new', requiredJobRole: 'RN', startAt: ts(Date.UTC(2026, 0, 10, 8, 0)), endAt: ts(Date.UTC(2026, 0, 10, 16, 0)) });
    const cancelled = makeShift({ id: 'cancelled', requiredJobRole: 'RN', status: 'cancelled', startAt: ts(Date.UTC(2026, 0, 10, 8, 0)), endAt: ts(Date.UTC(2026, 0, 10, 16, 0)) });
    const m = scoreShiftMatch(shift, [cancelled], 'RN');
    expect(m.hasConflict).toBe(false);
    expect(m.label).toBe('great_fit');
  });

  it('does not compare a shift against itself', () => {
    const shift = makeShift({ id: 'same', requiredJobRole: 'RN' });
    const m = scoreShiftMatch(shift, [shift], 'RN');
    expect(m.hasConflict).toBe(false);
  });
});
