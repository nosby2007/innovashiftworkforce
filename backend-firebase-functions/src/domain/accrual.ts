/** Pure accrual/pay-period logic, extracted for unit testing without a Firestore emulator. */

export interface AccrualTier {
  minTenureMonths: number;
  ptoHoursPerYear: number;
  sickHoursPerYear: number;
}

export function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function todayKeyUTC(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Mirrors the pay-period-start convention used by payroll.util.ts's currentPayrollPeriod
 *  on the client: Monday for weekly/biweekly, 1st/16th for semimonthly, 1st for monthly. */
export function isPayPeriodStartDay(payFrequency: string, now: Date): boolean {
  switch (payFrequency) {
    case 'semimonthly':
      return now.getUTCDate() === 1 || now.getUTCDate() === 16;
    case 'monthly':
      return now.getUTCDate() === 1;
    case 'weekly':
    case 'biweekly':
    default:
      return now.getUTCDay() === 1; // Monday
  }
}

export function grantsPerYear(cadence: string, payFrequency: string): number {
  if (cadence === 'monthly') return 12;
  if (cadence === 'annually') return 1;
  switch (payFrequency) {
    case 'weekly': return 52;
    case 'semimonthly': return 24;
    case 'monthly': return 12;
    case 'biweekly':
    default: return 26;
  }
}

export function isGrantDay(cadence: string, payFrequency: string, now: Date): boolean {
  if (cadence === 'monthly') return now.getUTCDate() === 1;
  if (cadence === 'annually') return now.getUTCMonth() === 0 && now.getUTCDate() === 1;
  return isPayPeriodStartDay(payFrequency, now);
}

export function tenureMonths(hireDate: string | null, createdAt: any, now: Date): number {
  let start: Date | null = null;
  if (hireDate) {
    const [y, m, d] = hireDate.split('-').map(Number);
    if (y && m && d) start = new Date(Date.UTC(y, m - 1, d));
  }
  if (!start && createdAt) {
    const ms = createdAt?.toMillis ? createdAt.toMillis() : Number(createdAt);
    if (ms) start = new Date(ms);
  }
  if (!start) return 0;
  let months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

export function pickTier(tiers: AccrualTier[], months: number): AccrualTier | null {
  const sorted = [...(tiers || [])].sort((a, b) => a.minTenureMonths - b.minTenureMonths);
  let selected: AccrualTier | null = null;
  for (const t of sorted) {
    if (t.minTenureMonths <= months) selected = t;
  }
  return selected || sorted[0] || null;
}

export function normalizeAccrualBalance(data: any) {
  const balances = data?.balances || {};
  return {
    ptoBalance: num(data?.ptoBalance ?? balances?.pto ?? balances?.PTO),
    sickBalance: num(data?.sickBalance ?? balances?.sick ?? balances?.SICK),
    lastAccrualGrantDay: String(data?.lastAccrualGrantDay || ''),
  };
}
