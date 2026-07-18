import {
  currentPayrollPeriod,
  dateInputValue,
  payrollDeductions,
  payrollNet,
  payrollLeaveHours,
  payrollLeaveGross,
  LeaveLike,
  computeEmployeeGross,
  workedDateSet,
  payrollHolidayOffHours,
  payrollHolidayOffGross,
  DEFAULT_OVERTIME_POLICY,
  OvertimePolicy,
  OrgHoliday,
  computeDeductions,
  DEFAULT_DEDUCTION_ELECTIONS,
  DeductionElections,
  resolveDeductionElections,
} from './payroll.util';
import { TimeEntry } from '../models/time-entry.model';
import { Shift } from '../models/shift.model';

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

// ─── Overtime + paid holidays ───────────────────────────────────────────────

function mkEntry(id: string, dateYMD: string, startHour: number, hours: number, extra: Partial<TimeEntry> = {}): TimeEntry {
  const [y, m, d] = dateYMD.split('-').map(Number);
  const checkInAt = new Date(y, m - 1, d, startHour, 0, 0).getTime();
  const checkOutAt = checkInAt + hours * 3_600_000;
  return {
    id,
    orgId: 'org1',
    userId: 'u1',
    shiftId: 'shift1',
    method: 'manual',
    checkInAt,
    checkOutAt,
    exceptionStatus: 'none',
    createdAt: checkInAt,
    ...extra,
  } as TimeEntry;
}

const RATE_SHIFT_MAP: Record<string, Shift | undefined> = {
  shift1: { payRate: 20 } as Shift,
};

// 2026-07-13 is a Monday (see currentPayrollPeriod tests above).
describe('computeEmployeeGross — overtime (the core OT bug this guards against)', () => {
  it('pays everything at the regular rate when under the weekly threshold', () => {
    const entries = [mkEntry('e1', '2026-07-13', 8, 8), mkEntry('e2', '2026-07-14', 8, 8)];
    const b = computeEmployeeGross(entries, RATE_SHIFT_MAP, 0, DEFAULT_OVERTIME_POLICY, new Set(), 1.5);
    expect(b.regularHours).toBe(16);
    expect(b.overtimeHours).toBe(0);
    expect(b.gross).toBe(320); // 16h * $20
  });

  it('splits hours beyond the weekly threshold into overtime at the configured multiplier', () => {
    // 5 days * 9h = 45h in one week; 40 regular + 5 OT.
    const entries = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17']
      .map((d, i) => mkEntry(`e${i}`, d, 8, 9));
    const policy: OvertimePolicy = { enabled: true, multiplier: 1.5, weeklyThresholdHours: 40 };
    const b = computeEmployeeGross(entries, RATE_SHIFT_MAP, 0, policy, new Set(), 1.5);
    expect(b.regularHours).toBe(40);
    expect(b.overtimeHours).toBe(5);
    expect(b.hours).toBe(45);
    expect(b.gross).toBe(40 * 20 + 5 * 20 * 1.5); // 800 + 150 = 950
  });

  it('allocates overtime chronologically — the last shift of the week absorbs it', () => {
    const entries = [
      mkEntry('e1', '2026-07-13', 8, 20),
      mkEntry('e2', '2026-07-14', 8, 25), // pushes week total to 45h
    ];
    const b = computeEmployeeGross(entries, RATE_SHIFT_MAP, 0, DEFAULT_OVERTIME_POLICY, new Set(), 1.5);
    const otLine = b.lines.find((l) => l.type === 'overtime');
    expect(otLine?.entryId).toBe('e2');
    expect(otLine?.hours).toBe(5);
    expect(b.lines.find((l) => l.entryId === 'e1' && l.type === 'regular')?.hours).toBe(20);
  });

  it('never pays overtime when the policy is disabled, regardless of weekly hours', () => {
    const entries = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17']
      .map((d, i) => mkEntry(`e${i}`, d, 8, 9));
    const policy: OvertimePolicy = { enabled: false, multiplier: 1.5, weeklyThresholdHours: 40 };
    const b = computeEmployeeGross(entries, RATE_SHIFT_MAP, 0, policy, new Set(), 1.5);
    expect(b.overtimeHours).toBe(0);
    expect(b.regularHours).toBe(45);
    expect(b.gross).toBe(45 * 20);
  });

  it('resets the overtime threshold independently for each Monday-start week', () => {
    // Week 1: 45h (5 OT). Week 2 (starting 7/20): 45h (5 OT). Must not bleed across weeks.
    const week1 = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17'].map((d, i) => mkEntry(`w1-${i}`, d, 8, 9));
    const week2 = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24'].map((d, i) => mkEntry(`w2-${i}`, d, 8, 9));
    const b = computeEmployeeGross([...week1, ...week2], RATE_SHIFT_MAP, 0, DEFAULT_OVERTIME_POLICY, new Set(), 1.5);
    expect(b.regularHours).toBe(80);
    expect(b.overtimeHours).toBe(10);
  });

  it('pays holiday-worked hours at the holiday multiplier with no overtime stacking', () => {
    // 9h shift on a holiday that also happens to push the week over 40h.
    const entries = [
      ...['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'].map((d, i) => mkEntry(`e${i}`, d, 8, 9)), // 36h
      mkEntry('holiday-shift', '2026-07-17', 8, 9), // holiday — would otherwise be 5h into OT territory
    ];
    const holidays = new Set(['2026-07-17']);
    const b = computeEmployeeGross(entries, RATE_SHIFT_MAP, 0, DEFAULT_OVERTIME_POLICY, holidays, 2);
    expect(b.holidayWorkedHours).toBe(9);
    expect(b.overtimeHours).toBe(0); // the holiday hours never entered the weekly OT pool
    expect(b.regularHours).toBe(36);
    expect(b.gross).toBe(36 * 20 + 9 * 20 * 2); // 720 + 360 = 1080
  });

  it('falls back to the org default rate when the shift has no pay rate', () => {
    const entries = [mkEntry('e1', '2026-07-13', 8, 8, { shiftId: 'unknown' })];
    const b = computeEmployeeGross(entries, {}, 15, DEFAULT_OVERTIME_POLICY, new Set(), 1.5);
    expect(b.gross).toBe(8 * 15);
  });
});

