import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Timestamp, doc, getDoc, getFirestore } from 'firebase/firestore';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { UsersRepo, OrgUser } from '../../core/repos/users.repo';
import { AuditRepo, AuditLog } from '../../core/repos/audit.repo';
import { Shift } from '../../shared/models/shift.model';
import { formatDateTime, tsToDate } from '../../shared/utils/date.util';

@Component({
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sp-page">
      <div class="sp-toolbar no-print">
        <div>
          <div class="sp-kicker">InnovaShift</div>
          <h1>Schedule Details Print</h1>
        </div>
        <div class="sp-actions">
          <button class="sp-btn" type="button" (click)="closeWindow()">Close</button>
          <button class="sp-btn sp-btn-primary" type="button" (click)="print()">Print / Save PDF</button>
        </div>
      </div>

      <section class="sp-sheet">
        <header class="sp-header">
          <div>
            <div class="sp-brand">{{ orgName || 'INNOVASHIFT - SMART WORKFORCE MANAGEMENT' }}</div>
            <h2>Schedule Details</h2>
            <p>Printable schedule register for payroll, staffing, and audit review</p>
          </div>
          <div class="sp-meta">
            <span>Period</span>
            <strong>{{ fromDate }} to {{ endDate }}</strong>
            <span>Status View</span>
            <strong>{{ activeTab }}</strong>
            <span>Generated</span>
            <strong>{{ generatedAt }}</strong>
          </div>
        </header>

        <section class="sp-summary">
          <article>
            <span>Shifts Listed</span>
            <strong>{{ displayShifts().length }}</strong>
          </article>
          <article>
            <span>In Progress</span>
            <strong>{{ statusCount('in_progress') }}</strong>
          </article>
          <article>
            <span>Completed</span>
            <strong>{{ statusCount('completed') }}</strong>
          </article>
          <article>
            <span>Open / Published</span>
            <strong>{{ statusCount('open') + statusCount('published') }}</strong>
          </article>
        </section>

        <section class="sp-box">
          <h3>Shift Register</h3>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Date</th>
                <th>Time</th>
                <th>Status</th>
                <th>Location</th>
                <th>Assigned To</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngIf="displayShifts().length === 0">
                <td colspan="6">No shifts match the selected filters.</td>
              </tr>
              <tr *ngFor="let s of displayShifts()">
                <td>{{ s.title }}</td>
                <td>{{ toDate(s.startAt) | date:'EEE MMM d, y' }}</td>
                <td>{{ toDate(s.startAt) | date:'shortTime' }} - {{ toDate(s.endAt) | date:'shortTime' }}</td>
                <td>{{ s.status | uppercase }}</td>
                <td>{{ s.locationName || '-' }}</td>
                <td>{{ s.assignedUserId ? userLabel(s.assignedUserId) : '-' }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="sp-box">
          <h3>Audit Log</h3>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Action</th>
                <th>By</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngIf="auditRows().length === 0">
                <td colspan="4">No audit entries in this printable range.</td>
              </tr>
              <tr *ngFor="let a of auditRows()">
                <td>{{ fmtDate(a.createdAt) }}</td>
                <td>{{ a.action }}</td>
                <td>{{ auditActor(a) }}</td>
                <td>{{ auditTarget(a) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>
    </div>
  `,
  styles: [`
    .sp-page { min-height:100vh; background:#e5e7eb; color:#111827; padding:22px; }
    .sp-toolbar { max-width:1180px; margin:0 auto 14px; display:flex; align-items:center; justify-content:space-between; gap:14px; }
    .sp-kicker { font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:.12em; color:#64748b; }
    .sp-toolbar h1 { margin:6px 0 0; font-size:28px; color:#0f172a; }
    .sp-actions { display:flex; gap:8px; }
    .sp-btn { height:40px; padding:0 14px; border-radius:6px; border:1px solid #cbd5e1; background:#fff; color:#334155; font-weight:800; cursor:pointer; }
    .sp-btn-primary { border-color:#0f766e; background:#0f766e; color:#fff; }
    .sp-sheet { max-width:1180px; margin:0 auto; background:#fff; border:1px solid #d1d5db; box-shadow:0 18px 40px rgba(15,23,42,.15); }
    .sp-header { padding:24px 28px; display:flex; justify-content:space-between; gap:18px; background:#0f2f44; color:#fff; }
    .sp-brand { color:rgba(255,255,255,.72); font-size:11px; font-weight:900; letter-spacing:.12em; }
    .sp-header h2 { margin:8px 0 6px; font-size:32px; }
    .sp-header p { margin:0; color:rgba(255,255,255,.78); }
    .sp-meta { min-width:250px; display:grid; gap:4px; text-align:right; }
    .sp-meta span { color:rgba(255,255,255,.70); font-size:11px; font-weight:800; text-transform:uppercase; }
    .sp-summary { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; padding:18px 22px; background:#f8fafc; border-bottom:1px solid #d1d5db; }
    .sp-summary article { padding:14px; border:1px solid #e2e8f0; border-radius:6px; background:#fff; }
    .sp-summary span { display:block; font-size:11px; font-weight:800; color:#64748b; text-transform:uppercase; }
    .sp-summary strong { display:block; margin-top:8px; font-size:26px; color:#0f172a; }
    .sp-box { margin:22px; border:1px solid #d1d5db; border-radius:6px; overflow:hidden; break-inside:avoid; }
    .sp-box h3 { margin:0; padding:12px 14px; background:#eef3ef; color:#0f172a; font-size:15px; border-bottom:1px solid #d1d5db; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th { background:#f8fafc; color:#334155; text-align:left; padding:9px 8px; border-bottom:1px solid #d1d5db; text-transform:uppercase; font-size:10px; letter-spacing:.05em; }
    td { padding:9px 8px; border-bottom:1px solid #e5e7eb; color:#111827; vertical-align:top; }
    tr:nth-child(even) td { background:#fafafa; }
    @media (max-width:840px) { .sp-page { padding:10px; } .sp-toolbar, .sp-header { flex-direction:column; align-items:flex-start; } .sp-meta { text-align:left; min-width:0; } .sp-summary { grid-template-columns:1fr 1fr; } }
    @media print {
      @page { size: Letter landscape; margin: 0.4in; }
      .no-print { display:none !important; }
      .sp-page { padding:0; background:#fff; min-height:0; }
      .sp-sheet { max-width:none; border:0; box-shadow:none; }
      .sp-header { print-color-adjust:exact; -webkit-print-color-adjust:exact; }
      body { background:#fff !important; }
    }
  `]
})
export class AdminScheduleDetailsPrintPage implements OnDestroy {
  orgId: string | null = null;
  orgName = '';
  fromDate = '';
  endDate = '';
  activeTab = 'All';
  generatedAt = new Date().toLocaleString();
  users = signal<OrgUser[]>([]);
  displayShifts = signal<Shift[]>([]);
  auditRows = signal<AuditLog[]>([]);
  private statuses: string[] | null = null;
  private autoPrintArmed = false;
  private autoPrintDone = false;
  private unsubUsers: (() => void) | null = null;
  private unsubShifts: (() => void) | null = null;
  private unsubAudit: (() => void) | null = null;

  constructor(
    private route: ActivatedRoute,
    private ctx: OrgContextService,
    private shiftsRepo: ShiftsRepo,
    private usersRepo: UsersRepo,
    private auditRepo: AuditRepo,
  ) {
    this.orgId = this.ctx.orgId();
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    this.fromDate = this.route.snapshot.queryParamMap.get('from') || monday.toISOString().slice(0, 10);
    this.endDate = this.route.snapshot.queryParamMap.get('to') || sunday.toISOString().slice(0, 10);
    this.activeTab = this.route.snapshot.queryParamMap.get('tab') || 'All';
    const statusesRaw = this.route.snapshot.queryParamMap.get('statuses') || '';
    this.statuses = statusesRaw
      ? statusesRaw.split(',').map((value) => value.trim()).filter(Boolean)
      : null;
    this.autoPrintArmed = this.route.snapshot.queryParamMap.get('print') === '1';
    this.bind();
  }

  private bind() {
    if (!this.orgId) return;
    void this.loadOrgName();
    this.unsubUsers = this.usersRepo.watchOrgUsers(this.orgId, (items) => {
      this.users.set(items);
    });
    const startAt = Timestamp.fromDate(new Date(this.fromDate + 'T00:00:00'));
    const endAt = Timestamp.fromDate(new Date(this.endDate + 'T23:59:59'));
    this.unsubShifts = this.shiftsRepo.watchOrgRange(this.orgId, startAt, endAt, (items) => {
      const allowed = this.statuses ? new Set(this.statuses) : null;
      this.displayShifts.set(allowed ? items.filter((s) => allowed.has(s.status)) : items);
      this.tryAutoPrint();
    });
    this.unsubAudit = this.auditRepo.watchRecent(this.orgId, (items) => {
      this.auditRows.set(items.slice(0, 40));
    });
  }

  private async loadOrgName() {
    if (!this.orgId) return;
    const snap = await getDoc(doc(getFirestore(), `orgs/${this.orgId}`)).catch(() => null);
    const data: any = snap?.exists() ? snap.data() : {};
    this.orgName = String(data?.name || this.orgId || '').trim();
  }

  private tryAutoPrint() {
    if (!this.autoPrintArmed || this.autoPrintDone) return;
    document.title = `InnovaShift_Schedule_${this.activeTab.replace(/[^a-zA-Z0-9._-]+/g, '-')}_${this.fromDate}_to_${this.endDate}`;
    this.autoPrintDone = true;
    setTimeout(() => window.print(), 350);
  }

  statusCount(status: string) {
    return this.displayShifts().filter((shift) => shift.status === status).length;
  }

  userLabel(uid: string) {
    const user = this.users().find((item) => item.uid === uid);
    return user?.displayName || user?.email || 'Staff member';
  }

  toDate(value: any): Date {
    return tsToDate(value) || new Date();
  }

  fmtDate(ts: any): string {
    return formatDateTime(ts);
  }

  auditActor(a: AuditLog): string {
    return (a as any).actorName || (a as any).actorEmail || 'System or admin';
  }

  auditTarget(a: AuditLog): string {
    return (a as any).targetUserName || (a as any).documentTitle || a.target?.title || a.target?.name || 'Schedule record';
  }

  print() {
    window.print();
  }

  closeWindow() {
    window.close();
  }

  ngOnDestroy() {
    this.unsubUsers?.();
    this.unsubShifts?.();
    this.unsubAudit?.();
  }
}
