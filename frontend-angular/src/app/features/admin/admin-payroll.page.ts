import { Component, NgZone, OnDestroy, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { doc, getDoc, getFirestore, onSnapshot, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { MatIconModule } from '@angular/material/icon';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { PayPeriodService, PayPeriodOption } from '../../core/tenancy/pay-period.service';
import { PayPeriodSelectorComponent } from '../../shared/ui/pay-period-selector/pay-period-selector.component';
import { PrintLauncherService } from '../../core/ui/print-launcher.service';
import { ToastService } from '../../core/ui/toast.service';
import { TimeEntriesRepo } from '../../core/repos/time-entries.repo';
import { UsersRepo, OrgUser } from '../../core/repos/users.repo';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { TimeEntry } from '../../shared/models/time-entry.model';
import { Shift } from '../../shared/models/shift.model';
import { AccrualsRepo, TimeOffRequest } from '../../core/repos/accruals.repo';
import { formatDateTime } from '../../shared/utils/date.util';
import {
  dateInputValue, payrollLeaveGross, payrollLeaveHours,
  computeEmployeeGross, workedDateSet, payrollHolidayOffHours, payrollHolidayOffGross,
  DEFAULT_OVERTIME_POLICY, OvertimePolicy, OrgHoliday, EmployeeGrossBreakdown,
  computeDeductions, resolveDeductionElections, DEFAULT_DEDUCTION_ELECTIONS, DeductionElections, DeductionOverrides,
  defaultDeductionElectionsForCountry, DeductionBreakdown,
} from '../../shared/utils/payroll.util';
import { toCsv, downloadTextFile } from '../../shared/utils/csv.util';
import { TableListController } from '../../shared/ui/table-list/table-list.controller';
import { TablePaginatorComponent } from '../../shared/ui/table-list/table-paginator.component';
import { TranslocoModule } from '@jsverse/transloco';

type PayrollRow = {
  userId: string;
  employee: string;
  employeeNumber: string;
  entries: number;
  hours: number;
  gross: number;
  deductions: number;
  net: number;
  exceptions: number;
};

type PayslipEarningLine = {
  description: string;
  hours: number;
  rate: number;
  amount: number;
  department: string | null;
  location: string | null;
};

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, MatIconModule, TablePaginatorComponent, PayPeriodSelectorComponent, TranslocoModule],
  template: `
    <div class="pay-admin">
      <header class="pay-admin-hero">
        <div>
          <div class="pay-admin-kicker">{{ 'adminPayroll.kicker' | transloco }}</div>
          <h1>{{ 'adminPayroll.title' | transloco }}</h1>
          <p>{{ 'adminPayroll.subtitle' | transloco }}</p>
        </div>
        <div class="pay-admin-period">
          <label>{{ 'adminPayroll.payrollPeriod' | transloco }}</label>
          <app-pay-period-selector (periodChange)="onPeriodPicked($event)"></app-pay-period-selector>
          <div>
            <input type="date" [(ngModel)]="fromDate" (change)="reloadEntries()">
            <span>{{ 'adminPayroll.to' | transloco }}</span>
            <input type="date" [(ngModel)]="toDate" (change)="reloadEntries()">
          </div>
        </div>
      </header>

      <div *ngIf="!orgId" class="pay-admin-alert">
        <mat-icon>warning_amber</mat-icon>
        {{ 'adminPayroll.missingOrgContext' | transloco }}
      </div>

      <section class="pay-admin-kpis" *ngIf="orgId">
        <article><span>{{ 'adminPayroll.employees' | transloco }}</span><strong>{{ rows.length }}</strong></article>
        <article><span>{{ 'adminPayroll.totalHours' | transloco }}</span><strong>{{ totalHours().toFixed(2) }}</strong></article>
        <article><span>{{ 'adminPayroll.grossPayroll' | transloco }}</span><strong>{{ totalGross() | currency:moneyCurrency() }}</strong></article>
        <article><span>{{ 'adminPayroll.employerContributions' | transloco }}</span><strong>{{ totalEmployerContributions() | currency:moneyCurrency() }}</strong></article>
        <article [class.is-warn]="totalExceptions() > 0"><span>{{ 'adminPayroll.exceptions' | transloco }}</span><strong>{{ totalExceptions() }}</strong></article>
      </section>

      <section class="pay-admin-grid" *ngIf="orgId">
        <article class="pay-admin-card pay-run">
          <div class="pay-admin-card-head">
            <h2>{{ 'adminPayroll.draftPayrollRun' | transloco }}</h2>
            <span>{{ payrollRunLabel() | transloco }}</span>
          </div>
          <div class="pay-run-lock" [class.is-final]="payrollFinalized">
            <mat-icon>{{ payrollFinalized ? 'lock' : 'lock_open' }}</mat-icon>
            <div>
              <strong>{{ (payrollFinalized ? 'adminPayroll.payrollFinalizedLabel' : 'adminPayroll.payrollDraftEditable') | transloco }}</strong>
              <span>{{ payrollFinalized ? ('adminPayroll.finalizedAt' | transloco: { when: finalizedAtLabel() }) : (payrollStatus() | transloco) }}</span>
            </div>
          </div>
          <div class="pay-run-total">
            <span>{{ 'adminPayroll.estimatedNetPayroll' | transloco }}</span>
            <strong>{{ totalNet() | currency:moneyCurrency() }}</strong>
          </div>
          <div class="pay-run-lines">
            <div><span>{{ 'adminPayroll.grossWages' | transloco }}</span><strong>{{ totalGross() | currency:moneyCurrency() }}</strong></div>
            <div><span>{{ 'adminPayroll.estimatedDeductions' | transloco }}</span><strong>-{{ totalDeductions() | currency:moneyCurrency() }}</strong></div>
            <div><span>{{ 'adminPayroll.timecardRows' | transloco }}</span><strong>{{ entries().length }}</strong></div>
          </div>
          <button class="pay-primary" (click)="exportPayroll()" [disabled]="rows.length === 0">
            <mat-icon>download</mat-icon>
            {{ 'adminPayroll.exportPayrollCsv' | transloco }}
          </button>
          <button class="pay-primary pay-primary-alt" type="button" (click)="printSelectedPayslips()" [disabled]="selectedUserIds().length === 0">
            <mat-icon>print</mat-icon>
            {{ 'adminPayroll.printSelectedPdf' | transloco }}
          </button>
          <div class="pay-run-paydate" *ngIf="!payrollFinalized">
            <label for="payDateInput">{{ 'adminPayroll.payDate' | transloco }}</label>
            <input id="payDateInput" type="date" [(ngModel)]="payDate">
          </div>
          <div class="pay-run-actions">
            <button class="pay-secondary" type="button" (click)="finalizePayroll()" [disabled]="rows.length === 0 || totalExceptions() > 0 || payrollFinalized || payrollBusy || !payDate">
              <mat-icon>verified</mat-icon>
              {{ (payrollBusy ? 'adminPayroll.saving' : 'adminPayroll.finalizePayroll') | transloco }}
            </button>
            <button class="pay-secondary" type="button" (click)="reopenPayroll()" [disabled]="!payrollFinalized || payrollBusy">
              <mat-icon>edit</mat-icon>
              {{ 'adminPayroll.reopen' | transloco }}
            </button>
          </div>
        </article>

        <article class="pay-admin-card pay-exceptions">
          <div class="pay-admin-card-head">
            <h2>{{ 'adminPayroll.payrollReadiness' | transloco }}</h2>
            <mat-icon>fact_check</mat-icon>
          </div>
          <div class="pay-readiness" [class.is-ready]="totalExceptions() === 0">
            <mat-icon>{{ totalExceptions() === 0 ? 'check_circle' : 'warning_amber' }}</mat-icon>
            <div>
              <strong>{{ (totalExceptions() === 0 ? 'adminPayroll.readyForExport' : 'adminPayroll.needsReview') | transloco }}</strong>
              <span>{{ totalExceptions() === 0 ? ('adminPayroll.noExceptionsNote' | transloco) : ('adminPayroll.exceptionsNote' | transloco: { count: totalExceptions() }) }}</span>
            </div>
          </div>
          <div class="pay-run-lines">
            <div><span>{{ 'adminPayroll.pendingReview' | transloco }}</span><strong>{{ exceptionStatusCount('pending') }}</strong></div>
            <div><span>{{ 'adminPayroll.rejected' | transloco }}</span><strong>{{ exceptionStatusCount('rejected') }}</strong></div>
            <div><span>{{ 'adminPayroll.openPunches' | transloco }}</span><strong>{{ openPunchCount() }}</strong></div>
          </div>
        </article>
      </section>

      <section class="pay-admin-card pay-table-card" *ngIf="orgId">
        <div class="pay-admin-card-head">
          <h2>{{ 'adminPayroll.employeePayrollSummary' | transloco }}</h2>
          <input [ngModel]="query" (ngModelChange)="onQueryChange($event)" [placeholder]="'adminPayroll.searchEmployee' | transloco">
        </div>
        <div class="pay-table-shell">
          <table>
            <thead>
              <tr>
                <th class="pay-check-col">
                  <input type="checkbox" [checked]="allFilteredSelected()" (change)="toggleSelectAll($any($event.target).checked)">
                </th>
                <th class="pay-th-sort" (click)="payrollCtrl.toggleSort('employee')">{{ 'adminPayroll.colEmployee' | transloco }} {{ payrollCtrl.sortIndicator('employee') }}</th>
                <th class="pay-th-sort" (click)="payrollCtrl.toggleSort('entries')">{{ 'adminPayroll.colEntries' | transloco }} {{ payrollCtrl.sortIndicator('entries') }}</th>
                <th class="pay-th-sort" (click)="payrollCtrl.toggleSort('hours')">{{ 'adminPayroll.colHours' | transloco }} {{ payrollCtrl.sortIndicator('hours') }}</th>
                <th class="pay-th-sort" (click)="payrollCtrl.toggleSort('gross')">{{ 'adminPayroll.colGross' | transloco }} {{ payrollCtrl.sortIndicator('gross') }}</th>
                <th class="pay-th-sort" (click)="payrollCtrl.toggleSort('deductions')">{{ 'adminPayroll.colDeductions' | transloco }} {{ payrollCtrl.sortIndicator('deductions') }}</th>
                <th class="pay-th-sort" (click)="payrollCtrl.toggleSort('net')">{{ 'adminPayroll.colNet' | transloco }} {{ payrollCtrl.sortIndicator('net') }}</th>
                <th class="pay-th-sort" (click)="payrollCtrl.toggleSort('exceptions')">{{ 'adminPayroll.colExceptions' | transloco }} {{ payrollCtrl.sortIndicator('exceptions') }}</th>
                <th>{{ 'adminPayroll.colStatus' | transloco }}</th>
                <th>{{ 'adminPayroll.colPrint' | transloco }}</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngIf="payrollCtrl.pageRows().length === 0">
                <td colspan="10">{{ 'adminPayroll.noPayrollRows' | transloco }}</td>
              </tr>
              <tr *ngFor="let r of payrollCtrl.pageRows()">
                <td class="pay-check-col">
                  <input type="checkbox" [checked]="isSelected(r.userId)" (change)="toggleUserSelection(r.userId, $any($event.target).checked)">
                </td>
                <td><strong>{{ r.employee }}</strong><span>{{ r.employeeNumber || ('adminPayroll.employeeRecordFallback' | transloco) }}</span></td>
                <td>{{ r.entries }}</td>
                <td>{{ r.hours.toFixed(2) }}</td>
                <td>{{ r.gross | currency:moneyCurrency() }}</td>
                <td>{{ r.deductions | currency:moneyCurrency() }}</td>
                <td>{{ r.net | currency:moneyCurrency() }}</td>
                <td>{{ r.exceptions }}</td>
                <td>
                  <button *ngIf="r.exceptions > 0" class="pay-row-btn pay-review-btn" type="button" (click)="reviewInTimesheets(r.userId)">
                    <mat-icon>flag</mat-icon> {{ 'adminPayroll.review' | transloco: { count: r.exceptions } }}
                  </button>
                  <em *ngIf="r.exceptions === 0">{{ 'adminPayroll.ready' | transloco }}</em>
                </td>
                <td>
                  <button class="pay-row-btn" (click)="printPayslip(r.userId)">
                    <mat-icon>picture_as_pdf</mat-icon>
                    {{ 'adminPayroll.pdf' | transloco }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <app-table-paginator *ngIf="filteredRows().length > 0" [controller]="payrollCtrl"></app-table-paginator>
      </section>

      <section class="pay-admin-card pay-table-card" *ngIf="orgId">
        <div class="pay-admin-card-head">
          <h2>{{ 'adminPayroll.payrollDetailRows' | transloco }}</h2>
          <span>{{ 'adminPayroll.timeEntriesCount' | transloco: { count: entries().length } }}</span>
        </div>
        <div class="pay-table-shell">
          <table>
            <thead>
              <tr>
                <th class="pay-th-sort" (click)="detailCtrl.toggleSort('employee')">{{ 'adminPayroll.colEmployee' | transloco }} {{ detailCtrl.sortIndicator('employee') }}</th>
                <th class="pay-th-sort" (click)="detailCtrl.toggleSort('date')">{{ 'adminPayroll.colDate' | transloco }} {{ detailCtrl.sortIndicator('date') }}</th>
                <th>{{ 'adminPayroll.colShift' | transloco }}</th>
                <th>{{ 'adminPayroll.colCheckIn' | transloco }}</th>
                <th>{{ 'adminPayroll.colCheckOut' | transloco }}</th>
                <th class="pay-th-sort" (click)="detailCtrl.toggleSort('hours')">{{ 'adminPayroll.colHours' | transloco }} {{ detailCtrl.sortIndicator('hours') }}</th>
                <th>{{ 'adminPayroll.colRate' | transloco }}</th>
                <th class="pay-th-sort" (click)="detailCtrl.toggleSort('gross')">{{ 'adminPayroll.colGross' | transloco }} {{ detailCtrl.sortIndicator('gross') }}</th>
                <th class="pay-th-sort" (click)="detailCtrl.toggleSort('status')">{{ 'adminPayroll.colStatus' | transloco }} {{ detailCtrl.sortIndicator('status') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let e of detailCtrl.pageRows()">
                <td>{{ e.employee }}</td>
                <td>{{ e.date }}</td>
                <td>{{ e.shiftTitle }}</td>
                <td>{{ e.checkIn }}</td>
                <td>{{ e.checkOut }}</td>
                <td>{{ e.hours.toFixed(2) }}</td>
                <td>{{ e.rate | currency:moneyCurrency() }}</td>
                <td>{{ e.gross | currency:moneyCurrency() }}</td>
                <td><em [class.is-warn]="e.status !== 'none'">{{ e.status }}</em></td>
              </tr>
            </tbody>
          </table>
        </div>
        <app-table-paginator *ngIf="entries().length > 0" [controller]="detailCtrl"></app-table-paginator>
      </section>
    </div>
  `,
  styles: [`
    .pay-admin { color:#1f2937; }
    .pay-admin-hero { min-height:150px; margin:-24px -22px 22px; padding:28px; display:flex; align-items:end; justify-content:space-between; gap:20px; background:#07533f; color:#fff; }
    .pay-admin-kicker { color:rgba(255,255,255,.72); font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; margin-bottom:8px; }
    .pay-admin-hero h1 { margin:0; font-size:34px; font-weight:800; }
    .pay-admin-hero p { margin:8px 0 0; color:rgba(255,255,255,.82); }
    .pay-admin-period { display:grid; gap:6px; min-width:330px; }
    .pay-admin-period label { color:rgba(255,255,255,.75); font-size:12px; font-weight:800; }
    .pay-admin-period div { display:flex; align-items:center; gap:8px; }
    .pay-admin-period input { height:38px; border:1px solid rgba(255,255,255,.34); border-radius:6px; background:#fff; color:#111827; padding:0 9px; }
    .pay-admin-alert { display:flex; gap:10px; padding:14px 16px; color:#92400e; background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; font-weight:800; }
    .pay-admin-kpis { display:grid; grid-template-columns:repeat(5,1fr); gap:14px; margin-bottom:16px; }
    .pay-admin-kpis article, .pay-admin-card { border:1px solid rgba(15,23,42,.12); border-radius:8px; background:rgba(255,255,255,.94); box-shadow:0 12px 28px rgba(15,23,42,.07); }
    .pay-admin-kpis article { padding:16px; }
    .pay-admin-kpis span { color:#64748b; font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; }
    .pay-admin-kpis strong { display:block; margin-top:8px; color:#0f172a; font-size:28px; }
    .pay-admin-kpis .is-warn strong { color:#b45309; }
    .pay-admin-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
    .pay-admin-card { overflow:hidden; margin-bottom:16px; }
    .pay-admin-card-head { min-height:50px; padding:0 16px; display:flex; justify-content:space-between; align-items:center; gap:12px; border-bottom:1px solid #e5e7eb; }
    .pay-admin-card-head h2 { margin:0; font-size:16px; font-weight:800; }
    .pay-admin-card-head span { color:#64748b; font-size:12px; }
    .pay-admin-card-head input { height:34px; border:1px solid #cbd5e1; border-radius:6px; padding:0 10px; color:#111827; background:#fff; }
    .pay-run-total { padding:18px 16px; background:#ecfdf5; display:flex; justify-content:space-between; align-items:center; }
    .pay-run-lock { display:flex; align-items:center; gap:10px; padding:14px 16px; background:#f8fafc; border-bottom:1px solid #e5e7eb; color:#475569; }
    .pay-run-lock.is-final { background:#eff6ff; color:#1d4ed8; }
    .pay-run-lock mat-icon { font-size:21px; width:21px; height:21px; }
    .pay-run-lock strong, .pay-run-lock span { display:block; }
    .pay-run-lock strong { color:#0f172a; }
    .pay-run-lock span { margin-top:3px; font-size:12px; color:#64748b; }
    .pay-run-total span { color:#047857; font-weight:800; }
    .pay-run-total strong { font-size:26px; color:#064e3b; }
    .pay-run-lines { display:grid; gap:0; }
    .pay-run-lines div { display:flex; justify-content:space-between; padding:12px 16px; border-top:1px solid #e5e7eb; color:#475569; }
    .pay-run-lines strong { color:#0f172a; }
    .pay-primary { margin:16px; height:42px; border:0; border-radius:6px; background:#047857; color:#fff; display:inline-flex; align-items:center; justify-content:center; gap:8px; font-weight:800; padding:0 16px; cursor:pointer; }
    .pay-primary-alt { margin-top:0; background:#0f766e; }
    .pay-primary:disabled { opacity:.55; cursor:not-allowed; }
    .pay-run-paydate { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0 16px 12px; }
    .pay-run-paydate label { font-size:12px; font-weight:800; color:#475569; }
    .pay-run-paydate input { height:34px; border:1px solid #cbd5e1; border-radius:6px; padding:0 10px; color:#111827; background:#fff; }
    .pay-run-actions { display:flex; gap:8px; padding:0 16px 16px; flex-wrap:wrap; }
    .pay-secondary { height:38px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; color:#07533f; display:inline-flex; align-items:center; justify-content:center; gap:7px; font-weight:800; padding:0 12px; cursor:pointer; }
    .pay-secondary:disabled { opacity:.5; cursor:not-allowed; }
    .pay-row-btn { height:30px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; color:#07533f; display:inline-flex; align-items:center; gap:5px; padding:0 9px; font-weight:800; cursor:pointer; }
    .pay-row-btn mat-icon { font-size:16px; width:16px; height:16px; }
    .pay-review-btn { border-color:#fed7aa; background:#fff7ed; color:#b45309; white-space:nowrap; }
    .pay-readiness { display:flex; gap:12px; padding:18px 16px; background:#fff7ed; color:#92400e; border-bottom:1px solid #fed7aa; }
    .pay-readiness.is-ready { background:#ecfdf5; color:#047857; border-bottom-color:#a7f3d0; }
    .pay-readiness strong, .pay-readiness span { display:block; }
    .pay-readiness span { margin-top:4px; font-size:13px; color:#475569; }
    .pay-table-shell { overflow:auto; }
    table { width:100%; min-width:980px; border-collapse:collapse; }
    th { background:#eef3ef; color:#334155; font-size:11px; text-align:left; text-transform:uppercase; letter-spacing:.06em; padding:10px; border-bottom:1px solid #d1d5db; }
    .pay-th-sort { cursor:pointer; user-select:none; }
    .pay-th-sort:hover { color:#07533f; }
    td { padding:11px 10px; border-bottom:1px solid #e5e7eb; color:#1f2937; white-space:nowrap; }
    tr:nth-child(even) td { background:#f8fafc; }
    td strong { display:block; color:#0f172a; }
    td span { color:#64748b; font-size:11px; }
    td em { border-radius:999px; background:#ecfdf5; color:#047857; padding:4px 8px; font-style:normal; font-size:11px; font-weight:800; }
    td em.is-warn { background:#fff7ed; color:#b45309; }
    .pay-check-col { width:34px; text-align:center; }
    .pay-check-col input { width:16px; height:16px; }
    @media (max-width:980px) { .pay-admin-hero { align-items:flex-start; flex-direction:column; margin:-14px -12px 18px; padding:22px 16px; } .pay-admin-period { min-width:0; width:100%; } .pay-admin-kpis, .pay-admin-grid { grid-template-columns:1fr; } }
  `]
})
export class AdminPayrollPage implements OnDestroy {
  orgId: string | null = null;
  fromDate = '';
  toDate = '';
  payDate = '';
  query = '';
  users = signal<OrgUser[]>([]);
  entries = signal<TimeEntry[]>([]);
  leaveRequests = signal<TimeOffRequest[]>([]);
  shiftMap: Record<string, Shift> = {};
  rows: PayrollRow[] = [];
  selected = new Set<string>();