describe('workedDateSet', () => {
  it('collects the distinct check-in dates from a list of entries', () => {
    const entries = [mkEntry('e1', '2026-07-13', 8, 8), mkEntry('e2', '2026-07-13', 20, 2), mkEntry('e3', '2026-07-14', 8, 8)];
    expect(workedDateSet(entries)).toEqual(new Set(['2026-07-13', '2026-07-14']));
  });
});

describe('payrollHolidayOffHours / payrollHolidayOffGross', () => {
  const holiday: OrgHoliday = { id: 'h1', name: 'Independence Day', date: '2026-07-04', paidHours: 8 };

  it('awards the flat paid hours when the employee did not work the holiday', () => {
    expect(payrollHolidayOffHours(holiday, new Set(['2026-07-05']))).toBe(8);
    expect(payrollHolidayOffGross(holiday, 20, new Set(['2026-07-05']))).toBe(160);
  });

  it('awards nothing when the employee worked the holiday instead (paid via the premium path)', () => {
    expect(payrollHolidayOffHours(holiday, new Set(['2026-07-04']))).toBe(0);
    expect(payrollHolidayOffGross(holiday, 20, new Set(['2026-07-04']))).toBe(0);
  });
});

describe('computeDeductions', () => {
  it('applies each percentage to gross and nets them out', () => {
    const elections: DeductionElections = {
      federalTaxPercent: 10, stateTaxPercent: 4, socialSecurityPercent: 6.2, medicarePercent: 1.45,
      retirement401kPercent: 5, retirement401kMatchPercent: 3, benefits: [],
    };
    const b = computeDeductions(1000, elections);
    expect(b.federalTax).toBe(100);
    expect(b.stateTax).toBe(40);
    expect(b.socialSecurity).toBe(62);
    expect(b.medicare).toBe(14.5);
    expect(b.retirement401k).toBe(50);
    expect(b.totalDeductions).toBe(100 + 40 + 62 + 14.5 + 50);
    expect(b.netPay).toBe(1000 - b.totalDeductions);
  });

  it('sums flat-dollar benefit lines into the employee total, separate from percentage deductions', () => {
    const elections: DeductionElections = {
      ...DEFAULT_DEDUCTION_ELECTIONS,
      federalTaxPercent: 0, stateTaxPercent: 0, socialSecurityPercent: 0, medicarePercent: 0, retirement401kPercent: 0,
      benefits: [
        { id: 'b1', label: 'Vision', employeeAmount: 5, employerAmount: 2 },
        { id: 'b2', label: 'Health', employeeAmount: 50, employerAmount: 200 },
      ],
    };
    const b = computeDeductions(1000, elections);
    expect(b.benefitsTotal).toBe(55);
    expect(b.totalDeductions).toBe(55);
    expect(b.netPay).toBe(945);
    expect(b.benefitLines).toEqual([
      { id: 'b1', label: 'Vision', amount: 5 },
      { id: 'b2', label: 'Health', amount: 50 },
    ]);
  });

  it('computes employer contributions (401k match + employer benefit share) independent of employee deductions', () => {
    const elections: DeductionElections = {
      ...DEFAULT_DEDUCTION_ELECTIONS,
      federalTaxPercent: 0, stateTaxPercent: 0, socialSecurityPercent: 0, medicarePercent: 0,
      retirement401kPercent: 5, retirement401kMatchPercent: 3,
      benefits: [{ id: 'b1', label: 'Health', employeeAmount: 50, employerAmount: 200 }],
    };
    const b = computeDeductions(1000, elections);
    expect(b.employer401kMatch).toBe(30);
    expect(b.employerBenefitsTotal).toBe(200);
    expect(b.employerContributionsTotal).toBe(230);
    // Employer contributions never reduce the employee's own net pay.
    expect(b.netPay).toBe(1000 - b.retirement401k - b.benefitsTotal);
  });

  it('never produces negative deductions from a negative or missing gross', () => {
    const b = computeDeductions(0, DEFAULT_DEDUCTION_ELECTIONS);
    expect(b.totalDeductions).toBe(0);
    expect(b.netPay).toBe(0);
  });
});

