import {
  isPayPeriodStartDay,
  grantsPerYear,
  isGrantDay,
  tenureMonths,
  pickTier,
  normalizeAccrualBalance,
  todayKeyUTC,
  num,
  AccrualTier,
} from './accrual';

describe('num', () => {
  it('rounds to 2 decimal places', () => {
    expect(num(1.005)).toBeCloseTo(1.0, 2);
    expect(num(1.234)).toBe(1.23);
  });
  it('treats non-numeric input as 0', () => {
    expect(num(undefined)).toBe(0);
    expect(num('not a number')).toBe(0);
    expect(num(null)).toBe(0);
  });
});

describe('todayKeyUTC', () => {
  it('formats as YYYY-MM-DD in UTC', () => {
    expect(todayKeyUTC(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
    expect(todayKeyUTC(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-12-31');
  });
});

describe('isPayPeriodStartDay', () => {
  it('weekly/biweekly: true only on Monday', () => {
    const monday = new Date(Date.UTC(2026, 0, 5)); // 2026-01-05 is a Monday
    const tuesday = new Date(Date.UTC(2026, 0, 6));
    expect(isPayPeriodStartDay('weekly', monday)).toBe(true);
    expect(isPayPeriodStartDay('biweekly', monday)).toBe(true);
    expect(isPayPeriodStartDay('weekly', tuesday)).toBe(false);
  });

  it('semimonthly: true on the 1st and 16th only', () => {
    expect(isPayPeriodStartDay('semimonthly', new Date(Date.UTC(2026, 2, 1)))).toBe(true);
    expect(isPayPeriodStartDay('semimonthly', new Date(Date.UTC(2026, 2, 16)))).toBe(true);
    expect(isPayPeriodStartDay('semimonthly', new Date(Date.UTC(2026, 2, 15)))).toBe(false);
  });

  it('monthly: true only on the 1st', () => {
    expect(isPayPeriodStartDay('monthly', new Date(Date.UTC(2026, 2, 1)))).toBe(true);
    expect(isPayPeriodStartDay('monthly', new Date(Date.UTC(2026, 2, 2)))).toBe(false);
  });
});

describe('grantsPerYear', () => {
  it('monthly cadence is always 12, regardless of pay frequency', () => {
    expect(grantsPerYear('monthly', 'weekly')).toBe(12);
    expect(grantsPerYear('monthly', 'biweekly')).toBe(12);
  });
  it('annually cadence is always 1', () => {
    expect(grantsPerYear('annually', 'weekly')).toBe(1);
  });
  it('per_pay_period cadence follows the org pay frequency', () => {
    expect(grantsPerYear('per_pay_period', 'weekly')).toBe(52);
    expect(grantsPerYear('per_pay_period', 'biweekly')).toBe(26);
    expect(grantsPerYear('per_pay_period', 'semimonthly')).toBe(24);
    expect(grantsPerYear('per_pay_period', 'monthly')).toBe(12);
  });
});

describe('isGrantDay', () => {
  it('monthly cadence grants on the 1st of any month', () => {
    expect(isGrantDay('monthly', 'biweekly', new Date(Date.UTC(2026, 5, 1)))).toBe(true);
    expect(isGrantDay('monthly', 'biweekly', new Date(Date.UTC(2026, 5, 2)))).toBe(false);
  });
  it('annually cadence grants only on January 1st', () => {
    expect(isGrantDay('annually', 'biweekly', new Date(Date.UTC(2026, 0, 1)))).toBe(true);
    expect(isGrantDay('annually', 'biweekly', new Date(Date.UTC(2026, 5, 1)))).toBe(false);
  });
  it('per_pay_period cadence delegates to isPayPeriodStartDay', () => {
    const monday = new Date(Date.UTC(2026, 0, 5));
    expect(isGrantDay('per_pay_period', 'weekly', monday)).toBe(true);
  });
});

describe('tenureMonths', () => {
  it('computes whole months from a hireDate string', () => {
    const now = new Date(Date.UTC(2026, 6, 14)); // 2026-07-14
    expect(tenureMonths('2026-01-14', null, now)).toBe(6);
    expect(tenureMonths('2025-07-14', null, now)).toBe(12);
  });

  it('rounds down when the anniversary day has not occurred yet this month', () => {
    const now = new Date(Date.UTC(2026, 6, 10)); // 2026-07-10, before the 14th
    expect(tenureMonths('2026-01-14', null, now)).toBe(5);
  });

  it('falls back to createdAt Timestamp-like object when hireDate is missing', () => {
    const now = new Date(Date.UTC(2026, 6, 14));
    const createdAt = { toMillis: () => Date.UTC(2025, 6, 14) };
    expect(tenureMonths(null, createdAt, now)).toBe(12);
  });

  it('returns 0 when neither hireDate nor createdAt is available', () => {
    expect(tenureMonths(null, null, new Date())).toBe(0);
  });

  it('never returns a negative number for a future hire date', () => {
    const now = new Date(Date.UTC(2026, 0, 1));
    expect(tenureMonths('2026-06-01', null, now)).toBe(0);
  });
});

describe('pickTier', () => {
  const tiers: AccrualTier[] = [
    { minTenureMonths: 0, ptoHoursPerYear: 80, sickHoursPerYear: 40 },
    { minTenureMonths: 12, ptoHoursPerYear: 120, sickHoursPerYear: 40 },
    { minTenureMonths: 60, ptoHoursPerYear: 160, sickHoursPerYear: 40 },
  ];

  it('picks the highest tier whose minTenureMonths threshold is met', () => {
    expect(pickTier(tiers, 0).ptoHoursPerYear).toBe(80);
    expect(pickTier(tiers, 11).ptoHoursPerYear).toBe(80);
    expect(pickTier(tiers, 12).ptoHoursPerYear).toBe(120);
    expect(pickTier(tiers, 59).ptoHoursPerYear).toBe(120);
    expect(pickTier(tiers, 60).ptoHoursPerYear).toBe(160);
    expect(pickTier(tiers, 1000).ptoHoursPerYear).toBe(160);
  });

  it('is order-independent (sorts internally)', () => {
    const shuffled = [tiers[2], tiers[0], tiers[1]];
    expect(pickTier(shuffled, 12).ptoHoursPerYear).toBe(120);
  });

  it('returns null for an empty tier list', () => {
    expect(pickTier([], 12)).toBeNull();
  });

  it('falls back to the lowest tier if none explicitly match (defensive)', () => {
    const noZeroTier: AccrualTier[] = [{ minTenureMonths: 12, ptoHoursPerYear: 120, sickHoursPerYear: 40 }];
    expect(pickTier(noZeroTier, 0)?.ptoHoursPerYear).toBe(120);
  });
});

describe('normalizeAccrualBalance', () => {
  it('reads flat modern fields', () => {
    const result = normalizeAccrualBalance({ ptoBalance: 40, sickBalance: 20, lastAccrualGrantDay: '2026-07-01' });
    expect(result).toEqual({ ptoBalance: 40, sickBalance: 20, lastAccrualGrantDay: '2026-07-01' });
  });

  it('falls back to legacy nested balances.pto/balances.sick shape', () => {
    const result = normalizeAccrualBalance({ balances: { pto: 15, sick: 5 } });
    expect(result.ptoBalance).toBe(15);
    expect(result.sickBalance).toBe(5);
  });

  it('defaults to zeroed balance for empty/missing data', () => {
    expect(normalizeAccrualBalance({})).toEqual({ ptoBalance: 0, sickBalance: 0, lastAccrualGrantDay: '' });
    expect(normalizeAccrualBalance(undefined)).toEqual({ ptoBalance: 0, sickBalance: 0, lastAccrualGrantDay: '' });
  });
});