  // Plain fields (rows/query) don't trigger computed() re-evaluation, so
  // these views are refreshed manually wherever rows/query change — see
  // recomputeRows() and onQueryChange().
  private payrollRowsView = signal<PayrollRow[]>([]);
  payrollCtrl = new TableListController<PayrollRow>(this.payrollRowsView, {
    pageSize: 25,
    sortAccessor: (r, key) => {
      if (key === 'employee') return r.employee.toLowerCase();
      if (key === 'entries') return r.entries;
      if (key === 'hours') return r.hours;
      if (key === 'gross') return r.gross;
      if (key === 'deductions') return r.deductions;
      if (key === 'net') return r.net;
      if (key === 'exceptions') return r.exceptions;
      return null;
    },
  });

  private detailRowsView = signal<Array<any>>([]);
  detailCtrl = new TableListController<any>(this.detailRowsView, {
    pageSize: 25,
    sortAccessor: (r, key) => {
      if (key === 'employee') return String(r.employee || '').toLowerCase();
      if (key === 'date') return String(r.date || '');
      if (key === 'hours') return r.hours;
      if (key === 'gross') return r.gross;
      if (key === 'status') return String(r.status || '');
      return null;
    },
  });
  payrollFinalized = false;
  payrollFinalizedAt: any = null;
  payrollBusy = false;
  private unsubUsers: (() => void) | null = null;
  private unsubEntries: (() => void) | null = null;
  private unsubLeave: (() => void) | null = null;
  private unsubRun: (() => void) | null = null;