describe('resolveDeductionElections', () => {
  const orgDefaults: DeductionElections = { federalTaxPercent: 10, stateTaxPercent: 4, socialSecurityPercent: 6.2, medicarePercent: 1.45, retirement401kPercent: 0, retirement401kMatchPercent: 2, benefits: [] };

  it('falls back to org defaults when the employee has no overrides', () => {
    const resolved = resolveDeductionElections(orgDefaults, null);
    expect(resolved.federalTaxPercent).toBe(10);
    expect(resolved.stateTaxPercent).toBe(4);
    expect(resolved.retirement401kMatchPercent).toBe(2);
    expect(resolved.retirement401kPercent).toBe(0);
    expect(resolved.benefits).toEqual([]);
  });

  it('uses the employee override even when it is explicitly 0, not the org default', () => {
    const resolved = resolveDeductionElections(orgDefaults, { stateTaxPercent: 0 });
    expect(resolved.stateTaxPercent).toBe(0);
    expect(resolved.federalTaxPercent).toBe(10); // still falls back — not overridden
  });

  it('uses the employee\'s own 401(k) contribution % and benefits, which have no org default', () => {
    const resolved = resolveDeductionElections(orgDefaults, {
      retirement401kPercent: 6,
      benefits: [{ id: 'b1', label: 'Vision', employeeAmount: 5, employerAmount: 2 }],
    });
    expect(resolved.retirement401kPercent).toBe(6);
    expect(resolved.benefits).toHaveLength(1);
  });
});
