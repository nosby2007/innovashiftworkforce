import { describe, it, expect } from 'vitest';
import {
  checkShiftEligibility,
  computeFatigueWindowMs,
  isoWeekStartMs,
  resolveFatigueRules,
  DEFAULT_FATIGUE_RULES,
  ShiftSlice,
  FatigueRules,
} from './shift-eligibility';

const HOUR = 3_600_000;
const DAY = 86_400_000;

function slice(id: string, startAtMs: number, endAtMs: number, status = 'assigned'): ShiftSlice {
  return { id, startAtMs, endAtMs, status };
}

const RULES: FatigueRules = { minRestHours: 8, maxConsecutiveDays: 6, maxWeeklyHours: 60 };

// Monday 2026-01-05 00:00 UTC — a clean ISO-week-aligned anchor for tests.
const MON = Date.UTC(2026, 0, 5, 0, 0, 0);

describe('checkShiftEligibility', () => {
  it('returns null with no other shifts', () => {
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON + 8 * HOUR, endAtMs: MON + 16 * HOUR },
      otherShifts: [],
      rules: RULES,
      personLabel: 'You',
    });
    expect(result).toBeNull();
  });

  it('returns null when a candidate shift has ample rest, no overlap, under caps', () => {
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON + DAY + 8 * HOUR, endAtMs: MON + DAY + 16 * HOUR },
      otherShifts: [slice('a', MON, MON + 8 * HOUR)],
      rules: RULES,
      personLabel: 'You',
    });
    expect(result).toBeNull();
  });

  it('flags overlap when a shift overlaps an existing assigned shift', () => {
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON, endAtMs: MON + 8 * HOUR },
      otherShifts: [slice('a', MON + 4 * HOUR, MON + 12 * HOUR)],
      rules: RULES,
      personLabel: 'This staff member',
    });
    expect(result?.code).toBe('overlap');
  });

  it('does not flag overlap against a terminal-status shift', () => {
    for (const status of ['cancelled', 'completed', 'expired', 'no_show']) {
      const result = checkShiftEligibility({
        targetShift: { id: 'new', startAtMs: MON, endAtMs: MON + 8 * HOUR },
        otherShifts: [slice('a', MON + 4 * HOUR, MON + 12 * HOUR, status)],
        rules: RULES,
        personLabel: 'You',
      });
      expect(result?.code).not.toBe('overlap');
    }
  });

  it('does not treat two shifts with zero/invalid timestamps as overlapping', () => {
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON, endAtMs: MON + 8 * HOUR },
      otherShifts: [slice('a', 0, 0)],
      rules: RULES,
      personLabel: 'You',
    });
    expect(result).toBeNull();
  });

  it('flags day_hour_cap when same-UTC-day total exceeds 16h even without overlap', () => {
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON + 12 * HOUR, endAtMs: MON + 20 * HOUR },
      otherShifts: [slice('a', MON, MON + 10 * HOUR)],
      rules: RULES,
      personLabel: 'You',
    });
    expect(result?.code).toBe('day_hour_cap');
  });

  it('a completed shift on the same day does not count toward the 16h cap', () => {
    // Loosen minRestHours to 0 here so this case isolates the day-hour-cap
    // pass — a completed shift still counts toward the rest check (Pass 2),
    // covered separately below.
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON + 12 * HOUR, endAtMs: MON + 20 * HOUR },
      otherShifts: [slice('a', MON, MON + 10 * HOUR, 'completed')],
      rules: { ...RULES, minRestHours: 0 },
      personLabel: 'You',
    });
    expect(result).toBeNull();
  });

  it('flags insufficient_rest when the gap to the nearest worked shift is under rules.minRestHours but no overlap', () => {
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON + 20 * HOUR, endAtMs: MON + DAY + 4 * HOUR },
      otherShifts: [slice('a', MON + 8 * HOUR, MON + 16 * HOUR)], // ends 4h before target starts
      rules: RULES,
      personLabel: 'You',
    });
    expect(result?.code).toBe('insufficient_rest');
  });

  it('flags insufficient_rest against a COMPLETED shift ending too close to the new shift', () => {
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON + 20 * HOUR, endAtMs: MON + DAY + 4 * HOUR },
      otherShifts: [slice('a', MON + 8 * HOUR, MON + 16 * HOUR, 'completed')],
      rules: RULES,
      personLabel: 'You',
    });
    expect(result?.code).toBe('insufficient_rest');
  });

  it('uses the org configured minRestHours instead of the 8h default', () => {
    const looseRules: FatigueRules = { ...RULES, minRestHours: 2 };
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON + 20 * HOUR, endAtMs: MON + DAY + 4 * HOUR },
      otherShifts: [slice('a', MON + 8 * HOUR, MON + 16 * HOUR)], // 4h gap — fine under 2h min
      rules: looseRules,
      personLabel: 'You',
    });
    expect(result).toBeNull();

    const strictRules: FatigueRules = { ...RULES, minRestHours: 10 };
    const flagged = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON + 20 * HOUR, endAtMs: MON + DAY + 4 * HOUR },
      otherShifts: [slice('a', MON + 8 * HOUR, MON + 16 * HOUR)], // 4h gap — flagged under 10h min
      rules: strictRules,
      personLabel: 'You',
    });
    expect(flagged?.code).toBe('insufficient_rest');
  });

  it('flags max_consecutive_days when adding the target shift creates a streak over the limit', () => {
    // 6 prior consecutive days (Mon-Sat), target on Sunday = 7th consecutive day, limit 6.
    const otherShifts: ShiftSlice[] = [];
    for (let i = 0; i < 6; i++) {
      otherShifts.push(slice(`d${i}`, MON + i * DAY + 8 * HOUR, MON + i * DAY + 12 * HOUR));
    }
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON + 6 * DAY + 20 * HOUR, endAtMs: MON + 6 * DAY + 22 * HOUR },
      otherShifts,
      rules: RULES,
      personLabel: 'You',
    });
    expect(result?.code).toBe('max_consecutive_days');
  });

  it('does not flag max_consecutive_days when a rest day breaks the streak', () => {
    const otherShifts: ShiftSlice[] = [0, 1, 2, 3, 5].map((i) => slice(`d${i}`, MON + i * DAY + 8 * HOUR, MON + i * DAY + 12 * HOUR));
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON + 6 * DAY + 8 * HOUR, endAtMs: MON + 6 * DAY + 12 * HOUR },
      otherShifts,
      rules: RULES,
      personLabel: 'You',
    });
    // day 4 (index) has no shift, so streak is only day5+day6 = 2 consecutive.
    expect(result).toBeNull();
  });

  it('detects a streak spanning both before and after the target day', () => {
    // target day is Wed (index 2); shifts on Mon,Tue,Thu,Fri,Sat,Sun (6 others) around it -> 7 total.
    const otherShifts: ShiftSlice[] = [0, 1, 3, 4, 5, 6].map((i) => slice(`d${i}`, MON + i * DAY + 8 * HOUR, MON + i * DAY + 12 * HOUR));
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON + 2 * DAY + 8 * HOUR, endAtMs: MON + 2 * DAY + 12 * HOUR },
      otherShifts,
      rules: RULES,
      personLabel: 'You',
    });
    expect(result?.code).toBe('max_consecutive_days');
  });

  it('flags max_weekly_hours when the ISO week total plus the target shift exceeds the limit', () => {
    const strictRules: FatigueRules = { ...RULES, maxWeeklyHours: 20 };
    const otherShifts: ShiftSlice[] = [
      slice('a', MON + 8 * HOUR, MON + 18 * HOUR), // 10h Monday
    ];
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON + DAY + 8 * HOUR, endAtMs: MON + DAY + 20 * HOUR }, // 12h Tuesday
      otherShifts,
      rules: strictRules,
      personLabel: 'You',
    });
    expect(result?.code).toBe('max_weekly_hours');
  });

  it('does not count a shift in the prior ISO week toward this week total', () => {
    const strictRules: FatigueRules = { ...RULES, maxWeeklyHours: 15, minRestHours: 1 };
    const otherShifts: ShiftSlice[] = [
      slice('a', MON - 2 * HOUR - 10 * HOUR, MON - 2 * HOUR), // ends 2h before Monday 00:00 (prior week, Sunday)
    ];
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON + 8 * HOUR, endAtMs: MON + 18 * HOUR }, // 10h Monday, under 15h limit alone
      otherShifts,
      rules: strictRules,
      personLabel: 'You',
    });
    expect(result).toBeNull();
  });

  it('ignores a shift ID in excludedShiftIds even if it would otherwise overlap or violate a cap', () => {
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON, endAtMs: MON + 8 * HOUR },
      otherShifts: [slice('traded', MON + 4 * HOUR, MON + 12 * HOUR)],
      excludedShiftIds: new Set(['traded']),
      rules: RULES,
      personLabel: 'You',
    });
    expect(result).toBeNull();
  });

  it('returns the overlap violation first when both overlap and weekly-hours would be violated', () => {
    const strictRules: FatigueRules = { ...RULES, maxWeeklyHours: 5 };
    const result = checkShiftEligibility({
      targetShift: { id: 'new', startAtMs: MON, endAtMs: MON + 8 * HOUR },
      otherShifts: [slice('a', MON + 4 * HOUR, MON + 12 * HOUR)],
      rules: strictRules,
      personLabel: 'You',
    });
    expect(result?.code).toBe('overlap');
  });

  it('does not compare the target shift against itself if it appears in otherShifts', () => {
    const target = { id: 'same', startAtMs: MON, endAtMs: MON + 8 * HOUR };
    const result = checkShiftEligibility({
      targetShift: target,
      otherShifts: [slice('same', target.startAtMs, target.endAtMs)],
      rules: RULES,
      personLabel: 'You',
    });
    expect(result).toBeNull();
  });
});

