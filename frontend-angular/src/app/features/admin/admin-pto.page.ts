import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import { TranslocoModule } from '@jsverse/transloco';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { AccrualsRepo, TimeOffRequest, TimeOffStatus } from '../../core/repos/accruals.repo';
import { UsersRepo, OrgUser } from '../../core/repos/users.repo';
import { ToastService } from '../../core/ui/toast.service';

type RequestFilter = 'all' | TimeOffStatus;

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, MatIconModule, TranslocoModule],
  template: `
    <div class="pto-admin">
      <header class="pto-hero">
        <div>
          <div class="pto-kicker">{{ 'pto.kicker' | transloco }}</div>
          <h1>{{ 'pto.title' | transloco }}</h1>
          <p>{{ 'pto.heroSubtitle' | transloco }}</p>
        </div>
        <div class="pto-hero-stats">
          <article><span>{{ 'pto.pending' | transloco }}</span><strong>{{ statusCount('pending') }}</strong></article>
          <article><span>{{ 'pto.approved' | transloco }}</span><strong>{{ statusCount('approved') }}</strong></article>
          <article><span>{{ 'pto.payrollHours' | transloco }}</span><strong>{{ payrollLeaveHours().toFixed(2) }}</strong></article>
        </div>
      </header>

      <div *ngIf="!orgId" class="pto-alert">
        <mat-icon>warning_amber</mat-icon>
        {{ 'pto.missingOrgContext' | transloco }}
      </div>

      <section class="pto-tools" *ngIf="orgId">
        <label>
          <span>{{ 'pto.status' | transloco }}</span>
          <select [(ngModel)]="filter">
            <option value="all">{{ 'pto.statusAll' | transloco }}</option>
            <option value="pending">{{ 'pto.statusPending' | transloco }}</option>
            <option value="approved">{{ 'pto.statusApproved' | transloco }}</option>
            <option value="rejected">{{ 'pto.statusRejected' | transloco }}</option>
            <option value="cancelled">{{ 'pto.statusCancelled' | transloco }}</option>
          </select>
        </label>
        <label>
          <span>{{ 'pto.search' | transloco }}</span>
          <input [(ngModel)]="query" [placeholder]="'pto.searchPlaceholder' | transloco">
        </label>
        <label>
          <span>{{ 'pto.defaultPaidRate' | transloco: { currency: moneyCurrency() } }}</span>
          <input type="number" min="0" step="0.01" [(ngModel)]="defaultPayRate">
        </label>
      </section>

      <section class="pto-grid" *ngIf="orgId">
        <article class="pto-card">
          <div class="pto-card-head">
            <h2>{{ 'pto.requestQueue' | transloco }}</h2>
            <span>{{ 'pto.requestCount' | transloco: { count: filteredRequests().length } }}</span>
          </div>

          <div class="pto-empty" *ngIf="filteredRequests().length === 0">
            <mat-icon>inbox</mat-icon>
            {{ 'pto.noRequestsMatch' | transloco }}
          </div>

          <div class="pto-row" *ngFor="let r of filteredRequests()">
            <div class="pto-person">
              <div class="pto-avatar">{{ initials(r) }}</div>
              <div>
                <strong>{{ personLabel(r.userId) }}</strong>
                <span>{{ r.requestType | uppercase }} · {{ r.startDate }} to {{ r.endDate }}</span>
              </div>
            </div>

            <div class="pto-meta">
              <div><span>{{ 'pto.hours' | transloco }}</span><strong>{{ r.hours }}</strong></div>
              <div><span>{{ 'pto.status' | transloco }}</span><strong class="pto-status" [class.is-pending]="r.status === 'pending'" [class.is-approved]="r.status === 'approved'" [class.is-rejected]="r.status === 'rejected'">{{ r.status | titlecase }}</strong></div>
              <div><span>{{ 'pto.paid' | transloco }}</span><strong>{{ isPaidRequest(r) ? ('pto.yes' | transloco) : ('pto.no' | transloco) }}</strong></div>
            </div>

            <p class="pto-note" *ngIf="r.notes">{{ r.notes }}</p>
            <p class="pto-note" *ngIf="r.managerNote">{{ 'pto.managerNoteColon' | transloco }} {{ r.managerNote }}</p>

            <div class="pto-decision" *ngIf="r.status === 'pending'">
              <label>
                <span>{{ 'pto.paidRate' | transloco }}</span>
                <input type="number" min="0" step="0.01" [ngModel]="rateFor(r)" (ngModelChange)="setRate(r, $event)">
              </label>
              <label>
                <span>{{ 'pto.managerNoteLabel' | transloco }}</span>
                <input [ngModel]="noteFor(r)" (ngModelChange)="setNote(r, $event)" [placeholder]="'pto.managerNotePlaceholder' | transloco">
              </label>
              <div class="pto-actions">
                <button class="pto-btn" type="button" (click)="reject(r)" [disabled]="busyId === r.id">
                  <mat-icon>close</mat-icon>
                  {{ 'pto.reject' | transloco }}
                </button>
                <button class="pto-btn pto-btn-primary" type="button" (click)="approve(r)" [disabled]="busyId === r.id">
                  <mat-icon>check</mat-icon>
                  {{ 'pto.approveAttach' | transloco }}
                </button>
              </div>
            </div>
          </div>
        </article>

        <aside class="pto-card pto-policy">
          <div class="pto-card-head">
            <h2>{{ 'pto.payrollImpact' | transloco }}</h2>
            <mat-icon>payments</mat-icon>
          </div>
          <div class="pto-impact">
            <div>
              <span>{{ 'pto.approvedPaidHours' | transloco }}</span>
              <strong>{{ payrollLeaveHours().toFixed(2) }}</strong>
            </div>
            <div>
              <span>{{ 'pto.estimatedLeaveGross' | transloco }}</span>
              <strong>{{ payrollLeaveGross() | currency:moneyCurrency() }}</strong>
            </div>
            <div>
              <span>{{ 'pto.pendingLiability' | transloco }}</span>
              <strong>{{ pendingHours().toFixed(2) }} h</strong>
            </div>
          </div>
          <div class="pto-runbook">
            <strong>{{ 'pto.approvalRules' | transloco }}</strong>
            <span>{{ 'pto.rule1' | transloco }}</span>
            <span>{{ 'pto.rule2' | transloco }}</span>
            <span>{{ 'pto.rule3' | transloco }}</span>
          </div>
        </aside>
      </section>
    </div>
  `,
  styles: [`
    .pto-admin { color:#1f2937; }
    .pto-hero { min-height:150px; margin:-24px -22px 22px; padding:28px; display:flex; justify-content:space-between; align-items:end; gap:20px; background:#07533f; color:#fff; }
    .pto-kicker { color:rgba(255,255,255,.72); font-size:12px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; margin-bottom:8px; }
    .pto-hero h1 { margin:0; font-size:34px; font-weight:900; letter-spacing:0; }
    .pto-hero p { margin:8px 0 0; color:rgba(255,255,255,.82); max-width:720px; }
    .pto-hero-stats { display:grid; grid-template-columns:repeat(3, minmax(110px, 1fr)); gap:10px; min-width:390px; }
    .pto-hero-stats article { border:1px solid rgba(255,255,255,.22); border-radius:8px; padding:12px; background:rgba(255,255,255,.08); }
    .pto-hero-stats span { display:block; color:rgba(255,255,255,.72); font-size:11px; font-weight:900; text-transform:uppercase; }
    .pto-hero-stats strong { display:block; margin-top:6px; font-size:24px; color:#fff; }
    .pto-alert { display:flex; align-items:center; gap:10px; padding:14px 16px; background:#fff7ed; border:1px solid #fed7aa; color:#92400e; border-radius:8px; font-weight:900; }
    .pto-tools { display:grid; grid-template-columns:200px 1fr 220px; gap:12px; margin-bottom:16px; }
    .pto-tools label, .pto-decision label { display:grid; gap:6px; color:#475569; font-size:12px; font-weight:900; }
    .pto-tools input, .pto-tools select, .pto-decision input { width:100%; height:40px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; color:#111827; padding:0 10px; font:inherit; }
    .pto-grid { display:grid; grid-template-columns:minmax(0, 1fr) 360px; gap:16px; align-items:start; }
    .pto-card { border:1px solid rgba(15,23,42,.12); border-radius:8px; background:rgba(255,255,255,.96); box-shadow:0 12px 28px rgba(15,23,42,.07); overflow:hidden; }
    .pto-card-head { min-height:52px; padding:0 16px; display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:1px solid #e5e7eb; }
    .pto-card-head h2 { margin:0; font-size:16px; font-weight:900; }
    .pto-card-head span, .pto-card-head mat-icon { color:#64748b; }
    .pto-empty { min-height:120px; display:flex; align-items:center; justify-content:center; gap:8px; color:#64748b; font-weight:800; }
    .pto-row { padding:16px; border-bottom:1px solid #e5e7eb; display:grid; gap:12px; }
    .pto-person { display:flex; align-items:center; gap:12px; }
    .pto-avatar { width:38px; height:38px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:#e0f2fe; color:#075985; font-weight:900; }
    .pto-person strong { display:block; color:#0f172a; }
    .pto-person span { display:block; margin-top:3px; color:#64748b; font-size:12px; }
    .pto-meta { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px; }
    .pto-meta div { border:1px solid #e5e7eb; border-radius:6px; padding:10px; background:#f8fafc; }
    .pto-meta span { color:#64748b; font-size:11px; font-weight:900; text-transform:uppercase; }
    .pto-meta strong { display:block; margin-top:5px; color:#0f172a; }
    .pto-status { display:inline-flex !important; width:max-content; border-radius:999px; padding:4px 8px; background:#f1f5f9; }
    .pto-status.is-pending { background:#fffbeb; color:#92400e; }
    .pto-status.is-approved { background:#ecfdf5; color:#047857; }
    .pto-status.is-rejected { background:#fef2f2; color:#b91c1c; }
    .pto-note { margin:0; padding:10px 12px; border-left:3px solid #cbd5e1; background:#f8fafc; color:#475569; font-size:13px; }
    .pto-decision { display:grid; grid-template-columns:160px 1fr auto; gap:10px; align-items:end; }
    .pto-actions { display:flex; gap:8px; flex-wrap:wrap; }
    .pto-btn { height:40px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; color:#334155; display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:0 12px; font-weight:900; cursor:pointer; }
    .pto-btn-primary { border-color:#047857; background:#047857; color:#fff; }
    .pto-btn:disabled { opacity:.6; cursor:not-allowed; }
    .pto-impact { display:grid; gap:0; }
    .pto-impact div { display:flex; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid #e5e7eb; }
    .pto-impact span { color:#64748b; }
    .pto-impact strong { color:#0f172a; }
    .pto-runbook { padding:16px; display:grid; gap:8px; color:#475569; font-size:13px; line-height:1.4; }
    .pto-runbook strong { color:#0f172a; }
    @media (max-width:980px) {
      .pto-hero { margin:-14px -12px 18px; padding:22px 16px; align-items:flex-start; flex-direction:column; }
      .pto-hero-stats, .pto-tools, .pto-grid, .pto-decision { grid-template-columns:1fr; width:100%; min-width:0; }
    }
  `],
})
export class AdminPtoPage implements OnDestroy {
  orgId: string | null = null;
  requests = signal<TimeOffRequest[]>([]);
  users = signal<OrgUser[]>([]);
  filter: RequestFilter = 'pending';
  query = '';
  defaultPayRate = 0;
  busyId: string | null = null;
  private rates: Record<string, number> = {};
  private notes: Record<string, string> = {};
  private unsubRequests: (() => void) | null = null;
  private unsubUsers: (() => void) | null = null;

