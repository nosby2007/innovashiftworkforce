import { Component, effect, EffectRef, OnDestroy, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Timestamp } from 'firebase/firestore';
import { MatIconModule } from '@angular/material/icon';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { PayPeriodService, PayPeriodOption } from '../../core/tenancy/pay-period.service';
import { PayPeriodSelectorComponent } from '../../shared/ui/pay-period-selector/pay-period-selector.component';
import { PrintLauncherService } from '../../core/ui/print-launcher.service';
import { TimeEntriesRepo } from '../../core/repos/time-entries.repo';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { TimeEntry } from '../../shared/models/time-entry.model';
import { Shift } from '../../shared/models/shift.model';
import { AccrualsRepo, TimeOffRequest } from '../../core/repos/accruals.repo';
import { formatDateTime } from '../../shared/utils/date.util';
import { dateInputValue, payrollDeductions, payrollGross, payrollHours, payrollLeaveGross, payrollLeaveHours, payrollNet, payrollRate } from '../../shared/utils/payroll.util';
import { TableListController } from '../../shared/ui/table-list/table-list.controller';
import { TablePaginatorComponent } from '../../shared/ui/table-list/table-paginator.component';
import { TranslocoModule } from '@jsverse/transloco';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CurrencyPipe, MatIconModule, TablePaginatorComponent, PayPeriodSelectorComponent, TranslocoModule],
  template: `
    <div class="pay-page">
      <header class="pay-hero">
        <div>
          <div class="pay-kicker">{{ 'nav.myPayroll' | transloco }}</div>
          <h1>{{ 'payroll.payStatementPreview' | transloco }}</h1>
          <p>{{ 'payroll.reviewHoursNote' | transloco }}</p>
        </div>
        <div class="pay-period">
          <label>{{ 'payroll.payPeriod' | transloco }}</label>
          <app-pay-period-selector (periodChange)="onPeriodPicked($event)"></app-pay-period-selector>
          <div>
            <input type="date" [(ngModel)]="fromDate" (change)="reload()">
            <span>{{ 'payroll.to' | transloco }}</span>
            <input type="date" [(ngModel)]="toDate" (change)="reload()">
          </div>
          <button class="pay-print-btn" (click)="printPayslip()">
            <mat-icon>picture_as_pdf</mat-icon>
            {{ 'payroll.printSavePdf' | transloco }}
          </button>
          <a class="pay-print-btn" routerLink="/app/payroll/history">
            <mat-icon>receipt_long</mat-icon>
            {{ 'payroll.viewAllPaystubs' | transloco }}
          </a>
        </div>
      </header>

      <div *ngIf="!orgId" class="pay-alert">
        <mat-icon>warning_amber</mat-icon>
        {{ 'payroll.missingOrgContext' | transloco }}
      </div>

      <section class="pay-kpis" *ngIf="orgId">
        <article>
          <span>{{ 'payroll.totalHours' | transloco }}</span>
          <strong>{{ totalHours().toFixed(2) }}</strong>
        </article>
        <article>
          <span>{{ 'payroll.estimatedGross' | transloco }}</span>
          <strong>{{ totalGross() | currency:moneyCurrency() }}</strong>
        </article>
        <article>
          <span>{{ 'payroll.estimatedNet' | transloco }}</span>
          <strong>{{ estimatedNet() | currency:moneyCurrency() }}</strong>
        </article>
        <article [class.pay-kpi-warn]="exceptionCount() > 0">
          <span>{{ 'payroll.exceptions' | transloco }}</span>
          <strong>{{ exceptionCount() }}</strong>
        </article>
      </section>

      <section class="pay-grid" *ngIf="orgId">
        <article class="pay-card pay-statement">
          <div class="pay-card-head">
            <h2>{{ 'payroll.payStatement' | transloco }}</h2>
            <span>{{ fromDate }} - {{ toDate }}</span>
          </div>
          <div class="pay-statement-row">
            <span>{{ 'payroll.regularEarnings' | transloco }}</span>
            <strong>{{ totalGross() | currency:moneyCurrency() }}</strong>
          </div>
          <div class="pay-statement-row">
            <span>{{ 'payroll.estimatedDeductions' | transloco }}</span>
            <strong>-{{ totalDeductions() | currency:moneyCurrency() }}</strong>
          </div>
          <div class="pay-statement-row pay-statement-net">
            <span>{{ 'payroll.estimatedNetPay' | transloco }}</span>
            <strong>{{ estimatedNet() | currency:moneyCurrency() }}</strong>
          </div>
          <p class="pay-note">{{ 'payroll.previewNote' | transloco }}</p>
        </article>

        <article class="pay-card pay-breakdown">
          <div class="pay-card-head">
            <h2>{{ 'payroll.payCodeBreakdown' | transloco }}</h2>
            <mat-icon>receipt_long</mat-icon>
          </div>
          <div class="pay-code-row">
            <span>REG</span>
            <strong>{{ totalHours().toFixed(2) }} h</strong>
            <em>{{ totalGross() | currency:moneyCurrency() }}</em>
          </div>
          <div class="pay-code-row">
            <span>OT</span>
            <strong>{{ overtimeHours().toFixed(2) }} h</strong>
            <em>{{ overtimeGross() | currency:moneyCurrency() }}</em>
          </div>
        </article>
      </section>

      <section class="pay-card pay-table-card" *ngIf="orgId">
        <div class="pay-card-head">
          <h2>{{ 'payroll.timecardPayrollRows' | transloco }}</h2>
          <span>{{ 'payroll.rowCount' | transloco: { count: rows.length } }}</span>
        </div>
        <div class="pay-table-shell">
          <table>
            <thead>
              <tr>
                <th class="pay-th-sort" (click)="rowsCtrl.toggleSort('date')">{{ 'payroll.colDate' | transloco }} {{ rowsCtrl.sortIndicator('date') }}</th>
                <th>{{ 'payroll.colShift' | transloco }}</th>
                <th>{{ 'payroll.colClockIn' | transloco }}</th>
                <th>{{ 'payroll.colClockOut' | transloco }}</th>
                <th class="pay-th-sort" (click)="rowsCtrl.toggleSort('hours')">{{ 'payroll.colHours' | transloco }} {{ rowsCtrl.sortIndicator('hours') }}</th>
                <th>{{ 'payroll.colRate' | transloco }}</th>
                <th class="pay-th-sort" (click)="rowsCtrl.toggleSort('gross')">{{ 'payroll.colGross' | transloco }} {{ rowsCtrl.sortIndicator('gross') }}</th>
                <th class="pay-th-sort" (click)="rowsCtrl.toggleSort('status')">{{ 'payroll.colStatus' | transloco }} {{ rowsCtrl.sortIndicator('status') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngIf="rowsCtrl.pageRows().length === 0">
                <td colspan="8">{{ 'payroll.noPayrollEntries' | transloco }}</td>
              </tr>
              <tr *ngFor="let r of rowsCtrl.pageRows()">
                <td>{{ r.date }}</td>
                <td>{{ r.shiftTitle }}</td>
                <td>{{ r.checkIn }}</td>
                <td>{{ r.checkOut }}</td>
                <td>{{ r.hours.toFixed(2) }}</td>
                <td>{{ r.rate | currency:moneyCurrency() }}</td>
                <td>{{ r.gross | currency:moneyCurrency() }}</td>
                <td><span [class.is-warn]="r.status !== 'none'">{{ r.status }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <app-table-paginator *ngIf="rows.length > 0" [controller]="rowsCtrl"></app-table-paginator>
      </section>
    </div>
  `,
  styles: [`
    .pay-page { max-width:1180px; margin:0 auto; color:#1f2937; }
    .pay-hero { min-height:150px; margin:-24px -22px 22px; padding:28px; display:flex; align-items:end; justify-content:space-between; gap:18px; background:#07533f; color:#fff; }
    .pay-kicker { color:rgba(255,255,255,.72); font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; margin-bottom:8px; }
    .pay-hero h1 { margin:0; font-size:32px; font-weight:800; }
    .pay-hero p { margin:8px 0 0; color:rgba(255,255,255,.82); max-width:650px; }
    .pay-period { display:grid; gap:6px; min-width:330px; }
    .pay-period label { color:rgba(255,255,255,.75); font-size:12px; font-weight:800; }
    .pay-period div { display:flex; align-items:center; gap:8px; }
    .pay-period input { height:38px; border:1px solid rgba(255,255,255,.34); border-radius:6px; background:#fff; color:#111827; padding:0 9px; }
    .pay-print-btn { height:38px; border:1px solid rgba(255,255,255,.8); border-radius:6px; background:#fff; color:#07533f; display:inline-flex; align-items:center; justify-content:center; gap:7px; font-weight:800; cursor:pointer; padding:0 14px; text-decoration:none; }
    .pay-alert { display:flex; gap:10px; padding:14px 16px; background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; color:#92400e; font-weight:800; }
    .pay-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:16px; }
    .pay-kpis article, .pay-card { border:1px solid rgba(15,23,42,.12); border-radius:8px; background:rgba(255,255,255,.94); box-shadow:0 12px 28px rgba(15,23,42,.07); }
    .pay-kpis article { padding:16px; }
    .pay-kpis span { color:#64748b; font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; }
    .pay-kpis strong { display:block; margin-top:8px; color:#0f172a; font-size:28px; }
    .pay-kpi-warn strong { color:#b45309; }
    .pay-grid { display:grid; grid-template-columns:1.1fr .9fr; gap:16px; margin-bottom:16px; }
    .pay-card-head { min-height:50px; padding:0 16px; display:flex; justify-content:space-between; align-items:center; gap:12px; border-bottom:1px solid #e5e7eb; }
    .pay-card-head h2 { margin:0; font-size:16px; font-weight:800; }
    .pay-card-head span { color:#64748b; font-size:12px; }
    .pay-statement-row, .pay-code-row { display:grid; grid-template-columns:1fr auto; gap:12px; padding:14px 16px; border-bottom:1px solid #e5e7eb; color:#475569; }
    .pay-statement-row strong, .pay-code-row strong, .pay-code-row em { color:#0f172a; font-style:normal; }
    .pay-statement-net { background:#ecfdf5; font-weight:800; }
    .pay-note { margin:0; padding:14px 16px; color:#64748b; font-size:12px; line-height:1.45; }
    .pay-code-row { grid-template-columns:70px 1fr auto; }
    .pay-table-shell { overflow:auto; }
    table { width:100%; min-width:920px; border-collapse:collapse; }
    th { background:#eef3ef; color:#334155; font-size:11px; text-transform:uppercase; letter-spacing:.06em; text-align:left; padding:10px; border-bottom:1px solid #d1d5db; }
    .pay-th-sort { cursor:pointer; user-select:none; }
    .pay-th-sort:hover { color:#07533f; }
    td { padding:11px 10px; border-bottom:1px solid #e5e7eb; color:#1f2937; white-space:nowrap; }
    tr:nth-child(even) td { background:#f8fafc; }
    td span { border-radius:999px; background:#ecfdf5; color:#047857; padding:4px 8px; font-size:11px; font-weight:800; }
    td span.is-warn { background:#fff7ed; color:#b45309; }
    @media (max-width:900px) { .pay-hero { align-items:flex-start; flex-direction:column; margin:-14px -12px 18px; padding:22px 16px; } .pay-period { min-width:0; width:100%; } .pay-kpis, .pay-grid { grid-template-columns:1fr; } }
  `]
})
export class StaffPayrollPage implements OnDestroy {
  orgId: string | null = null;
  uid: string | null = null;
  fromDate = '';
  toDate = '';
  entries = signal<TimeEntry[]>([]);
  leaveRequests = signal<TimeOffRequest[]>([]);
  shiftMap = signal<Record<string, Shift>>({});
  rows: Array<{ date: string; shiftTitle: string; checkIn: string; checkOut: string; hours: number; rate: number; gross: number; status: string }> = [];
  private rowsView = signal<typeof this.rows>([]);
  rowsCtrl = new TableListController<(typeof this.rows)[number]>(this.rowsView, {
    pageSize: 15,
    sortAccessor: (r, key) => {
      if (key === 'date') return r.date;
      if (key === 'hours') return r.hours;
      if (key === 'gross') return r.gross;
      if (key === 'status') return r.status;
      return null;
    },
  });
  private unsub: (() => void) | null = null;
  private unsubLeave: (() => void) | null = null;
  private ctxEffect: EffectRef;

