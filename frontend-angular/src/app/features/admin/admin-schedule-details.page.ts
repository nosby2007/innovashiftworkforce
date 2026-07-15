import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Timestamp } from 'firebase/firestore';

import { MatIconModule } from '@angular/material/icon';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { UsersRepo, OrgUser } from '../../core/repos/users.repo';
import { AuditRepo, AuditLog } from '../../core/repos/audit.repo';
import { SchedulerCommands } from '../../core/commands/scheduler.commands';
import { ToastService } from '../../core/ui/toast.service';
import { PrintLauncherService } from '../../core/ui/print-launcher.service';
import { Shift } from '../../shared/models/shift.model';
import { tsToDate, formatDateTime } from '../../shared/utils/date.util';
import { TableListController } from '../../shared/ui/table-list/table-list.controller';
import { TablePaginatorComponent } from '../../shared/ui/table-list/table-paginator.component';

const ALL_STATUSES = ['open','published','assigned','claimed','in_progress','completed','expired','cancelled','no_show'] as const;
type ShiftStatus = typeof ALL_STATUSES[number];

interface StatusTab { label: string; statuses: ShiftStatus[] | null; }
const TABS: StatusTab[] = [
  { label: 'All',         statuses: null },
  { label: 'Open',        statuses: ['open', 'published'] },
  { label: 'Assigned',    statuses: ['assigned'] },
  { label: 'Claimed',     statuses: ['claimed'] },
  { label: 'In Progress', statuses: ['in_progress'] },
  { label: 'Completed',   statuses: ['completed'] },
  { label: 'Expired',     statuses: ['expired', 'cancelled', 'no_show'] },
];

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, MatIconModule, TablePaginatorComponent],
  template: `
    <div class="vs-page-pad sd-page">

      <!-- Header -->
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">Schedule Details</h1>
          <p class="vs-page-subtitle">All shifts — filter, audit, and manage</p>
        </div>
        <div class="vs-page-actions">
          <button class="vs-btn-ghost sd-action-btn no-print" (click)="printSchedule()">
            <mat-icon>print</mat-icon> Print
          </button>
        </div>
      </div>

      <div *ngIf="!orgId" class="vs-glass sd-no-org">
        <mat-icon>warning_amber</mat-icon> Missing org context.
      </div>

      <div *ngIf="orgId" class="sd-content">

        <!-- Filters -->
        <div class="vs-glass-strong sd-filters no-print">
          <div class="vs-form-row sd-filters-row">
            <div>
              <label class="vs-field-label">From</label>
              <input type="date" class="vs-input" [(ngModel)]="fromDate" (ngModelChange)="rebindShifts()">
            </div>
            <div>
              <label class="vs-field-label">To</label>
              <input type="date" class="vs-input" [(ngModel)]="endDate" (ngModelChange)="rebindShifts()">
            </div>
          </div>

          <!-- Status tabs -->
          <div class="sd-tabs">
            <button
              *ngFor="let tab of tabs"
              class="sd-tab"
              [class.sd-tab--active]="activeTab === tab.label"
              (click)="selectTab(tab)">
              {{ tab.label }}
              <span class="sd-tab-count" *ngIf="tabCount(tab) > 0">{{ tabCount(tab) }}</span>
            </button>
          </div>
        </div>

        <!-- Shifts table -->
        <section class="vs-glass-strong sd-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Shifts — {{ activeTab }}</div>
              <div class="vs-panel-subtitle">{{ displayShifts().length }} shift(s) found</div>
            </div>
          </div>

          <div *ngIf="displayShifts().length > 0" class="sd-table-toolbar no-print">
            <input
              type="search"
              class="vs-input"
              style="max-width:320px;"
              placeholder="Search title, location, status, or assignee…"
              [value]="shiftsCtrl.filterText()"
              (input)="shiftsCtrl.setFilter($any($event.target).value)">
          </div>

          <div class="vs-table-shell sd-table-shell">
            <table class="vs-table sd-table">
              <thead>
                <tr>
                  <th class="sd-th-sort" (click)="shiftsCtrl.toggleSort('title')">Title {{ shiftsCtrl.sortIndicator('title') }}</th>
                  <th class="sd-th-sort" (click)="shiftsCtrl.toggleSort('date')">Date {{ shiftsCtrl.sortIndicator('date') }}</th>
                  <th>Time</th>
                  <th class="sd-th-sort" (click)="shiftsCtrl.toggleSort('status')">Status {{ shiftsCtrl.sortIndicator('status') }}</th>
                  <th class="sd-th-sort" (click)="shiftsCtrl.toggleSort('location')">Location {{ shiftsCtrl.sortIndicator('location') }}</th>
                  <th class="sd-th-sort" (click)="shiftsCtrl.toggleSort('assigned')">Assigned To {{ shiftsCtrl.sortIndicator('assigned') }}</th>
                  <th class="sd-right no-print">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr class="vs-empty" *ngIf="shiftsCtrl.pageRows().length === 0">
                  <td colspan="7">No shifts match the selected filters.</td>
                </tr>
                <tr *ngFor="let s of shiftsCtrl.pageRows()" class="vs-row sd-shift-row">
                  <td><strong>{{ s.title }}</strong></td>
                  <td>{{ toDate(s.startAt) | date:'EEE MMM d, y' }}</td>
                  <td class="sd-mono">{{ toDate(s.startAt) | date:'shortTime' }} – {{ toDate(s.endAt) | date:'shortTime' }}</td>
                  <td>
                    <span class="vs-badge"
                          [class.vs-badge--success]="s.status === 'completed'"
                          [class.vs-badge--warning]="s.status === 'in_progress'"
                          [class.vs-badge--neutral]="!['completed','in_progress'].includes(s.status)">
                      {{ s.status | uppercase }}
                    </span>
                  </td>
                  <td>{{ s.locationName || '—' }}</td>
                  <td>{{ s.assignedUserId ? userLabel(s.assignedUserId) : '—' }}</td>
                  <td class="sd-right no-print">
                    <div class="sd-row-actions">
                      <button class="vs-btn-ghost sd-btn" (click)="openChat(s.id)">
                        <mat-icon>chat</mat-icon>
                      </button>
                      <button class="vs-btn-ghost sd-btn" *ngIf="s.status === 'open' || s.status === 'assigned'"
                              (click)="publish(s)">
                        <mat-icon>publish</mat-icon>
                      </button>
                      <button class="vs-btn-ghost sd-btn" (click)="toggleAuditForShift(s.id)">
                        <mat-icon>history</mat-icon>
                      </button>
                      <button class="vs-btn-ghost sd-btn" *ngIf="s.assignedUserId" (click)="unassign(s)">
                        <mat-icon>person_remove</mat-icon>
                      </button>
                      <button class="vs-btn-ghost sd-btn" (click)="viewEmployee(s.assignedUserId)" *ngIf="s.assignedUserId">
                        <mat-icon>person</mat-icon>
                      </button>
                      <button class="vs-btn-ghost sd-btn sd-btn--danger" (click)="deleteShift(s)"
                              *ngIf="!['in_progress','completed'].includes(s.status)">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </div>
                  </td>
                </tr>

                <!-- Inline audit row -->
                <tr *ngIf="auditShiftId && auditForShift(auditShiftId).length > 0" class="sd-audit-row">
                  <td colspan="7">
                    <div class="sd-audit-inline">
                      <div class="sd-audit-title">
                        <mat-icon>history</mat-icon> Audit Log
                        <button class="vs-btn-ghost sd-btn" style="margin-left:8px;" (click)="auditShiftId=null">
                          <mat-icon>close</mat-icon>
                        </button>
                      </div>
                      <div class="sd-audit-list">
                        <div *ngFor="let a of auditForShift(auditShiftId)" class="sd-audit-entry">
                          <span class="sd-audit-action">{{ a.action }}</span>
                          <span class="sd-audit-actor">{{ auditActor(a) }}</span>
                          <span class="sd-audit-time">{{ fmtDate(a.createdAt) }}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <app-table-paginator *ngIf="displayShifts().length > 0" [controller]="shiftsCtrl"></app-table-paginator>
        </section>

        <!-- Audit log section -->
        <section class="vs-glass-strong sd-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Audit Log</div>
              <div class="vs-panel-subtitle">Recent schedule actions</div>
            </div>
          </div>

          <div *ngIf="auditItems().length > 0" class="sd-table-toolbar no-print">
            <input
              type="search"
              class="vs-input"
              style="max-width:320px;"
              placeholder="Search action, actor, or target…"
              [value]="auditCtrl.filterText()"
              (input)="auditCtrl.setFilter($any($event.target).value)">
          </div>

          <div class="vs-table-shell sd-table-shell">
            <table class="vs-table sd-table">
              <thead>
                <tr>
                  <th class="sd-th-sort" (click)="auditCtrl.toggleSort('date')">Date {{ auditCtrl.sortIndicator('date') }}</th>
                  <th class="sd-th-sort" (click)="auditCtrl.toggleSort('action')">Action {{ auditCtrl.sortIndicator('action') }}</th>
                  <th class="sd-th-sort" (click)="auditCtrl.toggleSort('by')">By {{ auditCtrl.sortIndicator('by') }}</th>
                  <th class="sd-th-sort" (click)="auditCtrl.toggleSort('target')">Target {{ auditCtrl.sortIndicator('target') }}</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                <tr class="vs-empty" *ngIf="auditCtrl.pageRows().length === 0">
                  <td colspan="5">No audit entries yet.</td>
                </tr>
                <tr *ngFor="let a of auditCtrl.pageRows()" class="vs-row">
                  <td class="sd-mono sd-nowrap">{{ fmtDate(a.createdAt) }}</td>
                  <td><strong>{{ a.action }}</strong></td>
                  <td class="sd-mono">{{ auditActor(a) }}</td>
                  <td class="sd-mono">{{ auditTarget(a) }}</td>
                  <td class="sd-details">{{ a.details | json }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <app-table-paginator *ngIf="auditItems().length > 0" [controller]="auditCtrl"></app-table-paginator>
        </section>

        <!-- Print footer -->
        <div class="sd-print-footer print-only">
          <p>Printed {{ today() }}</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .sd-page { width: 100%; }
    .sd-no-org { display:flex; align-items:center; gap:12px; padding:20px; color:var(--warning); font-weight:600; }
    .sd-content { width: 100%; }

    .sd-filters {
      margin-bottom: 20px;
      padding: 20px;
      border: 1px solid var(--border);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
    }
    .sd-filters-row { display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px; }
    @media (max-width: 600px) { .sd-filters-row { grid-template-columns: 1fr; } }

    .sd-tabs { display:flex; flex-wrap:wrap; gap:8px; }
    .sd-tab {
      display:inline-flex; align-items:center; gap:6px;
      padding:7px 14px; border-radius:var(--radius-md);
      border:1px solid var(--border); background:transparent;
      color:var(--text-muted); font-size:13px; font-weight:600; cursor:pointer;
      transition: all 0.15s;
    }
    .sd-tab:hover { border-color:var(--primary); color:var(--primary); }
    .sd-tab--active { background:var(--primary) !important; color:#fff !important; border-color:var(--primary) !important; }
    .sd-tab-count { font-size:10px; background:rgba(255,255,255,0.2); border-radius:9px; padding:1px 6px; font-weight:700; }

    .sd-section { margin-bottom: 20px; border: 1px solid var(--border); }

    .sd-table-toolbar { padding: 16px 20px 0; }
    .sd-th-sort { cursor: pointer; user-select: none; white-space: nowrap; }
    .sd-th-sort:hover { color: var(--primary); }

    .sd-table-shell {
      border: none;
      background: var(--bg-surface);
      overflow: auto;
    }
    .sd-table { width: 100%; min-width: 980px; }
    .sd-table th { background: var(--bg-elevated); }
    .sd-table tbody tr:nth-child(even):not(.vs-empty):not(.sd-audit-row) td { background: rgba(148,163,184,0.08); }

    .sd-shift-row td { vertical-align: middle; }
    .sd-right { text-align:right; white-space:nowrap; }
    .sd-mono { font-family:monospace; font-size:12px; }
    .sd-nowrap { white-space:nowrap; }
    .sd-details { font-size:11px; color:var(--text-subtle); max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

    .sd-row-actions { display:flex; gap:4px; justify-content:flex-end; flex-wrap:wrap; }
    .sd-btn {
      display:inline-flex; align-items:center; justify-content:center;
      padding:6px 8px !important;
      min-width:32px;
    }
    .sd-btn mat-icon { font-size:16px !important; width:16px; height:16px; }
    .sd-btn--danger { color:var(--danger) !important; border-color:rgba(239,68,68,0.35) !important; }

    .sd-audit-row td { padding: 0 !important; }
    .sd-audit-inline { padding:14px 20px; background:var(--bg-elevated); border-top:1px solid var(--border); border-bottom:1px solid var(--border); }
    .sd-audit-title { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700; color:var(--text-muted); margin-bottom:10px; }
    .sd-audit-title mat-icon { font-size:16px !important; width:16px; height:16px; }
    .sd-audit-list { display:flex; flex-direction:column; gap:6px; }
    .sd-audit-entry { display:flex; align-items:center; gap:14px; font-size:12px; }
    .sd-audit-action { font-weight:700; color:var(--text); min-width:220px; }
    .sd-audit-actor { color:var(--text-subtle); font-family:monospace; }
    .sd-audit-time { color:var(--text-subtle); margin-left:auto; }

    .sd-action-btn { display:inline-flex; align-items:center; gap:6px; }

    .sd-print-footer { margin-top:24px; font-size:12px; color:#555; border-top:1px solid #ccc; padding-top:10px; }

    @media print {
      .no-print { display: none !important; }
      .print-only { display: block !important; }
      .sd-table-shell { background: transparent !important; border: 1px solid #ccc !important; overflow: visible !important; }
      .sd-table { min-width: auto !important; width: 100%; color: #000 !important; }
      .sd-table th, .sd-table td { color: #000 !important; background: transparent !important; border-color: #ccc !important; }
      .vs-badge { background: transparent !important; color: #000 !important; border: 1px solid #aaa !important; }
      .vs-page-pad { padding: 10px !important; }
      .vs-page-header .vs-page-actions { display:none; }
    }
    .print-only { display: none; }
  `],
})
export class AdminScheduleDetailsPage implements OnDestroy {
  orgId: string | null = null;