  orgDefaultPayRate = 0;
  overtimePolicy: OvertimePolicy = DEFAULT_OVERTIME_POLICY;
  holidayWorkMultiplier = 1.5;
  holidays: OrgHoliday[] = [];
  orgDeductionDefaults: DeductionElections = DEFAULT_DEDUCTION_ELECTIONS;
  private breakdownsByUser = new Map<string, EmployeeGrossBreakdown>();
  private holidayAwards: Array<{ userId: string; holiday: OrgHoliday; hours: number; rate: number; gross: number }> = [];
  private employerContributionsByUser = new Map<string, number>();
  private deductionBreakdownByUser = new Map<string, DeductionBreakdown>();

  constructor(
    private zone: NgZone,
    private ctx: OrgContextService,
    private payPeriod: PayPeriodService,
    private timeRepo: TimeEntriesRepo,
    private usersRepo: UsersRepo,
    private shiftsRepo: ShiftsRepo,
    private accruals: AccrualsRepo,
    private printLauncher: PrintLauncherService,
    private toast: ToastService,
    private router: Router,
  ) {
    const period = this.payPeriod.selectedPeriod();
    this.fromDate = dateInputValue(period.start);
    this.toDate = dateInputValue(period.end);
    this.payDate = this.toDate;
    this.bind();
    setTimeout(() => this.bind(), 800);
  }

