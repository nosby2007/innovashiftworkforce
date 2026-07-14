import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Timestamp, collection, doc, getDoc, getDocs, getFirestore, limit, orderBy, query, where } from 'firebase/firestore';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { UsersRepo, OrgUser } from '../../core/repos/users.repo';
import { TimeOffRequest } from '../../core/repos/accruals.repo';
import { TimeEntry } from '../../shared/models/time-entry.model';
import { Shift } from '../../shared/models/shift.model';
import { formatDateTime } from '../../shared/utils/date.util';
import { payrollDeductions, payrollGross, payrollHours, payrollNet, payrollRate } from '../../shared/utils/payroll.util';

type SlipRow = { date: string; shiftTitle: string; checkIn: string; checkOut: string; hours: number; rate: number; gross: number; status: string };
type Slip = {
  uid: string;
  employeeName: string;
  employeeNumber: string;
  rows: SlipRow[];
  totalHours: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  exceptionCount: number;
};

@Component({
  standalone: true,
  imports: [CommonModule, CurrencyPipe],
  template: `
    <div class="bp-page">
      <div class="bp-toolbar no-print">
        <div>
          <div class="bp-kicker">InnovaShift</div>
          <h1>Batch Payslip Print</h1>
        </div>
        <div class="bp-actions">
          <button class="bp-btn bp-btn-secondary" type="button" (click)="closeWindow()">Close</button>
          <button class="bp-btn" type="button" (click)="print()">Print / Save PDF</button>
        </div>
      </div>

      <section class="bp-sheet" *ngFor="let slip of slips(); let i = index" [class.bp-sheet-break]="i > 0">
        <header class="bp-header">
          <div>
            <div class="bp-brand">{{ orgName || 'INNOVASHIFT' }}</div>
            <h2>Pay Slip</h2>
            <p>Batch payroll statement</p>
          </div>
          <div class="bp-meta">
            <span>Pay period</span>
            <strong>{{ fromDate }} to {{ toDate }}</strong>
            <span>Generated</span>
            <strong>{{ generatedAt }}</strong>
          </div>
        </header>

        <section class="bp-employee">
          <div><span>Employee</span><strong>{{ slip.employeeName }}</strong></div>
          <div><span>Employee ID</span><strong>{{ slip.employeeNumber }}</strong></div>
          <div><span>Organization</span><strong>{{ orgName || orgId || '-' }}</strong></div>
          <div><span>Status</span><strong>{{ slip.exceptionCount > 0 ? 'Review Needed' : 'Ready' }}</strong></div>
        </section>

        <section class="bp-summary">
          <article><span>Total Hours</span><strong>{{ slip.totalHours.toFixed(2) }}</strong></article>
          <article><span>Gross Pay</span><strong>{{ slip.totalGross | currency:moneyCurrency() }}</strong></article>
          <article><span>Deductions</span><strong>{{ slip.totalDeductions | currency:moneyCurrency() }}</strong></article>
          <article><span>Net Pay</span><strong>{{ slip.totalNet | currency:moneyCurrency() }}</strong></article>
        </section>

        <section class="bp-box">
          <h3>Timecard Detail</h3>
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
              <tr *ngFor="let row of slip.rows">
                <td>{{ row.date }}</td>
                <td>{{ row.shiftTitle }}</td>
                <td>{{ row.checkIn }}</td>
                <td>{{ row.checkOut }}</td>
                <td>{{ row.hours.toFixed(2) }}</td>
                <td>{{ row.rate | currency:moneyCurrency() }}</td>
                <td>{{ row.gross | currency:moneyCurrency() }}</td>
                <td>{{ row.status }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>
    </div>
  `,
  styles: [`
    .bp-page { min-height:100vh; background:#e5e7eb; color:#111827; padding:22px; }
    .bp-toolbar { max-width:980px; margin:0 auto 14px; display:flex; justify-content:space-between; gap:12px; align-items:center; }
    .bp-kicker { color:#64748b; font-size:11px; text-transform:uppercase; letter-spacing:.12em; font-weight:900; }
    .bp-toolbar h1 { margin:6px 0 0; font-size:28px; color:#0f172a; }
    .bp-actions { display:flex; gap:8px; }
    .bp-btn { height:40px; padding:0 14px; border-radius:6px; border:1px solid #0f766e; background:#0f766e; color:#fff; font-weight:800; cursor:pointer; }
    .bp-btn-secondary { border-color:#cbd5e1; background:#fff; color:#334155; }
    .bp-sheet { max-width:980px; margin:0 auto 18px; background:#fff; border:1px solid #d1d5db; box-shadow:0 18px 40px rgba(15,23,42,.15); }
    .bp-sheet-break { break-before: page; }
    .bp-header { padding:24px 28px; display:flex; justify-content:space-between; gap:18px; background:#07533f; color:#fff; }
    .bp-brand { font-size:12px; font-weight:900; letter-spacing:.12em; color:rgba(255,255,255,.75); }
    .bp-header h2 { margin:8px 0 6px; font-size:32px; }
    .bp-header p { margin:0; color:rgba(255,255,255,.78); }
    .bp-meta { min-width:240px; display:grid; gap:4px; text-align:right; }
    .bp-meta span { color:rgba(255,255,255,.72); font-size:11px; text-transform:uppercase; font-weight:800; }
    .bp-employee { display:grid; grid-template-columns:repeat(4,1fr); border-bottom:1px solid #d1d5db; }
    .bp-employee div { padding:14px 16px; border-right:1px solid #e5e7eb; }
    .bp-employee span, .bp-summary span { display:block; color:#64748b; font-size:11px; text-transform:uppercase; font-weight:800; }
    .bp-employee strong { display:block; margin-top:5px; color:#0f172a; font-size:13px; }
    .bp-summary { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; padding:18px 24px; background:#f8fafc; border-bottom:1px solid #d1d5db; }
    .bp-summary article { background:#fff; border:1px solid #e5e7eb; border-radius:6px; padding:14px; }
    .bp-summary strong { display:block; margin-top:8px; color:#0f172a; font-size:24px; }
    .bp-box { margin:22px 24px; border:1px solid #d1d5db; border-radius:6px; overflow:hidden; break-inside:avoid; }
    .bp-box h3 { margin:0; padding:12px 14px; background:#eef3ef; color:#0f172a; font-size:15px; border-bottom:1px solid #d1d5db; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th { background:#f8fafc; color:#334155; text-align:left; padding:9px 8px; border-bottom:1px solid #d1d5db; text-transform:uppercase; font-size:10px; letter-spacing:.05em; }
    td { padding:9px 8px; border-bottom:1px solid #e5e7eb; color:#111827; }
    tr:nth-child(even) td { background:#fafafa; }
    @media print {
      @page { size: Letter; margin: 0.45in; }
      .no-print { display:none !important; }
      .bp-page { padding:0; background:#fff; min-height:0; }
      .bp-sheet { max-width:none; border:0; box-shadow:none; margin:0; }
      .bp-header { print-color-adjust:exact; -webkit-print-color-adjust:exact; }
      body { background:#fff !important; }
    }
  `]
})
export class AdminPayrollBatchPrintPage implements OnDestroy {
  orgId: string | null = null;
  orgName = '';
  fromDate = '';
  toDate = '';
  generatedAt = new Date().toLocaleString();
  slips = signal<Slip[]>([]);
  private autoPrintArmed = false;
  private autoPrintDone = false;
  private unsubUsers: (() => void) | null = null;
  private users: OrgUser[] = [];