  fromDate = '';
  endDate = '';

  tabs = TABS;
  activeTab = 'All';
  activeStatuses: ShiftStatus[] | null = null;

  allShifts = signal<Shift[]>([]);
  displayShifts = signal<Shift[]>([]);

  shiftsCtrl = new TableListController<Shift>(this.displayShifts, {
    pageSize: 25,
    initialSort: { key: 'date', dir: 'desc' },
    filterPredicate: (s, q) => this.shiftSearchText(s).includes(q),
    sortAccessor: (s, key) => {
      if (key === 'title') return (s.title || '').toLowerCase();
      if (key === 'date') return this.toDate(s.startAt).getTime();
      if (key === 'status') return s.status;
      if (key === 'location') return (s.locationName || '').toLowerCase();
      if (key === 'assigned') return s.assignedUserId ? this.userLabel(s.assignedUserId).toLowerCase() : '';
      return null;
    },
  });

  users = signal<OrgUser[]>([]);

  auditItems = signal<AuditLog[]>([]);
  auditShiftId: string | null = null;

  auditCtrl = new TableListController<AuditLog>(this.auditItems, {
    pageSize: 25,
    initialSort: { key: 'date', dir: 'desc' },
    filterPredicate: (a, q) => this.auditSearchText(a).includes(q),
    sortAccessor: (a, key) => {
      if (key === 'date') return tsToDate(a.createdAt)?.getTime() ?? 0;
      if (key === 'action') return (a.action || '').toLowerCase();
      if (key === 'by') return this.auditActor(a).toLowerCase();
      if (key === 'target') return this.auditTarget(a).toLowerCase();
      return null;
    },
  });