  onPeriodPicked(opt: PayPeriodOption) {
    this.fromDate = dateInputValue(opt.period.start);
    this.toDate = dateInputValue(opt.period.end);
    this.reloadEntries();
  }

  private bind() {
    const orgId = this.ctx.orgId();
    this.orgId = orgId;
    if (!orgId) return;
    this.bindPayrollRun();
    if (!this.unsubUsers) {
      this.unsubUsers = this.usersRepo.watchOrgUsers(orgId, (items) => {
        this.users.set(items);
        this.recomputeRows();
      });
    }
    void this.loadPayrollPolicy(orgId);
    this.reloadEntries();
  }

  private async loadPayrollPolicy(orgId: string) {
    try {
      const snap = await getDoc(doc(getFirestore(), 'orgs', orgId));
      const data: any = snap.exists() ? snap.data() : {};
      this.orgDefaultPayRate = Number(data.defaultPayRate || 0);
      this.overtimePolicy = {
        enabled: data.overtimeEnabled !== false,
        multiplier: Math.max(1, Number(data.overtimeMultiplier || 1.5)),
        weeklyThresholdHours: Math.max(1, Number(data.overtimeWeeklyThresholdHours || 40)),
      };
      this.holidayWorkMultiplier = Math.max(1, Number(data.holidayWorkMultiplier || 1.5));
      this.holidays = Array.isArray(data.holidays) ? data.holidays : [];
      const countryDefaults = defaultDeductionElectionsForCountry(data.countryCode);
      this.orgDeductionDefaults = {
        federalTaxPercent: Number(data.defaultFederalTaxPercent ?? countryDefaults.federalTaxPercent),
        stateTaxPercent: Number(data.defaultStateTaxPercent ?? countryDefaults.stateTaxPercent),
        socialSecurityPercent: Number(data.defaultSocialSecurityPercent ?? countryDefaults.socialSecurityPercent),
        medicarePercent: Number(data.defaultMedicarePercent ?? countryDefaults.medicarePercent),
        retirement401kPercent: 0,
        retirement401kMatchPercent: Number(data.default401kMatchPercent ?? 0),
        retirement401kProvider: String(data.default401kProvider || ''),
        benefits: [],
      };
    } catch {
      this.orgDefaultPayRate = 0;
      this.overtimePolicy = DEFAULT_OVERTIME_POLICY;
      this.holidayWorkMultiplier = 1.5;
      this.holidays = [];
      this.orgDeductionDefaults = DEFAULT_DEDUCTION_ELECTIONS;
    }
    this.recomputeRows();
  }