describe('isoWeekStartMs', () => {
  it('returns the same Monday-UTC-midnight for any timestamp within that week', () => {
    for (let i = 0; i < 7; i++) {
      expect(isoWeekStartMs(MON + i * DAY + 13 * HOUR)).toBe(MON);
    }
  });
});

describe('computeFatigueWindowMs', () => {
  it('clamps spanDays to at least 7 regardless of a smaller maxConsecutiveDays', () => {
    const { windowStartMs, windowEndMs } = computeFatigueWindowMs(MON, { ...RULES, maxConsecutiveDays: 2 });
    expect(MON - windowStartMs).toBeGreaterThanOrEqual(7 * DAY);
    expect(windowEndMs - MON).toBeGreaterThanOrEqual(7 * DAY);
  });

  it('clamps spanDays to at most 31 regardless of a larger maxConsecutiveDays', () => {
    const { windowStartMs, windowEndMs } = computeFatigueWindowMs(MON, { ...RULES, maxConsecutiveDays: 9999 });
    expect(MON - windowStartMs).toBeLessThanOrEqual(31 * DAY);
    expect(windowEndMs - MON).toBeLessThanOrEqual(32 * DAY);
  });
});

describe('resolveFatigueRules (re-export smoke test)', () => {
  it('is usable from this module and matches the documented defaults', () => {
    expect(resolveFatigueRules(null)).toEqual(DEFAULT_FATIGUE_RULES);
  });
});
