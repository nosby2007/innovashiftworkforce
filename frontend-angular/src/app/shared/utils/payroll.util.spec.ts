import {
  currentPayrollPeriod,
  dateInputValue,
  payrollDeductions,
  payrollNet,
  payrollLeaveHours,
  payrollLeaveGross,
  LeaveLike,
} from './payroll.util';

describe('currentPayrollPeriod', () => {
  it('weekly: returns a Monday-start, Sunday-end 7-day window', () => {
    const anchor = new Date(2026, 6, 15); // Wed, Jul 15 2026
    const { start, end } = currentPayrollPeriod('weekly', anchor);
    expect(start.getDay()).toBe(1); // Monday
    expect(dateInputValue(start)).toBe('2026-07-13');
    expect(dateInputValue(end)).toBe('2026-07-19');
  });

  it('biweekly: returns a Monday-start, 14-calendar-day window', () => {
    const anchor = new Date(2026, 6, 15);
    const { start, end } = currentPayrollPeriod('biweekly', anchor);
    expect(start.getDay()).toBe(1);
    expect(dateInputValue(start)).toBe('2026-07-13');
    expect(dateInputValue(end)).toBe('2026-07-26'); // 14 calendar days inclusive
  });

  it('semimonthly: 1st-15th when anchor is in the first half', () => {
    const anchor = new Date(2026, 6, 10); // Jul 10
    const { start, end } = currentPayrollPeriod('semimonthly', anchor);
    expect(dateInputValue(start)).toBe('2026-07-01');
    expect(dateInputValue(end)).toBe('2026-07-15');
  });

  it('semimonthly: 16th-end-of-month when anchor is in the second half', () => {
    const anchor = new Date(2026, 6, 20); // Jul 20
    const { start, end } = currentPayrollPeriod('semimonthly', anchor);
    expect(dateInputValue(start)).toBe('2026-07-16');
    expect(dateInputValue(end)).toBe('2026-07-31');
  });

  it('monthly: full calendar month containing the anchor', () => {
    const anchor = new Date(2026, 1, 10); // Feb 10 2026 (28 days, not a leap year)
    const { start, end } = currentPayrollPeriod('monthly', anchor);
    expect(dateInputValue(start)).toBe('2026-02-01');
    expect(dateInputValue(end)).toBe('2026-02-28');
  });

  it('defaults to biweekly when no frequency is given', () => {
    const anchor = new Date(2026, 6, 15);
    const withDefault = currentPayrollPeriod(undefined, anchor);
    const explicit = currentPayrollPeriod('biweekly', anchor);
    expect(dateInputValue(withDefault.start)).toBe(dateInputValue(explicit.start));
  });
});

describe('payrollDeductions / payrollNet', () => {
  it('deducts a flat 12%', () => {
    expect(payrollDeductions(1000)).toBe(120);
  });
  it('net = gross - deductions', () => {
    expect(payrollNet(1000)).toBe(880);
  });
});

describe('payrollLeaveHours (proration — the core PTO/payroll bug this guards against)', () => {
  it('counts full hours when the leave request is entirely inside the period', () => {
    const request: LeaveLike = { startDate: '2026-07-05', endDate: '2026-07-05', hours: 8 };
    expect(payrollLeaveHours(request, '2026-07-01', '2026-07-15')).toBe(8);
  });

  it('returns 0 when the leave request does not overlap the period at all', () => {
    const request: LeaveLike = { startDate: '2026-08-01', endDate: '2026-08-01', hours: 8 };
    expect(payrollLeaveHours(request, '2026-07-01', '2026-07-15')).toBe(0);
  });

  it('prorates proportionally when a multi-day request spans two periods, and the halves sum to the original total', () => {
    // 4-day PTO request (July 14-17), 32 hours total, split by a period boundary on July 15.
    const request: LeaveLike = { startDate: '2026-07-14', endDate: '2026-07-17', hours: 32 };
    const firstPeriodHours = payrollLeaveHours(request, '2026-07-01', '2026-07-15'); // 2 of 4 days
    const secondPeriodHours = payrollLeaveHours(request, '2026-07-16', '2026-07-31'); // 2 of 4 days
    expect(firstPeriodHours).toBe(16);
    expect(secondPeriodHours).toBe(16);
    expect(firstPeriodHours + secondPeriodHours).toBe(32); // must never double- or under-count
  });

  it('does not double-count hours across two overlapping/adjacent period queries', () => {
    const request: LeaveLike = { startDate: '2026-07-10', endDate: '2026-07-20', hours: 88 }; // 11 days
    const week1 = payrollLeaveHours(request, '2026-07-01', '2026-07-14'); // 5 overlapping days
    const week2 = payrollLeaveHours(request, '2026-07-15', '2026-07-31'); // 6 overlapping days
    expect(week1 + week2).toBeCloseTo(88, 1);
  });

  it('handles a single-day request with no endDate', () => {
    const request: LeaveLike = { startDate: '2026-07-10', hours: 8 };
    expect(payrollLeaveHours(request, '2026-07-01', '2026-07-15')).toBe(8);
  });

  it('returns 0 for a malformed/empty request', () => {
    expect(payrollLeaveHours({ startDate: '', hours: 8 }, '2026-07-01', '2026-07-15')).toBe(0);
  });
});

describe('payrollLeaveGross', () => {
  it('multiplies prorated hours by the pay rate', () => {
    const request: LeaveLike = { startDate: '2026-07-05', endDate: '2026-07-05', hours: 8, payRate: 25 };
    expect(payrollLeaveGross(request, '2026-07-01', '2026-07-15')).toBe(200);
  });

  it('is 0 when there is no overlap, regardless of rate', () => {
    const request: LeaveLike = { startDate: '2026-08-01', hours: 8, payRate: 100 };
    expect(payrollLeaveGross(request, '2026-07-01', '2026-07-15')).toBe(0);
  });
});
