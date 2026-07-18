import { TimeEntry } from '../models/time-entry.model';
import { Shift } from '../models/shift.model';
import { tsToDate } from './date.util';
import { PayFrequency } from '../../core/tenancy/org-finance.model';

export type PayrollPeriod = { start: Date; end: Date };

function mondayStart(anchor: Date): Date {
  const start = new Date(anchor);
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Canonical pay-period boundaries for the org's configured pay frequency. */
export function currentPayrollPeriod(payFrequency: PayFrequency = 'biweekly', anchor = new Date()): PayrollPeriod {
  switch (payFrequency) {
    case 'weekly': {
      const start = mondayStart(anchor);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case 'semimonthly': {
      const day = anchor.getDate();
      const start = new Date(anchor);
      const end = new Date(anchor);
      if (day <= 15) {
        start.setDate(1);
        end.setDate(15);
      } else {
        start.setDate(16);
        end.setMonth(end.getMonth() + 1, 0); // last day of month
      }
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case 'monthly': {
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 0, 0, 0, 0);
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);
      return { start, end };
    }
    case 'biweekly':
    default: {
      const start = mondayStart(anchor);
      const end = new Date(start);
      end.setDate(start.getDate() + 13);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  }
}

export function dateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function payrollHours(entry: TimeEntry): number {
  const start = tsToDate(entry.checkInAt);
  const end = tsToDate(entry.checkOutAt);
  if (!start || !end) return 0;
  const breakMs = Number(entry.totalBreakMs || 0);
  const ms = Math.max(0, end.getTime() - start.getTime() - breakMs);
  return Math.round((ms / 3600000) * 100) / 100;
}

export function payrollRate(entry: TimeEntry, shift?: Shift | null, defaultRate = 0): number {
  const shiftRate = Number(shift?.payRate || 0);
  if (shiftRate > 0) return shiftRate;
  return Number(defaultRate || 0);
}

export function payrollGross(entry: TimeEntry, shift?: Shift | null, defaultRate = 0): number {
  return Math.round(payrollHours(entry) * payrollRate(entry, shift, defaultRate) * 100) / 100;
}

export function payrollDeductions(gross: number): number {
  return Math.round(gross * 0.12 * 100) / 100;
}

export function payrollNet(gross: number): number {
  return Math.round((gross - payrollDeductions(gross)) * 100) / 100;
}

function parseDateOnly(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function daysInclusive(startStr: string, endStr: string): number {
  const start = parseDateOnly(startStr);
  const end = parseDateOnly(endStr);
  if (!start || !end || end < start) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

export interface LeaveLike {
  startDate: string;
  endDate?: string | null;
  hours: number;
  payRate?: number | null;
}

/**
 * Prorates a leave request's lump-sum hours by the fraction of its date span
 * that falls inside [periodStart, periodEnd] (both 'YYYY-MM-DD'), so a request
 * spanning two pay periods is split proportionally instead of fully counted
 * — and thus double-counted — in each period it overlaps.
 */
export function payrollLeaveHours(request: LeaveLike, periodStart: string, periodEnd: string): number {
  const startDate = request.startDate || '';
  const endDate = request.endDate || startDate;
  const totalDays = daysInclusive(startDate, endDate);
  if (totalDays <= 0) return 0;

  const overlapStart = startDate > periodStart ? startDate : periodStart;
  const overlapEnd = endDate < periodEnd ? endDate : periodEnd;
  const overlapDays = daysInclusive(overlapStart, overlapEnd);
  if (overlapDays <= 0) return 0;

  const hours = Number(request.hours || 0);
  return Math.round((hours * overlapDays / totalDays) * 100) / 100;
}

export function payrollLeaveGross(request: LeaveLike, periodStart: string, periodEnd: string): number {
  const hours = payrollLeaveHours(request, periodStart, periodEnd);
  const rate = Number(request.payRate || 0);
  return Math.round(hours * rate * 100) / 100;
}

// ─── Overtime + paid holidays ───────────────────────────────────────────────

export interface OvertimePolicy {
  enabled: boolean;
  multiplier: number;
  weeklyThresholdHours: number;
}

export const DEFAULT_OVERTIME_POLICY: OvertimePolicy = {
  enabled: true,
  multiplier: 1.5,
  weeklyThresholdHours: 40,
};

export interface OrgHoliday {
  id: string;
  name: string;
  date: string; // 'YYYY-MM-DD'
  paidHours: number;
}

export type PayrollLineType = 'regular' | 'overtime' | 'holiday_worked';

export interface PayrollLine {
  entryId: string;
  date: string;
  shiftTitle: string;
  checkInAt: any;
  checkOutAt: any;
  type: PayrollLineType;
  hours: number;
  rate: number;
  gross: number;
  status: string;
}

export interface EmployeeGrossBreakdown {
  regularHours: number;
  overtimeHours: number;
  holidayWorkedHours: number;
  hours: number;
  gross: number;
  lines: PayrollLine[];
}

function mondayWeekKey(d: Date): string {
  const day = d.getDay();
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1));
  return dateInputValue(monday);
}

/**
 * Computes one employee's regular/overtime/holiday-worked hours and gross pay
 * for a set of time entries (normally already scoped to a single pay period).
 * Overtime is allocated chronologically within each Monday-start week: hours
 * up to the weekly threshold are regular, the remainder is overtime. Entries
 * whose check-in date matches a configured holiday are paid entirely at the
 * holiday-worked multiplier instead (no overtime stacking on top of it).
 */
export function computeEmployeeGross(
  entries: TimeEntry[],
  shiftMap: Record<string, Shift | undefined>,
  defaultRate: number,
  overtime: OvertimePolicy,
  holidayDates: Set<string>,
  holidayWorkMultiplier: number,
): EmployeeGrossBreakdown {
  const lines: PayrollLine[] = [];
  const holidayEntries: TimeEntry[] = [];
  const normalEntries: TimeEntry[] = [];

  for (const entry of entries) {
    const start = tsToDate(entry.checkInAt);
    if (!start) continue;
    const dateStr = dateInputValue(start);
    if (holidayDates.has(dateStr)) holidayEntries.push(entry);
    else normalEntries.push(entry);
  }

  let regularHours = 0;
  let overtimeHours = 0;
  let holidayWorkedHours = 0;
  let gross = 0;

  for (const entry of holidayEntries) {
    const shift = shiftMap[entry.shiftId];
    const hours = payrollHours(entry);
    const baseRate = payrollRate(entry, shift, defaultRate);
    const rate = Math.round(baseRate * holidayWorkMultiplier * 100) / 100;
    const entryGross = Math.round(hours * rate * 100) / 100;
    holidayWorkedHours += hours;
    gross += entryGross;
    lines.push({
      entryId: entry.id,
      date: dateInputValue(tsToDate(entry.checkInAt)!),
      shiftTitle: shift?.title || 'Assigned shift',
      checkInAt: entry.checkInAt,
      checkOutAt: entry.checkOutAt,
      type: 'holiday_worked',
      hours,
      rate,
      gross: entryGross,
      status: entry.exceptionStatus || 'none',
    });
  }

  const byWeek = new Map<string, TimeEntry[]>();
  for (const entry of normalEntries) {
    const wk = mondayWeekKey(tsToDate(entry.checkInAt)!);
    const list = byWeek.get(wk);
    if (list) list.push(entry);
    else byWeek.set(wk, [entry]);
  }

  for (const weekEntries of byWeek.values()) {
    const sorted = [...weekEntries].sort(
      (a, b) => (tsToDate(a.checkInAt)?.getTime() ?? 0) - (tsToDate(b.checkInAt)?.getTime() ?? 0)
    );
    let cumulative = 0;
    for (const entry of sorted) {
      const shift = shiftMap[entry.shiftId];
      const hours = payrollHours(entry);
      const rate = payrollRate(entry, shift, defaultRate);
      const date = dateInputValue(tsToDate(entry.checkInAt)!);
      const shiftTitle = shift?.title || 'Assigned shift';
      const status = entry.exceptionStatus || 'none';

      const threshold = overtime.enabled ? Math.max(0, overtime.weeklyThresholdHours) : Infinity;
      const remainingRegular = Math.max(0, threshold - cumulative);
      const regPortion = Math.round(Math.min(hours, remainingRegular) * 100) / 100;
      const otPortion = Math.round((hours - regPortion) * 100) / 100;

      if (regPortion > 0) {
        const regGross = Math.round(regPortion * rate * 100) / 100;
        regularHours += regPortion;
        gross += regGross;
        lines.push({ entryId: entry.id, date, shiftTitle, checkInAt: entry.checkInAt, checkOutAt: entry.checkOutAt, type: 'regular', hours: regPortion, rate, gross: regGross, status });
      }
      if (otPortion > 0) {
        const otRate = Math.round(rate * overtime.multiplier * 100) / 100;
        const otGross = Math.round(otPortion * otRate * 100) / 100;
        overtimeHours += otPortion;
        gross += otGross;
        lines.push({ entryId: entry.id, date, shiftTitle, checkInAt: entry.checkInAt, checkOutAt: entry.checkOutAt, type: 'overtime', hours: otPortion, rate: otRate, gross: otGross, status });
      }
      if (regPortion === 0 && otPortion === 0) {
        // Open punch or zero-duration entry — keep it visible with no hours.
        lines.push({ entryId: entry.id, date, shiftTitle, checkInAt: entry.checkInAt, checkOutAt: entry.checkOutAt, type: 'regular', hours: 0, rate, gross: 0, status });
      }
      cumulative += hours;
    }
  }

  return {
    regularHours: Math.round(regularHours * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
    holidayWorkedHours: Math.round(holidayWorkedHours * 100) / 100,
    hours: Math.round((regularHours + overtimeHours + holidayWorkedHours) * 100) / 100,
    gross: Math.round(gross * 100) / 100,
    lines,
  };
}

/** The set of 'YYYY-MM-DD' dates an employee has at least one time entry on. */
export function workedDateSet(entries: TimeEntry[]): Set<string> {
  const set = new Set<string>();
  for (const entry of entries) {
    const d = tsToDate(entry.checkInAt);
    if (d) set.add(dateInputValue(d));
  }
  return set;
}

/**
 * Paid-holiday-off hours: an employee who did NOT clock in on a configured
 * holiday gets the holiday's flat paid hours at their regular rate. An
 * employee who worked that day is paid via the holiday-worked premium
 * instead (see computeEmployeeGross), not both.
 */
export function payrollHolidayOffHours(holiday: OrgHoliday, workedDates: Set<string>): number {
  if (workedDates.has(holiday.date)) return 0;
  return Math.max(0, Number(holiday.paidHours || 0));
}

export function payrollHolidayOffGross(holiday: OrgHoliday, rate: number, workedDates: Set<string>): number {
  return Math.round(payrollHolidayOffHours(holiday, workedDates) * Number(rate || 0) * 100) / 100;
}

// ─── Taxes, retirement, and benefit deductions ──────────────────────────────

export interface BenefitLine {
  id: string;
  label: string;
  employeeAmount: number; // flat $ deducted per paycheck
  employerAmount: number; // flat $ employer contributes per paycheck (informational)
}

/**
 * An employee's per-paycheck deduction elections. Federal/state tax are
 * flat estimated percentages (not real bracket/W-4-based withholding —
 * that varies by jurisdiction and requires tax tables this app doesn't
 * maintain). Social Security and Medicare default to the actual fixed
 * US federal rates since those aren't bracket-based.
 */
export interface DeductionElections {
  federalTaxPercent: number;
  stateTaxPercent: number;
  socialSecurityPercent: number;
  medicarePercent: number;
  retirement401kPercent: number;
  retirement401kMatchPercent: number;
  benefits: BenefitLine[];
}

/**
 * Country-neutral starting point: no assumed tax/FICA rates at all. Real
 * defaults (Federal/State %, and the fixed US Social Security/Medicare
 * rates) only make sense for a US organization — see
 * `defaultDeductionElectionsForCountry`. Everywhere else, the company sets
 * its own numbers for whatever local statutory deductions apply.
 */
export const DEFAULT_DEDUCTION_ELECTIONS: DeductionElections = {
  federalTaxPercent: 0,
  stateTaxPercent: 0,
  socialSecurityPercent: 0,
  medicarePercent: 0,
  retirement401kPercent: 0,
  retirement401kMatchPercent: 0,
  benefits: [],
};

/**
 * A brand-new organization's starting deduction defaults, before an admin
 * has customized anything. Only US orgs get real prefilled numbers (a
 * reasonable federal/state withholding estimate plus the actual fixed FICA
 * rates) — those figures don't apply anywhere else, so every other country
 * starts at zero and the company sets its own statutory deduction rates.
 */
export function defaultDeductionElectionsForCountry(countryCode: string | null | undefined): DeductionElections {
  const isUS = String(countryCode || '').trim().toUpperCase() === 'US';
  if (!isUS) return { ...DEFAULT_DEDUCTION_ELECTIONS };
  return {
    federalTaxPercent: 10,
    stateTaxPercent: 4,
    socialSecurityPercent: 6.2,
    medicarePercent: 1.45,
    retirement401kPercent: 0,
    retirement401kMatchPercent: 0,
    benefits: [],
  };
}

export interface DeductionBreakdown {
  federalTax: number;
  stateTax: number;
  socialSecurity: number;
  medicare: number;
  retirement401k: number;
  benefitsTotal: number;
  benefitLines: Array<{ id: string; label: string; amount: number }>;
  totalDeductions: number;
  netPay: number;
  employer401kMatch: number;
  employerBenefitsTotal: number;
  employerBenefitLines: Array<{ id: string; label: string; amount: number }>;
  employerContributionsTotal: number;
}

export interface DeductionOverrides {
  federalTaxPercent?: number | null;
  stateTaxPercent?: number | null;
  socialSecurityPercent?: number | null;
  medicarePercent?: number | null;
  retirement401kPercent?: number | null;
  retirement401kMatchPercent?: number | null;
  benefits?: BenefitLine[] | null;
}

/**
 * Resolves an employee's actual deduction elections: an override field of
 * `null`/`undefined` falls back to the org default (0 is a valid override,
 * e.g. "no state tax withholding", so this must use ?? not ||). Benefits and
 * the employee's own 401(k) contribution % have no org-level default —
 * they're either configured on the employee or they're not.
 */
export function resolveDeductionElections(orgDefaults: DeductionElections, overrides: DeductionOverrides | null | undefined): DeductionElections {
  return {
    federalTaxPercent: overrides?.federalTaxPercent ?? orgDefaults.federalTaxPercent,
    stateTaxPercent: overrides?.stateTaxPercent ?? orgDefaults.stateTaxPercent,
    socialSecurityPercent: overrides?.socialSecurityPercent ?? orgDefaults.socialSecurityPercent,
    medicarePercent: overrides?.medicarePercent ?? orgDefaults.medicarePercent,
    retirement401kPercent: overrides?.retirement401kPercent ?? 0,
    retirement401kMatchPercent: overrides?.retirement401kMatchPercent ?? orgDefaults.retirement401kMatchPercent,
    benefits: overrides?.benefits ?? [],
  };
}

export function computeDeductions(gross: number, elections: DeductionElections): DeductionBreakdown {
  const g = Math.max(0, Number(gross || 0));
  const pct = (p: number) => Math.round(g * Math.max(0, Number(p || 0)) / 100 * 100) / 100;

  const federalTax = pct(elections.federalTaxPercent);
  const stateTax = pct(elections.stateTaxPercent);
  const socialSecurity = pct(elections.socialSecurityPercent);
  const medicare = pct(elections.medicarePercent);
  const retirement401k = pct(elections.retirement401kPercent);

  const benefitLines = (elections.benefits || []).map((b) => ({
    id: b.id,
    label: b.label,
    amount: Math.round(Math.max(0, Number(b.employeeAmount || 0)) * 100) / 100,
  }));
  const benefitsTotal = Math.round(benefitLines.reduce((sum, b) => sum + b.amount, 0) * 100) / 100;

  const totalDeductions = Math.round((federalTax + stateTax + socialSecurity + medicare + retirement401k + benefitsTotal) * 100) / 100;
  const netPay = Math.round((g - totalDeductions) * 100) / 100;

  const employer401kMatch = pct(elections.retirement401kMatchPercent);
  const employerBenefitLines = (elections.benefits || [])
    .map((b) => ({ id: b.id, label: b.label, amount: Math.round(Math.max(0, Number(b.employerAmount || 0)) * 100) / 100 }))
    .filter((b) => b.amount > 0);
  const employerBenefitsTotal = Math.round(employerBenefitLines.reduce((sum, b) => sum + b.amount, 0) * 100) / 100;
  const employerContributionsTotal = Math.round((employer401kMatch + employerBenefitsTotal) * 100) / 100;

  return {
    federalTax, stateTax, socialSecurity, medicare, retirement401k,
    benefitsTotal, benefitLines, totalDeductions, netPay,
    employer401kMatch, employerBenefitsTotal, employerBenefitLines, employerContributionsTotal,
  };
}
