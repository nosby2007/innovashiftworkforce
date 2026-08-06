import { describe, it, expect } from 'vitest';
import { DEFAULT_FATIGUE_RULES, resolveFatigueRules } from './dailyDigest';

describe('resolveFatigueRules', () => {
  it('returns all 3 defaults when orgData is null or undefined', () => {
    expect(resolveFatigueRules(null)).toEqual(DEFAULT_FATIGUE_RULES);
    expect(resolveFatigueRules(undefined)).toEqual(DEFAULT_FATIGUE_RULES);
  });

  it('returns all 3 defaults when orgData is an empty object', () => {
    expect(resolveFatigueRules({})).toEqual(DEFAULT_FATIGUE_RULES);
  });

  it('uses org-configured positive values when present', () => {
    const result = resolveFatigueRules({
      minRestHours: 10,
      maxConsecutiveDays: 4,
      maxWeeklyScheduledHours: 45,
    });
    expect(result).toEqual({ minRestHours: 10, maxConsecutiveDays: 4, maxWeeklyHours: 45 });
  });

  it('falls back to the default per-field when a value is zero, negative, or non-numeric', () => {
    expect(resolveFatigueRules({ minRestHours: 0 }).minRestHours).toBe(DEFAULT_FATIGUE_RULES.minRestHours);
    expect(resolveFatigueRules({ maxConsecutiveDays: -2 }).maxConsecutiveDays).toBe(DEFAULT_FATIGUE_RULES.maxConsecutiveDays);
    expect(resolveFatigueRules({ maxWeeklyScheduledHours: 'not-a-number' }).maxWeeklyHours).toBe(DEFAULT_FATIGUE_RULES.maxWeeklyHours);
  });

  it('resolves each field independently — a bad value in one field does not affect the others', () => {
    const result = resolveFatigueRules({ minRestHours: 10, maxConsecutiveDays: -1, maxWeeklyScheduledHours: 45 });
    expect(result).toEqual({ minRestHours: 10, maxConsecutiveDays: DEFAULT_FATIGUE_RULES.maxConsecutiveDays, maxWeeklyHours: 45 });
  });
});