  private unsubShifts: (() => void) | null = null;
  private unsubUsers: (() => void) | null = null;
  private unsubAudit: (() => void) | null = null;

  constructor(
    private ctx: OrgContextService,
    private shiftsRepo: ShiftsRepo,
    private usersRepo: UsersRepo,
    private auditRepo: AuditRepo,
    private schedulerCmd: SchedulerCommands,
    private toast: ToastService,
    private router: Router,
    private printLauncher: PrintLauncherService,
  ) {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    this.fromDate = monday.toISOString().slice(0, 10);
    this.endDate = sunday.toISOString().slice(0, 10);

    const bind = () => {
      const orgId = this.ctx.orgId();
      this.orgId = orgId;
      if (!orgId) return;

      if (!this.unsubUsers) {
        this.unsubUsers = this.usersRepo.watchOrgUsers(orgId, (items) => this.users.set(items));
      }
      if (!this.unsubAudit) {
        this.unsubAudit = this.auditRepo.watchRecent(orgId, (items) => this.auditItems.set(items));
      }
      this.rebindShifts();
    };

    bind();
    setTimeout(bind, 800);
    setTimeout(bind, 2400);
  }

  ngOnDestroy() {
    this.unsubShifts?.();
    this.unsubUsers?.();
    this.unsubAudit?.();
  }