  private employeeRate(uid: string): number {
    const user: any = this.users().find((u) => u.uid === uid);
    return Number(user?.payroll?.payRate ?? user?.payRate ?? this.orgDefaultPayRate ?? 0);
  }

  private employeeDeductionOverrides(uid: string): DeductionOverrides {
    const user: any = this.users().find((u) => u.uid === uid);
    const deductions = user?.payroll?.deductions || {};
    return {
      federalTaxPercent: deductions.federalTaxPercent ?? null,
      stateTaxPercent: deductions.stateTaxPercent ?? null,
      socialSecurityPercent: deductions.socialSecurityPercent ?? null,
      medicarePercent: deductions.medicarePercent ?? null,
      retirement401kPercent: deductions.retirement401kPercent ?? null,
      retirement401kMatchPercent: deductions.retirement401kMatchPercent ?? null,
      retirement401kProvider: deductions.retirement401kProvider ?? null,
      benefits: Array.isArray(deductions.benefits) ? deductions.benefits : null,
    };
  }

  reloadEntries() {
    if (!this.orgId || !this.fromDate || !this.toDate) return;
    this.bindPayrollRun();
    this.unsubEntries?.();
    const start = Timestamp.fromDate(new Date(`${this.fromDate}T00:00:00`));
    const end = Timestamp.fromDate(new Date(`${this.toDate}T23:59:59`));
    this.unsubEntries = this.timeRepo.watchOrgEntriesRange(this.orgId, start, end, async (items) => {
      this.entries.set(items);
      const shiftIds = Array.from(new Set(items.map((e) => e.shiftId))).filter(Boolean);
      this.shiftMap = shiftIds.length ? await this.shiftsRepo.getManyByIds(this.orgId!, shiftIds) : {};
      this.recomputeRows();
    });
    if (!this.unsubLeave) {
      this.unsubLeave = this.accruals.watchOrgRequests(this.orgId, (items) => {
        this.leaveRequests.set(items);
        this.recomputeRows();
      });
    }
  }

