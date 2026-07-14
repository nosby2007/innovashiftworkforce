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