  constructor(
    private route: ActivatedRoute,
    private ctx: OrgContextService,
    private shiftsRepo: ShiftsRepo,
    private usersRepo: UsersRepo,
  ) {
    this.orgId = this.ctx.orgId();
    this.fromDate = this.route.snapshot.queryParamMap.get('from') || '';
    this.toDate = this.route.snapshot.queryParamMap.get('to') || '';
    this.autoPrintArmed = this.route.snapshot.queryParamMap.get('print') === '1';
    this.load();
  }

  private async load() {
    if (!this.orgId || !this.fromDate || !this.toDate) return;
    await this.loadOrgName();
    const uidList = (this.route.snapshot.queryParamMap.get('uids') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!uidList.length) return;

    this.users = await this.loadUsers();
    const start = Timestamp.fromDate(new Date(`${this.fromDate}T00:00:00`));
    const end = Timestamp.fromDate(new Date(`${this.toDate}T23:59:59`));
    const allEntries = await this.loadEntries(start, end);
    const shiftIds = Array.from(new Set(allEntries.map((entry) => entry.shiftId))).filter(Boolean);
    const shiftMap = shiftIds.length ? await this.shiftsRepo.getManyByIds(this.orgId, shiftIds) : {};
    const leaveRequests = await this.loadLeaveRequests();

    this.slips.set(uidList.map((uid) => {
      const rows: SlipRow[] = [];
      const entries = allEntries.filter((entry) => entry.userId === uid);
      for (const entry of entries) {
        const shift = shiftMap[entry.shiftId];
        const hours = payrollHours(entry);
        const rate = payrollRate(entry, shift);
        rows.push({
          date: formatDateTime(entry.checkInAt).split(',')[0] || '-',
          shiftTitle: shift?.title || 'Assigned shift',
          checkIn: formatDateTime(entry.checkInAt),
          checkOut: entry.checkOutAt ? formatDateTime(entry.checkOutAt) : 'Open',
          hours,
          rate,
          gross: payrollGross(entry, shift),
          status: entry.exceptionStatus || 'none',
        });
      }
      for (const request of leaveRequests.filter((request) => this.isPayrollLeave(request, uid))) {
        const hours = Number(request.hours || 0);
        const rate = Number(request.payRate || 0);
        rows.push({
          date: request.startDate || '-',
          shiftTitle: `${request.requestType.toUpperCase()} approved leave`,
          checkIn: request.startDate || '-',
          checkOut: request.endDate || request.startDate || '-',
          hours,
          rate,
          gross: Math.round(hours * rate * 100) / 100,
          status: 'approved leave',
        });
      }
      rows.sort((a, b) => a.date.localeCompare(b.date));
      const totalHours = rows.reduce((sum, row) => sum + row.hours, 0);
      const totalGross = Math.round(rows.reduce((sum, row) => sum + row.gross, 0) * 100) / 100;
      const totalDeductions = payrollDeductions(totalGross);
      const totalNet = payrollNet(totalGross);
      const exceptionCount = rows.filter((row) => row.status !== 'none').length;
      const user: any = this.users.find((item) => item.uid === uid);
      return {
        uid,
        employeeName: user?.displayName || user?.email || 'Staff member',
        employeeNumber: user?.employeeNumber || user?.profile?.employeeNumber || 'Not assigned',
        rows,
        totalHours,
        totalGross,
        totalDeductions,
        totalNet,
        exceptionCount,
      };
    }));

    this.setDocumentTitle();
    this.tryAutoPrint();
  }