  private recomputeRows() {
    const grouped = new Map<string, PayrollRow>();
    const getRow = (uid: string): PayrollRow => grouped.get(uid) || {
      userId: uid,
      employee: this.userLabel(uid),
      employeeNumber: this.employeeNumber(uid),
      entries: 0,
      hours: 0,
      gross: 0,
      deductions: 0,
      net: 0,
      exceptions: 0,
    };

    const entriesByUser = new Map<string, TimeEntry[]>();
    for (const entry of this.entries()) {
      const uid = entry.userId || 'unknown';
      const list = entriesByUser.get(uid);
      if (list) list.push(entry); else entriesByUser.set(uid, [entry]);
    }

    const holidayDates = new Set(this.holidays.map((h) => h.date));
    this.breakdownsByUser = new Map<string, EmployeeGrossBreakdown>();
    for (const [uid, userEntries] of entriesByUser) {
      const breakdown = computeEmployeeGross(userEntries, this.shiftMap, this.orgDefaultPayRate, this.overtimePolicy, holidayDates, this.holidayWorkMultiplier);
      this.breakdownsByUser.set(uid, breakdown);
      const existing = getRow(uid);
      existing.entries += userEntries.length;
      existing.hours += breakdown.hours;
      existing.gross += breakdown.gross;
      // Only entries actually awaiting a decision (or missing a checkout)
      // block payroll — 'approved'/'rejected' are resolved history, not
      // something still requiring admin action.
      existing.exceptions += userEntries.filter((e) => e.exceptionStatus === 'pending' || !e.checkOutAt).length;
      grouped.set(uid, existing);
    }

    for (const request of this.leaveRequests().filter((r) => this.isPayrollLeave(r))) {
      const uid = request.userId || 'unknown';
      const existing = getRow(uid);
      const hours = payrollLeaveHours(request, this.fromDate, this.toDate);
      const gross = payrollLeaveGross(request, this.fromDate, this.toDate);
      existing.entries += 1;
      existing.hours += hours;
      existing.gross += gross;
      grouped.set(uid, existing);
    }

    this.holidayAwards = [];
    const holidaysInPeriod = this.holidays.filter((h) => h.date >= this.fromDate && h.date <= this.toDate);
    if (holidaysInPeriod.length > 0) {
      for (const user of this.users().filter((u) => u.active !== false)) {
        const workedDates = workedDateSet(entriesByUser.get(user.uid) || []);
        for (const holiday of holidaysInPeriod) {
          const hours = payrollHolidayOffHours(holiday, workedDates);
          if (hours <= 0) continue;
          const rate = this.employeeRate(user.uid);
          const gross = payrollHolidayOffGross(holiday, rate, workedDates);
          this.holidayAwards.push({ userId: user.uid, holiday, hours, rate, gross });
          const existing = getRow(user.uid);
          existing.entries += 1;
          existing.hours += hours;
          existing.gross += gross;
          grouped.set(user.uid, existing);
        }
      }
    }

    // Tax/benefit deductions apply once per paycheck against total gross,
    // not per line item — computed here after all gross sources are summed.
    this.employerContributionsByUser = new Map<string, number>();
    this.deductionBreakdownByUser = new Map<string, DeductionBreakdown>();
    for (const [uid, row] of grouped) {
      const elections = resolveDeductionElections(this.orgDeductionDefaults, this.employeeDeductionOverrides(uid));
      const deductionBreakdown = computeDeductions(row.gross, elections);
      row.deductions = deductionBreakdown.totalDeductions;
      row.net = deductionBreakdown.netPay;
      this.employerContributionsByUser.set(uid, deductionBreakdown.employerContributionsTotal);
      this.deductionBreakdownByUser.set(uid, deductionBreakdown);
      grouped.set(uid, row);
    }

    this.rows = Array.from(grouped.values()).map((r) => ({
      ...r,
      hours: Math.round(r.hours * 100) / 100,
      gross: Math.round(r.gross * 100) / 100,
      deductions: Math.round(r.deductions * 100) / 100,
      net: Math.round(r.net * 100) / 100,
    })).sort((a, b) => a.employee.localeCompare(b.employee));
    this.payrollRowsView.set(this.filteredRows());
    this.detailRowsView.set(this.detailRows());
  }