  rebindShifts() {
    if (this.unsubShifts) { this.unsubShifts(); this.unsubShifts = null; }
    const orgId = this.orgId;
    if (!orgId || !this.fromDate || !this.endDate) return;

    const startAt = Timestamp.fromDate(new Date(this.fromDate + 'T00:00:00'));
    const endAt   = Timestamp.fromDate(new Date(this.endDate   + 'T23:59:59'));

    this.unsubShifts = this.shiftsRepo.watchOrgRange(orgId, startAt, endAt, (items) => {
      this.allShifts.set(items);
      this.applyTabFilter();
    });
  }

  selectTab(tab: StatusTab) {
    this.activeTab = tab.label;
    this.activeStatuses = tab.statuses;
    this.applyTabFilter();
  }

  applyTabFilter() {
    if (!this.activeStatuses) {
      this.displayShifts.set([...this.allShifts()]);
    } else {
      const allowed = new Set(this.activeStatuses as string[]);
      this.displayShifts.set(this.allShifts().filter((s) => allowed.has(s.status)));
    }
  }

  private shiftSearchText(s: Shift): string {
    const assigned = s.assignedUserId ? this.userLabel(s.assignedUserId) : '';
    return `${s.title || ''} ${s.locationName || ''} ${s.status || ''} ${assigned}`.toLowerCase();
  }

