import { describe, it, expect } from 'vitest';
import { aggregateStaffingSnapshot } from './dailyDigest';

describe('aggregateStaffingSnapshot', () => {
  it('returns zeros for an empty list', () => {
    expect(aggregateStaffingSnapshot([])).toEqual({ headcountScheduled: 0, scheduledHours: 0 });
  });

  it('skips shifts with no assignedUserId', () => {
    const result = aggregateStaffingSnapshot([
      { assignedUserId: null, startAtMs: 0, endAtMs: 3_600_000 },
    ]);
    expect(result).toEqual({ headcountScheduled: 0, scheduledHours: 0 });
  });

  it('dedupes headcount by uid across multiple shifts for the same person', () => {
    const result = aggregateStaffingSnapshot([
      { assignedUserId: 'u1', startAtMs: 0, endAtMs: 4 * 3_600_000 },
      { assignedUserId: 'u1', startAtMs: 5 * 3_600_000, endAtMs: 9 * 3_600_000 },
    ]);
    expect(result.headcountScheduled).toBe(1);
    expect(result.scheduledHours).toBe(8);
  });

  it('sums hours correctly across multiple staff', () => {
    const result = aggregateStaffingSnapshot([
      { assignedUserId: 'u1', startAtMs: 0, endAtMs: 4 * 3_600_000 },
      { assignedUserId: 'u2', startAtMs: 0, endAtMs: 8 * 3_600_000 },
    ]);
    expect(result.headcountScheduled).toBe(2);
    expect(result.scheduledHours).toBe(12);
  });
});
