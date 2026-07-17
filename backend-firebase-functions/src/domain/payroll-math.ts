/**
 * Mirrors the formulas in frontend-angular/src/app/shared/utils/payroll.util.ts
 * (payrollHours/payrollGross/payrollDeductions) so numbers the AI Copilot
 * reports match what admins see on the Payroll page. Duplicated rather than
 * shared because this is a separate npm package (Cloud Functions) with no
 * shared-code setup with the frontend today.
 *
 * These are the same flat-rate, no-tax-tables estimates already labeled
 * "Estimated" in the Payroll UI — not a real payroll/tax calculation.
 */

const DEDUCTION_RATE = 0.12;

export function entryHours(checkInMs: number, checkOutMs: number | null, totalBreakMs = 0): number {
  if (!checkOutMs) return 0;
  const ms = Math.max(0, checkOutMs - checkInMs - (totalBreakMs || 0));
  return Math.round((ms / 3_600_000) * 100) / 100;
}

export function grossPay(hours: number, rate: number): number {
  return Math.round(hours * rate * 100) / 100;
}

export function estimatedDeductions(gross: number): number {
  return Math.round(gross * DEDUCTION_RATE * 100) / 100;
}

export function estimatedNet(gross: number): number {
  return Math.round((gross - estimatedDeductions(gross)) * 100) / 100;
}