  constructor(
    private ctx: OrgContextService,
    private accruals: AccrualsRepo,
    private usersRepo: UsersRepo,
    private toast: ToastService,
  ) {
    this.bind();
    setTimeout(() => this.bind(), 800);
  }

  private bind() {
    const orgId = this.ctx.orgId();
    this.orgId = orgId;
    if (!orgId || this.unsubRequests) return;

    this.unsubRequests = this.accruals.watchOrgRequests(orgId, (items) => {
      this.requests.set(items);
      for (const r of items) {
        if (this.rates[r.id] == null) this.rates[r.id] = Number(r.payRate || this.defaultPayRate || 0);
      }
    });
    this.unsubUsers = this.usersRepo.watchOrgUsers(orgId, (items) => this.users.set(items));
    void this.loadDefaultPayRate(orgId);
  }

  private async loadDefaultPayRate(orgId: string) {
    try {
      const snap = await getDoc(doc(getFirestore(), 'orgs', orgId));
      const data: any = snap.exists() ? snap.data() : {};
      this.defaultPayRate = Number(data.defaultPayRate || 0);
    } catch {
      this.defaultPayRate = 0;
    }
  }

  filteredRequests(): TimeOffRequest[] {
    const q = this.query.trim().toLowerCase();
    return this.requests().filter((r) => {
      if (this.filter !== 'all' && r.status !== this.filter) return false;
      if (!q) return true;
      return [
        this.personLabel(r.userId),
        r.requestType,
        r.status,
        r.startDate,
        r.endDate,
        r.notes,
        r.managerNote,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(q));
    });
  }

