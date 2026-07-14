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
import { currentPayrollPeriod, dateInputValue, payrollDeductions, payrollGross, payrollHours, payrollNet, payrollRate } from '../../shared/utils/payroll.util';

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
          <article>
            <span>Net Pay</span>
            <strong>{{ totalNet() | currency:moneyCurrency() }}</strong>
          </article>
        </section>

        <section class="ps-two">
          <article class="ps-box">
            <h2>Earnings</h2>
            <div class="ps-line"><span>Regular hours</span><strong>{{ totalHours().toFixed(2) }} h</strong><em>{{ totalGross() | currency:moneyCurrency() }}</em></div>
            <div class="ps-line"><span>Overtime hours</span><strong>{{ overtimeHours().toFixed(2) }} h</strong><em>{{ overtimeGross() | currency:moneyCurrency() }}</em></div>
            <div class="ps-line ps-line-total"><span>Total gross</span><strong></strong><em>{{ totalGross() | currency:moneyCurrency() }}</em></div>
          </article>

          <article class="ps-box">
            <h2>Deductions</h2>
            <div class="ps-line"><span>Estimated statutory deductions</span><strong>{{ taxLabel() }}</strong><em>{{ totalDeductions() | currency:moneyCurrency() }}</em></div>
            <div class="ps-line"><span>Other deductions</span><strong>-</strong><em>{{ 0 | currency:moneyCurrency() }}</em></div>
            <div class="ps-line ps-line-total"><span>Total deductions</span><strong></strong><em>{{ totalDeductions() | currency:moneyCurrency() }}</em></div>
          </article>
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
    .ps-summary { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; padding:18px 24px; background:#f8fafc; border-bottom:1px solid #d1d5db; }
    .ps-summary article { background:#fff; border:1px solid #e5e7eb; border-radius:6px; padding:14px; }
    .ps-summary strong { display:block; margin-top:8px; color:#0f172a; font-size:24px; }
    .ps-two { display:grid; grid-template-columns:1fr 1fr; gap:18px; padding:22px 24px 0; }
    .ps-box { margin:0 24px 22px; border:1px solid #d1d5db; border-radius:6px; overflow:hidden; }
    .ps-two .ps-box { margin:0; }
    .ps-box h2 { margin:0; padding:12px 14px; background:#eef3ef; color:#0f172a; font-size:15px; border-bottom:1px solid #d1d5db; }
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
      void this.loadOrgName();
      this.bind();
    });
  }

  private async loadOrgName() {
    if (!this.orgId) return;
    const snap = await getDoc(doc(getFirestore(), `orgs/${this.orgId}`)).catch(() => null);
    const data: any = snap?.exists() ? snap.data() : {};
    this.orgName = String(data?.name || this.orgId || '').trim();
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
    });
  }

  private recomputeRows() {
    const worked = this.entries().map((entry) => this.toRow(entry));
    const leave = this.leaveRequests().filter((request) => this.isPayrollLeave(request)).map((request) => this.leaveToRow(request));
    this.rows.set([...worked, ...leave].sort((a, b) => a.date.localeCompare(b.date)));
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

  private toRow(entry: TimeEntry) {
    const shift = this.shiftMap()[entry.shiftId];
    const hours = payrollHours(entry);
    const rate = payrollRate(entry, shift);
    return {
      date: formatDateTime(entry.checkInAt).split(',')[0] || '-',
      shiftTitle: shift?.title || 'Assigned shift',
      checkIn: formatDateTime(entry.checkInAt),
      checkOut: entry.checkOutAt ? formatDateTime(entry.checkOutAt) : 'Open',
      hours,
      rate,
      gross: payrollGross(entry, shift),
      status: entry.exceptionStatus || 'none',
    };
  }

  private leaveToRow(request: TimeOffRequest) {
    const hours = Number(request.hours || 0);
    const rate = Number(request.payRate || 0);
    return {
      date: request.startDate || '-',
      shiftTitle: `${request.requestType.toUpperCase()} approved leave`,
      checkIn: request.startDate,
      checkOut: request.endDate,
      hours,
      rate,
      gross: Math.round(hours * rate * 100) / 100,
      status: 'approved leave',
    };
  }

  private isPayrollLeave(request: TimeOffRequest): boolean {
    if (request.status !== 'approved') return false;
    if (request.requestType === 'unpaid') return false;
    if (request.paid === false) return false;
    const start = request.startDate || '';
    const end = request.endDate || start;
    return start <= this.toDate && end >= this.fromDate;
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
  totalDeductions() { return payrollDeductions(this.totalGross()); }
  totalNet() { return payrollNet(this.totalGross()); }
  overtimeHours() { return Math.max(0, this.totalHours() - 80); }
  overtimeGross() { return 0; }
  exceptionCount() { return this.rows().filter((r) => r.status !== 'none').length; }
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
    this.ctxEffect.destroy();
  }
}
