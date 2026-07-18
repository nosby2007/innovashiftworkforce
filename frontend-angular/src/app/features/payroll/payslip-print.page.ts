import { Component, effect, EffectRef, OnDestroy, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { doc, getDoc, getFirestore, Timestamp } from 'firebase/firestore';
import { MatIconModule } from '@angular/material/icon';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { TimeEntriesRepo } from '../../core/repos/time-entries.repo';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { UsersRepo, OrgUser } from '../../core/repos/users.repo';
import { AccrualsRepo, TimeOffRequest } from '../../core/repos/accruals.repo';
import { TimeEntry } from '../../shared/models/time-entry.model';
import { Shift } from '../../shared/models/shift.model';
import { formatDateTime } from '../../shared/utils/date.util';
import {
  currentPayrollPeriod, dateInputValue,
  payrollLeaveHours, payrollLeaveGross,
  computeEmployeeGross, workedDateSet, payrollHolidayOffHours, payrollHolidayOffGross,
  DEFAULT_OVERTIME_POLICY, OvertimePolicy, OrgHoliday, EmployeeGrossBreakdown,
  computeDeductions, resolveDeductionElections, DEFAULT_DEDUCTION_ELECTIONS,
  DeductionElections, DeductionOverrides, DeductionBreakdown,
  defaultDeductionElectionsForCountry,
} from '../../shared/utils/payroll.util';

@Component({
  standalone: true,
  imports: [CommonModule, CurrencyPipe, MatIconModule],
  template: `
    <div class="ps-page">
      <div class="ps-toolbar no-print">
        <button class="ps-btn" (click)="back()"><mat-icon>{{ isStandalonePrint ? 'close' : 'arrow_back' }}</mat-icon> {{ isStandalonePrint ? 'Close' : 'Back' }}</button>
        <button class="ps-btn ps-btn-primary" (click)="printPdf()"><mat-icon>picture_as_pdf</mat-icon> Print / Save PDF</button>
      </div>

      <section class="ps-sheet">
        <header class="ps-header">
          <div>
            <div class="ps-brand">{{ orgName || 'INNOVASHIFT' }}</div>
            <h1>Pay Slip</h1>
            <p>Generated from validated timecard entries</p>
          </div>
          <div class="ps-meta">
            <span>Pay period</span>
            <strong>{{ fromDate }} to {{ toDate }}</strong>
            <span>Pay date</span>
            <strong>{{ toDate }}</strong>
            <span>Generated</span>
            <strong>{{ generatedAt }}</strong>
          </div>
        </header>

        <section class="ps-employee">
          <div>
            <span>Employee</span>
            <strong>{{ employeeName() }}</strong>
          </div>
          <div>
            <span>Employee ID</span>
            <strong>{{ employeeNumber() }}</strong>
          </div>
          <div>
            <span>Organization</span>
            <strong>{{ orgId ? 'Organization workspace' : '—' }}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{{ exceptionCount() > 0 ? 'Review Needed' : 'Ready' }}</strong>
          </div>
        </section>

        <section class="ps-summary">
          <article>
            <span>Total Hours</span>
            <strong>{{ totalHours().toFixed(2) }}</strong>
          </article>
          <article>
            <span>Gross Pay</span>
            <strong>{{ totalGross() | currency:moneyCurrency() }}</strong>
          </article>
          <article>
            <span>Deductions</span>
            <strong>{{ totalDeductions() | currency:moneyCurrency() }}</strong>
          </article>
          <article class="ps-summary-net">
            <span>Net Pay</span>
            <strong>{{ totalNet() | currency:moneyCurrency() }}</strong>
          </article>
          <article class="ps-summary-net">
            <span>Net Pay YTD</span>
            <strong>{{ ytdNetPay | currency:moneyCurrency() }}</strong>
          </article>
        </section>

        <section class="ps-two">
          <article class="ps-box">
            <h2>Earnings</h2>
            <div class="ps-line"><span>Regular hours</span><strong>{{ regularHours().toFixed(2) }} h</strong><em>{{ regularGross() | currency:moneyCurrency() }}</em></div>
            <div class="ps-line" *ngIf="overtimeHours() > 0"><span>Overtime hours ({{ overtimeMultiplierLabel() }})</span><strong>{{ overtimeHours().toFixed(2) }} h</strong><em>{{ overtimeGross() | currency:moneyCurrency() }}</em></div>
            <div class="ps-line" *ngIf="holidayWorkedHours() > 0"><span>Holiday-worked hours</span><strong>{{ holidayWorkedHours().toFixed(2) }} h</strong><em>{{ holidayWorkedGross() | currency:moneyCurrency() }}</em></div>
            <div class="ps-line" *ngIf="holidayOffHours() > 0"><span>Holiday pay</span><strong>{{ holidayOffHours().toFixed(2) }} h</strong><em>{{ holidayOffGross() | currency:moneyCurrency() }}</em></div>
            <div class="ps-line" *ngIf="leaveHours() > 0"><span>Paid time off</span><strong>{{ leaveHours().toFixed(2) }} h</strong><em>{{ leaveGross() | currency:moneyCurrency() }}</em></div>
            <div class="ps-line ps-line-total"><span>Total gross</span><strong>{{ totalHours().toFixed(2) }} h</strong><em>{{ totalGross() | currency:moneyCurrency() }}</em></div>
          </article>

          <article class="ps-box">
            <h2>Deductions <span class="ps-box-hint">({{ taxLabel() }})</span></h2>
            <div class="ps-line"><span>Federal tax</span><strong></strong><em>{{ deductionBreakdown()?.federalTax ?? 0 | currency:moneyCurrency() }}</em></div>
            <div class="ps-line"><span>State tax</span><strong></strong><em>{{ deductionBreakdown()?.stateTax ?? 0 | currency:moneyCurrency() }}</em></div>
            <div class="ps-line"><span>Social Security</span><strong></strong><em>{{ deductionBreakdown()?.socialSecurity ?? 0 | currency:moneyCurrency() }}</em></div>
            <div class="ps-line"><span>Medicare</span><strong></strong><em>{{ deductionBreakdown()?.medicare ?? 0 | currency:moneyCurrency() }}</em></div>
            <div class="ps-line" *ngIf="(deductionBreakdown()?.retirement401k ?? 0) > 0"><span>401(k){{ retirement401kProvider() ? ' — ' + retirement401kProvider() : '' }}</span><strong></strong><em>{{ deductionBreakdown()?.retirement401k ?? 0 | currency:moneyCurrency() }}</em></div>
            <div class="ps-line" *ngFor="let b of deductionBreakdown()?.benefitLines ?? []"><span>{{ b.label }}{{ b.provider ? ' — ' + b.provider : '' }}</span><strong></strong><em>{{ b.amount | currency:moneyCurrency() }}</em></div>
            <div class="ps-line ps-line-total"><span>Total deductions</span><strong></strong><em>{{ totalDeductions() | currency:moneyCurrency() }}</em></div>
          </article>
        </section>

        <section class="ps-box ps-employer" *ngIf="(deductionBreakdown()?.employerContributionsTotal ?? 0) > 0">
          <h2>Employer Contributions</h2>
          <div class="ps-line" *ngIf="(deductionBreakdown()?.employer401kMatch ?? 0) > 0"><span>401(k) match{{ retirement401kProvider() ? ' — ' + retirement401kProvider() : '' }}</span><strong></strong><em>{{ deductionBreakdown()?.employer401kMatch ?? 0 | currency:moneyCurrency() }}</em></div>
          <div class="ps-line" *ngFor="let b of deductionBreakdown()?.employerBenefitLines ?? []"><span>{{ b.label }}{{ b.provider ? ' — ' + b.provider : '' }}</span><strong></strong><em>{{ b.amount | currency:moneyCurrency() }}</em></div>
          <div class="ps-line ps-line-total"><span>Total employer contributions</span><strong></strong><em>{{ deductionBreakdown()?.employerContributionsTotal ?? 0 | currency:moneyCurrency() }}</em></div>
        </section>

        <section class="ps-box">
          <h2>Timecard Detail</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Shift</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Hours</th>
                <th>Rate</th>
                <th>Gross</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngIf="rows().length === 0">
                <td colspan="8">No payroll rows for this pay period.</td>
              </tr>
              <tr *ngFor="let r of rows()">
                <td>{{ r.date }}</td>
                <td>{{ r.shiftTitle }}</td>
                <td>{{ r.checkIn }}</td>
                <td>{{ r.checkOut }}</td>
                <td>{{ r.hours.toFixed(2) }}</td>
                <td>{{ r.rate | currency:moneyCurrency() }}</td>
                <td>{{ r.gross | currency:moneyCurrency() }}</td>
                <td>{{ r.status }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <footer class="ps-footer">
          <p>This payslip is generated by InnovaShift from scheduling, attendance, and payroll preview data. Final payroll should be approved by an authorized manager before external payment processing.</p>
          <div class="ps-signatures">
            <span>Employee acknowledgement</span>
            <span>Manager approval</span>
          </div>
        </footer>
      </section>
    </div>
  `,
  styles: [`
    .ps-page { min-height:100vh; background:#e5e7eb; padding:24px; color:#111827; }
    .ps-toolbar { max-width:980px; margin:0 auto 14px; display:flex; justify-content:space-between; gap:10px; }
    .ps-btn { height:40px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; color:#334155; display:inline-flex; align-items:center; gap:7px; padding:0 14px; font-weight:800; cursor:pointer; }
    .ps-btn-primary { border-color:#047857; background:#047857; color:#fff; }
    .ps-sheet { max-width:980px; margin:0 auto; background:#fff; border:1px solid #d1d5db; box-shadow:0 18px 40px rgba(15,23,42,.16); }
    .ps-header { padding:28px 32px; display:flex; justify-content:space-between; gap:24px; background:#07533f; color:#fff; }
    .ps-brand { font-size:12px; font-weight:900; letter-spacing:.12em; color:rgba(255,255,255,.75); }
    .ps-header h1 { margin:8px 0 4px; font-size:34px; }
    .ps-header p { margin:0; color:rgba(255,255,255,.78); }
    .ps-meta { min-width:240px; display:grid; grid-template-columns:1fr; gap:5px; text-align:right; }
    .ps-meta span { color:rgba(255,255,255,.72); font-size:11px; text-transform:uppercase; font-weight:800; }
    .ps-meta strong { color:#fff; }
    .ps-employee { display:grid; grid-template-columns:repeat(4,1fr); gap:0; border-bottom:1px solid #d1d5db; }
    .ps-employee div { padding:14px 16px; border-right:1px solid #e5e7eb; }
    .ps-employee span, .ps-summary span { display:block; color:#64748b; font-size:11px; text-transform:uppercase; font-weight:800; letter-spacing:.04em; }
    .ps-employee strong { display:block; margin-top:5px; color:#0f172a; font-size:13px; }
    .ps-summary { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; padding:18px 24px; background:#f8fafc; border-bottom:1px solid #d1d5db; }
    .ps-summary article { background:#fff; border:1px solid #e5e7eb; border-radius:6px; padding:14px; }
    .ps-summary strong { display:block; margin-top:8px; color:#0f172a; font-size:24px; }
    .ps-summary-net { background:#ecfdf5 !important; border-color:#a7f3d0 !important; }
    .ps-summary-net strong { color:#047857 !important; }
    @media (max-width:900px) { .ps-summary { grid-template-columns:repeat(2,1fr); } }
    .ps-two { display:grid; grid-template-columns:1fr 1fr; gap:18px; padding:22px 24px 0; }
    .ps-box { margin:0 24px 22px; border:1px solid #d1d5db; border-radius:6px; overflow:hidden; }
    .ps-two .ps-box { margin:0; }
    .ps-box h2 { margin:0; padding:12px 14px; background:#eef3ef; color:#0f172a; font-size:15px; border-bottom:1px solid #d1d5db; }
    .ps-box-hint { font-size:11px; font-weight:600; color:#64748b; text-transform:none; letter-spacing:0; }
    .ps-employer { margin:0 24px 22px; }
    .ps-line { display:grid; grid-template-columns:1fr 90px 100px; gap:10px; padding:11px 14px; border-bottom:1px solid #e5e7eb; color:#475569; font-size:13px; }
    .ps-line strong, .ps-line em { color:#0f172a; font-style:normal; text-align:right; }
    .ps-line-total { background:#ecfdf5; font-weight:900; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th { background:#f8fafc; color:#334155; text-align:left; padding:9px 8px; border-bottom:1px solid #d1d5db; text-transform:uppercase; font-size:10px; letter-spacing:.05em; }
    td { padding:9px 8px; border-bottom:1px solid #e5e7eb; color:#111827; }
    tr:nth-child(even) td { background:#fafafa; }
    .ps-footer { padding:18px 24px 24px; color:#64748b; font-size:11px; line-height:1.45; }
    .ps-signatures { display:grid; grid-template-columns:1fr 1fr; gap:38px; margin-top:34px; }
    .ps-signatures span { border-top:1px solid #94a3b8; padding-top:7px; color:#334155; }
    @media (max-width:760px) { .ps-page { padding:10px; } .ps-header, .ps-toolbar { flex-direction:column; } .ps-meta { text-align:left; } .ps-employee, .ps-summary, .ps-two { grid-template-columns:1fr; } }
    @media print {
      @page { size: Letter; margin: 0.45in; }
      .no-print { display:none !important; }
      .ps-page { padding:0; background:#fff; min-height:0; }
      .ps-sheet { max-width:none; border:0; box-shadow:none; }
      .ps-header { print-color-adjust:exact; -webkit-print-color-adjust:exact; }
      .ps-summary article, .ps-box { break-inside:avoid; }
      body { background:#fff !important; }
    }
  `]
})
export class PayslipPrintPage implements OnDestroy {
  orgId: string | null = null;
  targetUid: string | null = null;
  orgName = '';
  fromDate = '';
  toDate = '';
  generatedAt = new Date().toLocaleString();
  users = signal<OrgUser[]>([]);
  entries = signal<TimeEntry[]>([]);
  leaveRequests = signal<TimeOffRequest[]>([]);
  shiftMap = signal<Record<string, Shift>>({});
  rows = signal<Array<{ date: string; shiftTitle: string; checkIn: string; checkOut: string; hours: number; rate: number; gross: number; status: string }>>([]);
  isStandalonePrint = false;
  private autoPrintArmed = false;
  private autoPrintDone = false;
  private unsubUsers: (() => void) | null = null;
  private unsubEntries: (() => void) | null = null;
  private unsubLeave: (() => void) | null = null;
  private ctxEffect: EffectRef;

  private orgDefaultPayRate = 0;
  private overtimePolicy: OvertimePolicy = DEFAULT_OVERTIME_POLICY;
  private holidayWorkMultiplier = 1.5;
  private holidays: OrgHoliday[] = [];
  private breakdown: EmployeeGrossBreakdown | null = null;
  private holidayAwards: Array<{ holiday: OrgHoliday; hours: number; rate: number; gross: number }> = [];
  private orgDeductionDefaults: DeductionElections = DEFAULT_DEDUCTION_ELECTIONS;
  private _deductionBreakdown: DeductionBreakdown | null = null;
  private _resolvedElections: DeductionElections | null = null;
  private unsubYtdEntries: (() => void) | null = null;
  private ytdEntries = signal<TimeEntry[]>([]);
  private ytdShiftMap = signal<Record<string, Shift>>({});
  ytdNetPay = 0;

  constructor(
    private ctx: OrgContextService,
    private route: ActivatedRoute,
    private router: Router,
    private timeRepo: TimeEntriesRepo,
    private shiftsRepo: ShiftsRepo,
    private usersRepo: UsersRepo,
    private accruals: AccrualsRepo,
  ) {
    const period = currentPayrollPeriod();
    this.fromDate = this.route.snapshot.queryParamMap.get('from') || dateInputValue(period.start);
    this.toDate = this.route.snapshot.queryParamMap.get('to') || dateInputValue(period.end);
    this.isStandalonePrint = this.router.url.startsWith('/print/');
    this.autoPrintArmed = this.route.snapshot.queryParamMap.get('print') === '1';
    this.ctxEffect = effect(() => {
      this.orgId = this.ctx.orgId();
      const isAdminRoute = this.router.url.startsWith('/admin/');
      this.targetUid = isAdminRoute
        ? (this.route.snapshot.queryParamMap.get('uid') || this.ctx.uid())
        : this.ctx.uid();
      void this.loadOrgSettings();
      this.bind();
    });
  }

  private async loadOrgSettings() {
    if (!this.orgId) return;
    const snap = await getDoc(doc(getFirestore(), `orgs/${this.orgId}`)).catch(() => null);
    const data: any = snap?.exists() ? snap.data() : {};
    this.orgName = String(data?.name || this.orgId || '').trim();
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
    this.recomputeRows();
  }

  private employeeRate(): number {
    const user: any = this.users().find((u) => u.uid === this.targetUid);
    return Number(user?.payroll?.payRate ?? user?.payRate ?? this.orgDefaultPayRate ?? 0);
  }

  private employeeDeductionOverrides(): DeductionOverrides {
    const user: any = this.users().find((u) => u.uid === this.targetUid);
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

  deductionBreakdown(): DeductionBreakdown | null {
    return this._deductionBreakdown;
  }

  private bind() {
    this.unsubEntries?.();
    this.unsubLeave?.();
    this.rows.set([]);
    if (!this.orgId || !this.targetUid || !this.fromDate || !this.toDate) return;
    if (!this.unsubUsers) {
      this.unsubUsers = this.usersRepo.watchOrgUsers(this.orgId, (items) => this.users.set(items));
    }
    const start = Timestamp.fromDate(new Date(`${this.fromDate}T00:00:00`));
    const end = Timestamp.fromDate(new Date(`${this.toDate}T23:59:59`));
    this.unsubEntries = this.timeRepo.watchEntriesRange(this.orgId, this.targetUid, start, end, async (items) => {
      this.entries.set(items);
      const shiftIds = Array.from(new Set(items.map((e) => e.shiftId))).filter(Boolean);
      this.shiftMap.set(shiftIds.length ? await this.shiftsRepo.getManyByIds(this.orgId!, shiftIds) : {});
      this.recomputeRows();
    });
    this.unsubLeave = this.accruals.watchRequests(this.orgId, this.targetUid, (items) => {
      this.leaveRequests.set(items);
      this.recomputeRows();
      this.recomputeYtd();
    });

    this.unsubYtdEntries?.();
    const yearStart = Timestamp.fromDate(new Date(`${this.fromDate.slice(0, 4)}-01-01T00:00:00`));
    this.unsubYtdEntries = this.timeRepo.watchEntriesRange(this.orgId, this.targetUid, yearStart, end, async (items) => {
      this.ytdEntries.set(items);
      const shiftIds = Array.from(new Set(items.map((e) => e.shiftId))).filter(Boolean);
      this.ytdShiftMap.set(shiftIds.length ? await this.shiftsRepo.getManyByIds(this.orgId!, shiftIds) : {});
      this.recomputeYtd();
    });
  }

  /**
   * Re-runs the same gross/leave/holiday calculation over [Jan 1 of the
   * period's year, periodEnd] instead of just the selected period, purely to
   * show "Net Pay YTD" — a much wider data window than the printed period.
   */
  private recomputeYtd() {
    const holidayDates = new Set(this.holidays.map((h) => h.date));
    const ytdBreakdown = computeEmployeeGross(this.ytdEntries(), this.ytdShiftMap(), this.orgDefaultPayRate, this.overtimePolicy, holidayDates, this.holidayWorkMultiplier);

    const yearStart = `${this.fromDate.slice(0, 4)}-01-01`;
    let ytdGross = ytdBreakdown.gross;
    for (const request of this.leaveRequests()) {
      if (request.status !== 'approved' || request.requestType === 'unpaid' || request.paid === false) continue;
      ytdGross += payrollLeaveGross(request, yearStart, this.toDate);
    }

    const workedDates = workedDateSet(this.ytdEntries());
    const rate = this.employeeRate();
    for (const holiday of this.holidays.filter((h) => h.date >= yearStart && h.date <= this.toDate)) {
      ytdGross += payrollHolidayOffGross(holiday, rate, workedDates);
    }

    const elections = resolveDeductionElections(this.orgDeductionDefaults, this.employeeDeductionOverrides());
    this.ytdNetPay = computeDeductions(ytdGross, elections).netPay;
  }

  private static readonly LINE_TYPE_SUFFIX: Record<string, string> = {
    overtime: ' (Overtime)',
    holiday_worked: ' (Holiday)',
    regular: '',
  };

  private recomputeRows() {
    const holidayDates = new Set(this.holidays.map((h) => h.date));
    this.breakdown = computeEmployeeGross(this.entries(), this.shiftMap(), this.orgDefaultPayRate, this.overtimePolicy, holidayDates, this.holidayWorkMultiplier);

    const worked = this.breakdown.lines.map((line) => ({
      date: line.date,
      shiftTitle: `${line.shiftTitle}${PayslipPrintPage.LINE_TYPE_SUFFIX[line.type] || ''}`,
      checkIn: formatDateTime(line.checkInAt),
      checkOut: line.checkOutAt ? formatDateTime(line.checkOutAt) : 'Open',
      hours: line.hours,
      rate: line.rate,
      gross: line.gross,
      status: line.status,
    }));

    const leave = this.leaveRequests().filter((request) => this.isPayrollLeave(request)).map((request) => this.leaveToRow(request));

    this.holidayAwards = [];
    const holidaysInPeriod = this.holidays.filter((h) => h.date >= this.fromDate && h.date <= this.toDate);
    const holidayOff: Array<{ date: string; shiftTitle: string; checkIn: string; checkOut: string; hours: number; rate: number; gross: number; status: string }> = [];
    if (holidaysInPeriod.length > 0) {
      const workedDates = workedDateSet(this.entries());
      const rate = this.employeeRate();
      for (const holiday of holidaysInPeriod) {
        const hours = payrollHolidayOffHours(holiday, workedDates);
        if (hours <= 0) continue;
        const gross = payrollHolidayOffGross(holiday, rate, workedDates);
        this.holidayAwards.push({ holiday, hours, rate, gross });
        holidayOff.push({ date: holiday.date, shiftTitle: `${holiday.name} (Holiday Pay)`, checkIn: holiday.date, checkOut: '-', hours, rate, gross, status: 'holiday pay' });
      }
    }

    this.rows.set([...worked, ...leave, ...holidayOff].sort((a, b) => a.date.localeCompare(b.date)));

    const periodGross = [...worked, ...leave, ...holidayOff].reduce((sum, r) => sum + r.gross, 0);
    const elections = resolveDeductionElections(this.orgDeductionDefaults, this.employeeDeductionOverrides());
    this._resolvedElections = elections;
    this._deductionBreakdown = computeDeductions(periodGross, elections);

    this.setDocumentTitle();
    this.tryAutoPrint();
  }

  private setDocumentTitle() {
    const employee = this.employeeName().replace(/[^a-zA-Z0-9._-]+/g, '-');
    document.title = `InnovaShift_Payslip_${employee}_${this.fromDate}_to_${this.toDate}`;
  }

  private tryAutoPrint() {
    if (!this.autoPrintArmed || this.autoPrintDone) return;
    this.autoPrintDone = true;
    setTimeout(() => window.print(), 350);
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
      gross: payrollLeaveGross(request, this.fromDate, this.toDate),
      status: 'approved leave',
    };
  }

  private isPayrollLeave(request: TimeOffRequest): boolean {
    if (request.status !== 'approved') return false;
    if (request.requestType === 'unpaid') return false;
    if (request.paid === false) return false;
    return payrollLeaveHours(request, this.fromDate, this.toDate) > 0;
  }

  employeeName(): string {
    const user = this.users().find((u) => u.uid === this.targetUid);
    return user?.displayName || user?.email || this.ctx.displayName() || this.ctx.email() || 'Employee';
  }

  employeeNumber(): string {
    const user: any = this.users().find((u) => u.uid === this.targetUid);
    return user?.employeeNumber || user?.profile?.employeeNumber || 'Not assigned';
  }

  totalHours() { return this.rows().reduce((sum, r) => sum + r.hours, 0); }
  totalGross() { return Math.round(this.rows().reduce((sum, r) => sum + r.gross, 0) * 100) / 100; }
  totalDeductions() { return this._deductionBreakdown?.totalDeductions ?? 0; }
  totalNet() { return this._deductionBreakdown?.netPay ?? 0; }
  private linesByType(type: 'regular' | 'overtime' | 'holiday_worked') {
    return (this.breakdown?.lines ?? []).filter((l) => l.type === type);
  }
  regularHours() { return this.breakdown?.regularHours ?? 0; }
  regularGross() { return Math.round(this.linesByType('regular').reduce((sum, l) => sum + l.gross, 0) * 100) / 100; }
  overtimeHours() { return this.breakdown?.overtimeHours ?? 0; }
  overtimeGross() { return Math.round(this.linesByType('overtime').reduce((sum, l) => sum + l.gross, 0) * 100) / 100; }
  holidayWorkedHours() { return this.breakdown?.holidayWorkedHours ?? 0; }
  holidayWorkedGross() { return Math.round(this.linesByType('holiday_worked').reduce((sum, l) => sum + l.gross, 0) * 100) / 100; }
  holidayOffHours() { return this.holidayAwards.reduce((sum, a) => sum + a.hours, 0); }
  holidayOffGross() { return Math.round(this.holidayAwards.reduce((sum, a) => sum + a.gross, 0) * 100) / 100; }
  leaveHours() { return this.rows().filter((r) => r.status === 'approved leave').reduce((sum, r) => sum + r.hours, 0); }
  leaveGross() { return Math.round(this.rows().filter((r) => r.status === 'approved leave').reduce((sum, r) => sum + r.gross, 0) * 100) / 100; }
  overtimeMultiplierLabel() { return `${this.overtimePolicy.multiplier}x`; }
  retirement401kProvider() { return this._resolvedElections?.retirement401kProvider || ''; }
  exceptionCount() { return this.rows().filter((r) => r.status !== 'none' && r.status !== 'approved leave' && r.status !== 'holiday pay').length; }
  moneyCurrency() { return this.ctx.currencyCode() || 'USD'; }
  taxLabel() { return this.ctx.taxProfile() === 'manual' ? 'External' : 'Est.'; }

  printPdf() {
    window.print();
  }

  back() {
    if (this.isStandalonePrint) {
      window.close();
      return;
    }
    const isAdminRoute = this.router.url.startsWith('/admin/');
    void this.router.navigateByUrl(isAdminRoute ? '/admin/payroll' : '/app/payroll');
  }

  ngOnDestroy() {
    this.unsubUsers?.();
    this.unsubEntries?.();
    this.unsubLeave?.();
    this.unsubYtdEntries?.();
    this.ctxEffect.destroy();
  }
}
