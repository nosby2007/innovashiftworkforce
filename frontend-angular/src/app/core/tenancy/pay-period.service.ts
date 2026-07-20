import { Injectable, computed, effect, signal } from '@angular/core';
import { OrgContextService } from './org-context.service';
import { PayFrequency } from './org-finance.model';
import { PayrollRunsRepo, PayrollRunSummary } from '../repos/payroll-runs.repo';
import { PayrollPeriod, currentPayrollPeriod, payrollPeriodAfter, formatPayPeriodLabel } from '../../shared/utils/payroll.util';

export interface PayPeriodOption {
  period: PayrollPeriod;
  runId: string | null; // null only for the synthetic "current" (unfinalized) entry
  isCurrent: boolean;   // true only for index 0
  label: string;
}

function periodFromRun(run: PayrollRunSummary): PayrollPeriod {
  return {
    start: new Date(`${run.periodStart}T00:00:00`),
    end: new Date(`${run.periodEnd}T23:59:59.999`),
  };
}

/**
 * One org-wide "current pay period" concept, anchored to the org's last
 * finalized payroll run (the period following it, via payrollPeriodAfter) —
 * not pure calendar math. A single root-provided singleton rather than
 * per-page state: this is one org-level fact, and sharing selectedIndex
 * across pages means stepping back to a past period on one page (e.g.
 * Admin Timesheets) keeps that same period selected when navigating to a
 * related page (e.g. Admin Payroll), instead of silently snapping back to
 * "current".
 */
@Injectable({ providedIn: 'root' })
export class PayPeriodService {
  private runs = signal<PayrollRunSummary[]>([]);
  private boundOrgId: string | null = null;
  private unsub: (() => void) | null = null;

  selectedIndex = signal(0);

  periods = computed<PayPeriodOption[]>(() => {
    const freq = (this.ctx.payFrequency() as PayFrequency) || 'biweekly';
    const finalized = this.runs();
    const currentPeriod = finalized.length
      ? payrollPeriodAfter(freq, new Date(`${finalized[0].periodEnd}T00:00:00`))
      : currentPayrollPeriod(freq);
    const current: PayPeriodOption = { period: currentPeriod, runId: null, isCurrent: true, label: formatPayPeriodLabel(currentPeriod) };
    const past: PayPeriodOption[] = finalized.map((run) => {
      const period = periodFromRun(run);
      return { period, runId: run.id, isCurrent: false, label: formatPayPeriodLabel(period) };
    });
    return [current, ...past];
  });

  selectedPeriod = computed<PayrollPeriod>(() => {
    const list = this.periods();
    const idx = Math.min(Math.max(0, this.selectedIndex()), list.length - 1);
    return list[idx]?.period ?? currentPayrollPeriod();
  });

  constructor(private ctx: OrgContextService, private runsRepo: PayrollRunsRepo) {
    effect(() => {
      const orgId = this.ctx.orgId();
      if (orgId === this.boundOrgId) return;
      this.boundOrgId = orgId;
      this.unsub?.();
      this.unsub = null;
      this.runs.set([]);
      this.selectedIndex.set(0);
      if (!orgId) return;
      this.unsub = this.runsRepo.watchFinalizedRuns(orgId, (items) => this.runs.set(items));
    });
  }

  selectIndex(i: number) {
    const n = this.periods().length;
    if (i >= 0 && i < n) this.selectedIndex.set(i);
  }

  selectCurrent() {
    this.selectedIndex.set(0);
  }
}