  constructor(
    private ctx: OrgContextService,
    private payPeriod: PayPeriodService,
    private timeRepo: TimeEntriesRepo,
    private shiftsRepo: ShiftsRepo,
    private accruals: AccrualsRepo,
    private printLauncher: PrintLauncherService,
  ) {
    const period = this.payPeriod.selectedPeriod();
    this.fromDate = dateInputValue(period.start);
    this.toDate = dateInputValue(period.end);
    this.ctxEffect = effect(() => {
      this.orgId = this.ctx.orgId();
      this.uid = this.ctx.uid();
      this.reload();
    });
  }

  onPeriodPicked(opt: PayPeriodOption) {
    this.fromDate = dateInputValue(opt.period.start);
    this.toDate = dateInputValue(opt.period.end);
    this.reload();
  }

  reload() {
    this.unsub?.();
    this.unsubLeave?.();
    this.rows = [];
    this.rowsView.set([]);
    if (!this.orgId || !this.uid || !this.fromDate || !this.toDate) return;
    const start = Timestamp.fromDate(new Date(`${this.fromDate}T00:00:00`));
    const end = Timestamp.fromDate(new Date(`${this.toDate}T23:59:59`));
    this.unsub = this.timeRepo.watchEntriesRange(this.orgId, this.uid, start, end, async (items) => {
      this.entries.set(items);
      const shiftIds = Array.from(new Set(items.map((e) => e.shiftId))).filter(Boolean);
      this.shiftMap.set(shiftIds.length ? await this.shiftsRepo.getManyByIds(this.orgId!, shiftIds) : {});
      this.recomputeRows();
    });
    this.unsubLeave = this.accruals.watchRequests(this.orgId, this.uid, (items) => {
      this.leaveRequests.set(items);
      this.recomputeRows();
    });
  }