  onQueryChange(value: string) {
    this.query = value;
    this.payrollRowsView.set(this.filteredRows());
  }

  userLabel(uid: string): string {
    const user = this.users().find((u) => u.uid === uid);
    return user?.displayName || user?.email || 'Staff member';
  }

  employeeNumber(uid: string): string {
    const user: any = this.users().find((u) => u.uid === uid);
    return user?.employeeNumber || user?.profile?.employeeNumber || '';
  }

  filteredRows(): PayrollRow[] {
    const q = this.query.toLowerCase().trim();
    if (!q) return this.rows;
    return this.rows.filter((r) => r.employee.toLowerCase().includes(q) || r.employeeNumber.toLowerCase().includes(q));
  }

  isSelected(uid: string) {
    return this.selected.has(uid);
  }

  selectedUserIds() {
    return Array.from(this.selected);
  }

  toggleUserSelection(uid: string, checked: boolean) {
    if (checked) this.selected.add(uid);
    else this.selected.delete(uid);
  }

  toggleSelectAll(checked: boolean) {
    if (!checked) {
      this.selected.clear();
      return;
    }
    for (const row of this.filteredRows()) this.selected.add(row.userId);
  }

  allFilteredSelected() {
    const rows = this.filteredRows();
    return rows.length > 0 && rows.every((row) => this.selected.has(row.userId));
  }

  private static readonly LINE_TYPE_SUFFIX: Record<string, string> = {
    overtime: ' (Overtime)',
    holiday_worked: ' (Holiday)',
    regular: '',
  };

  detailRows() {
    const worked: Array<{ employee: string; date: string; shiftTitle: string; checkIn: string; checkOut: string; hours: number; rate: number; gross: number; status: string }> = [];
    for (const [uid, breakdown] of this.breakdownsByUser) {
      for (const line of breakdown.lines) {
        worked.push({
          employee: this.userLabel(uid),
          date: line.date,
          shiftTitle: `${line.shiftTitle}${AdminPayrollPage.LINE_TYPE_SUFFIX[line.type] || ''}`,
          checkIn: formatDateTime(line.checkInAt),
          checkOut: line.checkOutAt ? formatDateTime(line.checkOutAt) : 'Open',
          hours: line.hours,
          rate: line.rate,
          gross: line.gross,
          status: line.status,
        });
      }
    }

    const leave = this.leaveRequests()
      .filter((request) => this.isPayrollLeave(request))
      .map((request) => {
        const hours = payrollLeaveHours(request, this.fromDate, this.toDate);
        const rate = Number(request.payRate || 0);
        return {
          employee: this.userLabel(request.userId),
          date: request.startDate || '-',
          shiftTitle: `${request.requestType.toUpperCase()} approved leave`,
          checkIn: request.startDate,
          checkOut: request.endDate,
          hours,
          rate,
          gross: payrollLeaveGross(request, this.fromDate, this.toDate),
          status: 'approved leave',
        };
      });

    const holidayOff = this.holidayAwards.map((award) => ({
      employee: this.userLabel(award.userId),
      date: award.holiday.date,
      shiftTitle: `${award.holiday.name} (Holiday Pay)`,
      checkIn: award.holiday.date,
      checkOut: '-',
      hours: award.hours,
      rate: award.rate,
      gross: award.gross,
      status: 'holiday pay',
    }));

    return [...worked, ...leave, ...holidayOff];
  }

  private isPayrollLeave(request: TimeOffRequest): boolean {
    if (request.status !== 'approved') return false;
    if (request.requestType === 'unpaid') return false;
    if (request.paid === false) return false;
    return payrollLeaveHours(request, this.fromDate, this.toDate) > 0;
  }

  totalHours() { return this.rows.reduce((sum, r) => sum + r.hours, 0); }
  totalGross() { return Math.round(this.rows.reduce((sum, r) => sum + r.gross, 0) * 100) / 100; }
  totalDeductions() { return Math.round(this.rows.reduce((sum, r) => sum + r.deductions, 0) * 100) / 100; }
  totalNet() { return Math.round(this.rows.reduce((sum, r) => sum + r.net, 0) * 100) / 100; }
  totalExceptions() { return this.rows.reduce((sum, r) => sum + r.exceptions, 0); }
  totalEmployerContributions() { return Math.round(Array.from(this.employerContributionsByUser.values()).reduce((sum, v) => sum + v, 0) * 100) / 100; }
  exceptionStatusCount(status: string) { return this.entries().filter((e) => e.exceptionStatus === status).length; }
  openPunchCount() { return this.entries().filter((e) => !e.checkOutAt).length; }
  payrollStatus() { return this.totalExceptions() ? 'adminPayroll.reviewRequired' : 'adminPayroll.ready'; }
  payrollRunLabel() { return this.payrollFinalized ? 'adminPayroll.finalized' : this.payrollStatus(); }
  moneyCurrency() { return this.ctx.currencyCode() || 'USD'; }