  private async loadUsers(): Promise<OrgUser[]> {
    return new Promise((resolve) => {
      this.unsubUsers?.();
      this.unsubUsers = this.usersRepo.watchOrgUsers(this.orgId!, (items) => {
        resolve(items);
        this.unsubUsers?.();
        this.unsubUsers = null;
      });
    });
  }

  private async loadEntries(start: Timestamp, end: Timestamp): Promise<TimeEntry[]> {
    const db = getFirestore();
    const col = collection(db, `orgs/${this.orgId}/timeEntries`);
    const q = query(
      col,
      where('checkInAt', '>=', start),
      where('checkInAt', '<=', end),
      orderBy('checkInAt', 'asc'),
      limit(5000),
    );
    const snap = await getDocs(q);
    return snap.docs.map((item) => ({ id: item.id, ...(item.data() as any) })) as TimeEntry[];
  }

  private async loadLeaveRequests(): Promise<TimeOffRequest[]> {
    const db = getFirestore();
    const col = collection(db, `orgs/${this.orgId}/requests`);
    const q = query(col, limit(500));
    const snap = await getDocs(q);
    return snap.docs
      .map((item) => ({ id: item.id, ...(item.data() as any) }) as TimeOffRequest)
      .filter((item) => String(item.type || '') === 'time_off');
  }

  private async loadOrgName() {
    if (!this.orgId) return;
    const snap = await getDoc(doc(getFirestore(), `orgs/${this.orgId}`)).catch(() => null);
    const data: any = snap?.exists() ? snap.data() : {};
    this.orgName = String(data?.name || this.orgId || '').trim();
  }

  private isPayrollLeave(request: TimeOffRequest, uid: string): boolean {
    if (request.userId !== uid) return false;
    if (request.status !== 'approved') return false;
    if (request.requestType === 'unpaid') return false;
    if (request.paid === false) return false;
    const start = request.startDate || '';
    const end = request.endDate || start;
    return start <= this.toDate && end >= this.fromDate;
  }

  private setDocumentTitle() {
    const label = this.slips().length === 1 ? this.slips()[0].employeeName : `${this.slips().length}-employees`;
    document.title = `InnovaShift_Payslips_${label}_${this.fromDate}_to_${this.toDate}`;
  }

  private tryAutoPrint() {
    if (!this.autoPrintArmed || this.autoPrintDone) return;
    this.autoPrintDone = true;
    setTimeout(() => window.print(), 350);
  }

  moneyCurrency() {
    return this.ctx.currencyCode() || 'USD';
  }

  print() { window.print(); }
  closeWindow() { window.close(); }

  ngOnDestroy() {
    this.unsubUsers?.();
  }
}