  private recomputeRows() {
    const workedRows = this.entries().map((entry) => this.toRow(entry));
    const leaveRows = this.leaveRequests()
      .filter((request) => this.isPayrollLeave(request))
      .map((request) => this.leaveToRow(request));
    this.rows = [...workedRows, ...leaveRows].sort((a, b) => a.date.localeCompare(b.date));
    this.rowsView.set(this.rows);
  }

  private toRow(entry: TimeEntry) {
    const shift = this.shiftMap()[entry.shiftId];
    const hours = payrollHours(entry);
    const rate = payrollRate(entry, shift);
    const gross = payrollGross(entry, shift);
    return {
      date: formatDateTime(entry.checkInAt).split(',')[0] || '-',
      shiftTitle: shift?.title || 'Assigned shift',
      checkIn: formatDateTime(entry.checkInAt),
      checkOut: entry.checkOutAt ? formatDateTime(entry.checkOutAt) : 'Open',
      hours,
      rate,
      gross,
      status: entry.exceptionStatus || 'none',
    };
  }

  private leaveToRow(request: TimeOffRequest) {
    const hours = payrollLeaveHours(request, this.fromDate, this.toDate);
    const rate = Number(request.payRate || 0);
    return {
      date: request.startDate || '-',
      shiftTitle: `${request.requestType.toUpperCase()} approved leave`,
      checkIn: request.startDate,
      checkOut: request.endDate,
      hours,
      rate,
      gross: request.paid === false ? 0 : payrollLeaveGross(request, this.fromDate, this.toDate),
      status: 'approved leave',
    };
  }

  private isPayrollLeave(request: TimeOffRequest): boolean {
    if (request.status !== 'approved') return false;
    if (request.requestType === 'unpaid') return false;
    if (request.paid === false) return false;
    return payrollLeaveHours(request, this.fromDate, this.toDate) > 0;
  }

  totalHours() { return this.rows.reduce((sum, r) => sum + r.hours, 0); }
  totalGross() { return Math.round(this.rows.reduce((sum, r) => sum + r.gross, 0) * 100) / 100; }
  totalDeductions() { return payrollDeductions(this.totalGross()); }
  estimatedNet() { return payrollNet(this.totalGross()); }
  overtimeHours() { return Math.max(0, this.totalHours() - 80); }
  overtimeGross() { return 0; }
  exceptionCount() { return this.rows.filter((r) => r.status !== 'none').length; }
  moneyCurrency() { return this.ctx.currencyCode() || 'USD'; }

  printPayslip() {
    this.printLauncher.open('/print/payslip', { from: this.fromDate, to: this.toDate }, 'staff-payslip');
  }

  ngOnDestroy() {
    this.unsub?.();
    this.unsubLeave?.();
    this.ctxEffect.destroy();
  }
}