  private auditSearchText(a: AuditLog): string {
    return `${a.action || ''} ${this.auditActor(a)} ${this.auditTarget(a)}`.toLowerCase();
  }

  tabCount(tab: StatusTab): number {
    if (!tab.statuses) return this.allShifts().length;
    const allowed = new Set(tab.statuses as string[]);
    return this.allShifts().filter((s) => allowed.has(s.status)).length;
  }

  userLabel(uid: string): string {
    const u = this.users().find((x) => x.uid === uid);
    if (!u) return 'Staff member';
    return u.displayName || u.email || 'Staff member';
  }

  toDate(value: any): Date {
    return tsToDate(value) || new Date();
  }

  fmtDate(ts: any): string {
    return formatDateTime(ts);
  }

  today(): string {
    return new Date().toLocaleDateString();
  }

  toggleAuditForShift(shiftId: string) {
    this.auditShiftId = this.auditShiftId === shiftId ? null : shiftId;
  }

  auditForShift(shiftId: string | null): AuditLog[] {
    if (!shiftId) return [];
    return this.auditItems().filter(
      (a) => a.target?.shiftId === shiftId || a.details?.entityId === shiftId
    );
  }

  auditActor(a: AuditLog): string {
    return (a as any).actorName || (a as any).actorEmail || 'System or admin';
  }

  auditTarget(a: AuditLog): string {
    return (a as any).targetUserName || (a as any).documentTitle || a.target?.title || a.target?.name || 'Schedule record';
  }

  printSchedule() {
    this.printLauncher.open('/print/schedule-details', {
      from: this.fromDate,
      to: this.endDate,
      tab: this.activeTab,
      statuses: this.activeStatuses?.join(',') || '',
    }, 'schedule-details');
  }

  async openChat(shiftId: string) {
    await this.router.navigate(['/app/shift-chat'], { queryParams: { shiftId } });
  }

  async publish(shift: Shift) {
    try {
      await this.schedulerCmd.publishShift(shift.id, true);
      this.toast.success('Shift published to marketplace.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to publish shift.');
    }
  }

  async unassign(shift: Shift) {
    const ok = window.confirm(`Unassign "${shift.title}"?`);
    if (!ok) return;
    try {
      await this.schedulerCmd.unassignShift(shift.id);
      this.toast.success('Shift unassigned.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to unassign shift.');
    }
  }

  async deleteShift(shift: Shift) {
    const ok = window.confirm(`Delete "${shift.title}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await this.schedulerCmd.deleteShift(shift.id);
      this.toast.success('Shift deleted.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to delete shift.');
    }
  }

  viewEmployee(uid: string | undefined) {
    if (!uid) return;
    this.router.navigate(['/admin/employees', uid]);
  }
}