  exportPayroll() {
    const csv = toCsv(this.rows, ['userId', 'employee', 'entries', 'hours', 'gross', 'deductions', 'net', 'exceptions']);
    downloadTextFile(`payroll_${this.fromDate}_to_${this.toDate}.csv`, csv, 'text/csv');
  }

  printPayslip(uid: string) {
    this.printLauncher.open('/print/payslip', {
      uid,
      from: this.fromDate,
      to: this.toDate,
    }, 'admin-payslip');
  }

  reviewInTimesheets(uid: string) {
    void this.router.navigate(['/admin/timesheets'], {
      queryParams: { uid, from: this.fromDate, to: this.toDate },
    });
  }

  printSelectedPayslips() {
    const uids = this.selectedUserIds();
    if (!uids.length) return;
    this.printLauncher.open('/print/payroll-batch', {
      uids: uids.join(','),
      from: this.fromDate,
      to: this.toDate,
    }, 'batch-payslips');
  }

  private payrollRunId() {
    return `${this.fromDate}_to_${this.toDate}`.replace(/[^0-9A-Za-z_-]/g, '_');
  }

  private bindPayrollRun() {
    if (!this.orgId || !this.fromDate || !this.toDate) return;
    this.unsubRun?.();
    const ref = doc(getFirestore(), `orgs/${this.orgId}/payrollRuns/${this.payrollRunId()}`);
    this.unsubRun = onSnapshot(ref, (snap) => {
      const data: any = snap.exists() ? snap.data() : {};
      this.zone.run(() => {
        this.payrollFinalized = data.status === 'finalized';
        this.payrollFinalizedAt = data.finalizedAt || data.updatedAt || null;
      });
    }, () => {
      this.zone.run(() => {
        this.payrollFinalized = false;
        this.payrollFinalizedAt = null;
      });
    });
  }

  private earningsForUser(uid: string): PayslipEarningLine[] {
    const user: any = this.users().find((u) => u.uid === uid);
    const department = user?.department || null;
    const location = user?.locationName || null;
    const lines: PayslipEarningLine[] = [];

    const breakdown = this.breakdownsByUser.get(uid);
    if (breakdown) {
      for (const line of breakdown.lines) {
        lines.push({
          description: `${line.shiftTitle}${AdminPayrollPage.LINE_TYPE_SUFFIX[line.type] || ''}`,
          hours: line.hours,
          rate: line.rate,
          amount: line.gross,
          department,
          location,
        });
      }
    }

    for (const request of this.leaveRequests().filter((r) => r.userId === uid && this.isPayrollLeave(r))) {
      lines.push({
        description: `${request.requestType.toUpperCase()} approved leave`,
        hours: payrollLeaveHours(request, this.fromDate, this.toDate),
        rate: Number(request.payRate || 0),
        amount: payrollLeaveGross(request, this.fromDate, this.toDate),
        department,
        location,
      });
    }

    for (const award of this.holidayAwards.filter((a) => a.userId === uid)) {
      lines.push({
        description: `${award.holiday.name} (Holiday Pay)`,
        hours: award.hours,
        rate: award.rate,
        amount: award.gross,
        department,
        location,
      });
    }

    return lines;
  }

  async finalizePayroll() {
    if (!this.orgId || this.payrollFinalized || this.totalExceptions() > 0 || this.rows.length === 0 || !this.payDate) return;
    this.payrollBusy = true;
    try {
      const fns = getFunctions(undefined, 'us-east1');
      const finalize = httpsCallable<any, any>(fns, 'finalizePayrollRun');
      await finalize({
        orgId: this.orgId,
        periodStart: this.fromDate,
        periodEnd: this.toDate,
        payDate: this.payDate,
        currencyCode: this.moneyCurrency(),
        rows: this.rows.map((row) => ({
          userId: row.userId,
          employeeName: row.employee,
          employeeNumber: row.employeeNumber || null,
          totalHours: row.hours,
          grossPay: row.gross,
          deductionBreakdown: this.deductionBreakdownByUser.get(row.userId),
          earnings: this.earningsForUser(row.userId),
        })),
      });
      this.toast.success('Payroll finalized — pay stubs issued.');
    } catch (err: any) {
      this.toast.errorFrom(err, 'Failed to finalize payroll.');
    } finally {
      this.payrollBusy = false;
    }
  }

  async reopenPayroll() {
    if (!this.orgId || !this.payrollFinalized) return;
    this.payrollBusy = true;
    try {
      await setDoc(doc(getFirestore(), `orgs/${this.orgId}/payrollRuns/${this.payrollRunId()}`), {
        status: 'draft',
        reopenedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } finally {
      this.payrollBusy = false;
    }
  }

  finalizedAtLabel() {
    if (!this.payrollFinalizedAt) return 'recently';
    const value: any = this.payrollFinalizedAt;
    const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? 'recently' : date.toLocaleString();
  }

  ngOnDestroy() {
    this.unsubUsers?.();
    this.unsubEntries?.();
    this.unsubLeave?.();
    this.unsubRun?.();
  }
}