  async approve(r: TimeOffRequest) {
    if (!this.orgId || this.busyId) return;
    this.busyId = r.id;
    try {
      await this.accruals.decideTimeOffRequest({
        orgId: this.orgId,
        request: r,
        decision: 'approved',
        managerNote: this.noteFor(r),
        actorUid: this.ctx.uid(),
        paid: r.requestType !== 'unpaid',
        payRate: this.rateFor(r),
      });
      this.toast.success('PTO request approved and attached to payroll.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'PTO approval failed.');
    } finally {
      this.busyId = null;
    }
  }

  async reject(r: TimeOffRequest) {
    if (!this.orgId || this.busyId) return;
    this.busyId = r.id;
    try {
      await this.accruals.decideTimeOffRequest({
        orgId: this.orgId,
        request: r,
        decision: 'rejected',
        managerNote: this.noteFor(r),
        actorUid: this.ctx.uid(),
        paid: false,
        payRate: 0,
      });
      this.toast.success('PTO request rejected.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'PTO rejection failed.');
    } finally {
      this.busyId = null;
    }
  }

  personLabel(uid: string): string {
    const user = this.users().find((u) => u.uid === uid);
    return user?.displayName || user?.email || uid;
  }

  initials(r: TimeOffRequest): string {
    const label = this.personLabel(r.userId);
    const parts = label.split(/[\s@.]+/).filter(Boolean);
    return parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : label.slice(0, 2).toUpperCase();
  }

  statusCount(status: TimeOffStatus): number {
    return this.requests().filter((r) => r.status === status).length;
  }

  isPaidRequest(r: TimeOffRequest): boolean {
    return r.status === 'approved' && r.requestType !== 'unpaid' && r.paid !== false;
  }

  payrollLeaveHours(): number {
    return this.requests()
      .filter((r) => this.isPaidRequest(r))
      .reduce((sum, r) => sum + Number(r.hours || 0), 0);
  }

  payrollLeaveGross(): number {
    return Math.round(this.requests()
      .filter((r) => this.isPaidRequest(r))
      .reduce((sum, r) => sum + Number(r.hours || 0) * Number(r.payRate || this.rateFor(r) || 0), 0) * 100) / 100;
  }

  pendingHours(): number {
    return this.requests()
      .filter((r) => r.status === 'pending')
      .reduce((sum, r) => sum + Number(r.hours || 0), 0);
  }

  rateFor(r: TimeOffRequest): number {
    return Number(this.rates[r.id] ?? r.payRate ?? this.defaultPayRate ?? 0);
  }

  setRate(r: TimeOffRequest, value: unknown) {
    this.rates[r.id] = Number(value || 0);
  }

  noteFor(r: TimeOffRequest): string {
    return this.notes[r.id] ?? '';
  }

  setNote(r: TimeOffRequest, value: string) {
    this.notes[r.id] = value;
  }

  moneyCurrency() {
    return this.ctx.currencyCode() || 'USD';
  }

  ngOnDestroy() {
    this.unsubRequests?.();
    this.unsubUsers?.();
  }
}
