import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Timestamp } from 'firebase/firestore';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { UsersRepo, OrgUser } from '../../core/repos/users.repo';
import { TimeEntriesRepo } from '../../core/repos/time-entries.repo';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { AdminCommands } from '../../core/commands/admin.commands';
import { TimeEntry } from '../../shared/models/time-entry.model';
import { formatDateTime, tsToDate } from '../../shared/utils/date.util';
import { toCsv, downloadTextFile } from '../../shared/utils/csv.util';
import { ToastService } from '../../core/ui/toast.service';
import { PrintLauncherService } from '../../core/ui/print-launcher.service';

import { MatIconModule } from '@angular/material/icon';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="vs-page-pad">
      <!-- Header -->
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">Timesheets</h1>
          <p class="vs-page-subtitle">Review, export, and manage staff time entries</p>
        </div>
      </div>

      <div *ngIf="!orgId" class="ad-no-org vs-glass">
        <mat-icon>warning_amber</mat-icon> Missing org context.
      </div>

      <div *ngIf="orgId" class="ts-content">
        <!-- Filters -->
        <div class="vs-glass-strong ts-filters">
          <div class="vs-form-row ts-filters-grid">
            <div>
              <label class="vs-field-label">Staff Member</label>
              <select class="vs-select" [(ngModel)]="selectedUid">
                <option value="">Select user</option>
                <option *ngFor="let u of users()" [value]="u.uid">
                  {{ u.displayName || u.email || 'Staff member' }} — {{ u.jobRole || '—' }}
                </option>
              </select>
            </div>
            <div>
              <label class="vs-field-label">From</label>
              <input type="date" class="vs-input" [(ngModel)]="fromDate">
            </div>
            <div>
              <label class="vs-field-label">To</label>
              <input type="date" class="vs-input" [(ngModel)]="toDate">
            </div>
            <div class="ts-actions">
              <button class="vs-btn-ghost ts-action-btn" (click)="openPrint()" [disabled]="!selectedUid">
                <mat-icon style="font-size:18px;">print</mat-icon> Print
              </button>
              <button class="vs-btn-primary ts-action-btn" (click)="exportCsv()" [disabled]="rows().length===0">
                <mat-icon style="font-size:18px;">download</mat-icon> CSV
              </button>
            </div>
          </div>
        </div>

        <div class="ts-meta" *ngIf="rows().length > 0 || selectedUid">
          <span>{{ rows().length }} entries found</span>
        </div>

        <div class="vs-glass-strong ts-fix" *ngIf="orgId">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Attendance Management</div>
              <div class="vs-panel-subtitle">Fix missed punch by setting corrected in/out times</div>
            </div>
          </div>
          <div class="ts-fix-help" *ngIf="!fixEntryId">
            Select a row in the table with <strong>Fix</strong>, or pick a pending request below.
          </div>

          <div class="ts-fix-pending" *ngIf="pendingEntries().length > 0 && !fixEntryId">
            <div class="ts-fix-pending-title">Pending correction requests</div>
            <div class="ts-fix-pending-list">
              <button class="vs-btn-ghost ts-pending-chip" *ngFor="let p of pendingEntries()" (click)="startFixFromPending(p)">
                {{ staffLabel(p.userId) }} • Assigned shift
              </button>
            </div>
          </div>

          <div class="ts-fix-target" *ngIf="fixEntryId">
            <span class="vs-badge">Selected correction</span>
            <span class="ts-target-meta" *ngIf="fixUserId">Staff: {{ staffLabel(fixUserId) }}</span>
            <span class="ts-target-meta" *ngIf="fixShiftId">Shift: Assigned shift</span>
          </div>

          <div *ngIf="fixEntryId">
          <div class="vs-form-row vs-form-row--2">
            <div>
              <label class="vs-field-label">Corrected Check In</label>
              <input type="datetime-local" class="vs-input" [(ngModel)]="fixCheckInLocal">
            </div>
            <div>
              <label class="vs-field-label">Corrected Check Out</label>
              <input type="datetime-local" class="vs-input" [(ngModel)]="fixCheckOutLocal">
            </div>
          </div>
          <div class="ts-fix-actions">
            <button class="vs-btn-ghost" (click)="cancelFix()" [disabled]="fixBusy">Cancel</button>
            <button class="vs-btn-ghost" (click)="rejectFix()" [disabled]="fixBusy">Reject</button>
            <button class="vs-btn-primary" (click)="applyFix()" [disabled]="fixBusy">Apply Fix</button>
          </div>
          </div>
        </div>

        <!-- Table -->
        <div *ngIf="rows().length > 0" class="vs-table-shell ts-table-shell">
          <table class="vs-table ts-table">
            <thead>
              <tr>
                <th>Shift Title</th>
                <th>Check In</th>
                <th>Check Out</th>
                <th>Hours</th>
                <th>Status</th>
                <th class="ts-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let r of rows()" class="vs-row">
                <td><span class="vs-strong">{{ r.shiftTitle }}</span></td>
                <td>{{ r.checkIn }}</td>
                <td>{{ r.checkOut }}</td>
                <td><strong>{{ r.hours }}</strong></td>
                <td>
                  <span class="vs-badge" 
                        [class.vs-badge--success]="!r.exceptionStatus || r.exceptionStatus==='none'"
                        [class.vs-badge--warning]="r.exceptionStatus && r.exceptionStatus!=='none'">
                    {{ (r.exceptionStatus || 'none') | titlecase }}
                  </span>
                </td>
                <td class="ts-right">
                  <button class="vs-btn-ghost ts-fix-btn" (click)="startFix(r)">Fix</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div *ngIf="rows().length === 0 && selectedUid" class="ts-empty vs-glass">
          <mat-icon>search_off</mat-icon>
          <div>
            <strong>No timesheet entries found.</strong>
            <p>Try adjusting the date range or selecting a different employee.</p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .ad-no-org { display:flex; align-items:center; gap:12px; padding:20px; color:var(--warning); font-weight:600; }
    .ts-content { width: 100%; }
    .ts-filters {
      padding:20px;
      border-radius:var(--radius-lg);
      margin-bottom:16px;
      overflow:visible;
      border: 1px solid var(--border);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
    }
    .ts-filters-grid { display:grid; grid-template-columns: 2fr 1fr 1fr auto; gap:14px; align-items:flex-end; }
    @media (max-width: 800px) { .ts-filters-grid { grid-template-columns: 1fr; } }
    
    .ts-actions { display:flex; gap:10px; margin-bottom:2px; }
    .ts-action-btn { display:inline-flex; align-items:center; gap:6px; padding:10px 16px !important; }
    
    .ts-meta { margin-bottom:12px; color:var(--text-subtle); font-size:13px; font-weight:600; padding:0 4px; }
    .ts-fix {
      margin-bottom: 16px;
      padding: 16px;
      border: 1px solid var(--border);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
    }
    .ts-fix-help { font-size: 13px; color: var(--text-subtle); margin-bottom: 12px; }
    .ts-fix-target { display:flex; flex-wrap:wrap; gap:8px; margin-bottom: 10px; }
    .ts-target-meta { font-size: 12px; color: var(--text-subtle); }
    .ts-fix-pending { margin-bottom: 14px; }
    .ts-fix-pending-title { font-size: 12px; color: var(--text-subtle); margin-bottom: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .ts-fix-pending-list { display:flex; flex-wrap:wrap; gap:8px; }
    .ts-pending-chip { padding:5px 9px !important; font-size:12px !important; }
    .ts-fix-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:10px; }
    .ts-fix-btn { padding:6px 10px !important; font-size:12px !important; }

    .ts-table-shell {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--bg-surface);
      overflow: auto;
    }

    .ts-table {
      width: 100%;
      min-width: 860px;
    }

    .ts-table th {
      background: var(--bg-elevated);
      color: var(--text-subtle);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 800;
    }

    .ts-table td {
      vertical-align: middle;
    }

    .ts-table tbody tr:nth-child(even):not(.vs-empty) td {
      background: rgba(148,163,184,0.08);
    }

    .ts-right {
      text-align: right;
      white-space: nowrap;
    }

    .ts-empty { display:flex; align-items:flex-start; gap:16px; padding:28px 24px; color:var(--text-muted); }
    .ts-empty mat-icon { font-size:32px; color:var(--text-subtle); flex-shrink:0; margin-top:2px; }
    .ts-empty strong { color:var(--text); display:block; font-size:15px; }
    .ts-empty p { margin:4px 0 0; font-size:13px; }
  `]
})
export class AdminTimesheetsPage implements OnDestroy {
  orgId: string | null = null;

  users = signal<OrgUser[]>([]);
  selectedUid = '';

  fromDate = '';
  toDate = '';

  private unsubUsers: (() => void) | null = null;
  private unsubEntries: (() => void) | null = null;
  private unsubPending: (() => void) | null = null;

  entries = signal<TimeEntry[]>([]);
  shiftMap = signal<Record<string, any>>({});

  rows = signal<Array<any>>([]);
  pendingEntries = signal<TimeEntry[]>([]);
  fixEntryId: string | null = null;
  fixUserId: string | null = null;
  fixShiftId: string | null = null;
  fixCheckInLocal = '';
  fixCheckOutLocal = '';
  fixBusy = false;
  private lastFilterKey = '';

  constructor(
    private ctx: OrgContextService,
    private usersRepo: UsersRepo,
    private timeRepo: TimeEntriesRepo,
    private shiftsRepo: ShiftsRepo,
    private adminCmd: AdminCommands,
    private toast: ToastService,
    private printLauncher: PrintLauncherService,
  ) {
    const bind = () => {
      const orgId = this.ctx.orgId();
      this.orgId = orgId;
      if (!orgId) return;
      if (!this.unsubUsers) {
        this.unsubUsers = this.usersRepo.watchOrgUsers(orgId, (items) => this.users.set(items));
      }
      if (!this.unsubPending) {
        this.unsubPending = this.timeRepo.watchPendingApprovals(orgId, (items) => {
          this.pendingEntries.set(items);
        });
      }
    };

    bind();
    setTimeout(bind, 800);
    setTimeout(bind, 2400);

    // default dates: current week
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay()+6)%7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    this.fromDate = monday.toISOString().slice(0,10);
    this.toDate = sunday.toISOString().slice(0,10);
  }

  private async refreshRows() {
    if (!this.orgId || !this.selectedUid || !this.fromDate || !this.toDate) {
      this.rows.set([]);
      return;
    }
    const startMs = new Date(this.fromDate + 'T00:00:00').getTime();
    const endMs = new Date(this.toDate + 'T23:59:59').getTime();

    const start = Timestamp.fromMillis(startMs);
    const end = Timestamp.fromMillis(endMs);

    if (this.unsubEntries) this.unsubEntries();
    this.unsubEntries = this.timeRepo.watchEntriesRange(this.orgId, this.selectedUid, start, end, async (items) => {
      this.entries.set(items);
      const shiftIds = Array.from(new Set(items.map(i => i.shiftId))).filter(Boolean);
      const shiftMap = await this.shiftsRepo.getManyByIds(this.orgId!, shiftIds);
      this.shiftMap.set(shiftMap);

      this.rows.set(items.map(e => {
        const s = shiftMap[e.shiftId];
        const inD = tsToDate(e.checkInAt);
        const outD = tsToDate(e.checkOutAt);
        const hours = (inD && outD) ? ((outD.getTime() - inD.getTime()) / 3600000).toFixed(2) : '';
        return {
          shiftTitle: s?.title || e.shiftId,
          checkIn: formatDateTime(e.checkInAt),
          checkOut: formatDateTime(e.checkOutAt),
          hours,
          exceptionStatus: e.exceptionStatus,
          entryId: e.id,
        };
      }));
    });
  }

  openPrint() {
    if (!this.selectedUid) return;
    this.printLauncher.open('/print/timesheets', {
      uid: this.selectedUid,
      from: this.fromDate,
      to: this.toDate,
    }, 'timesheets');
  }

exportCsv() {
    const headers = ['shiftTitle','checkIn','checkOut','hours','exceptionStatus'];
    const csv = toCsv(this.rows(), headers);
    const filename = `timesheet_${this.safeFileLabel(this.staffLabel(this.selectedUid))}_${this.fromDate}_to_${this.toDate}.csv`;
    downloadTextFile(filename, csv, 'text/csv');
  }

  ngOnDestroy() {
    if (this.unsubUsers) this.unsubUsers();
    if (this.unsubEntries) this.unsubEntries();
    if (this.unsubPending) this.unsubPending();
  }

  staffLabel(uid?: string | null): string {
    const user = this.users().find((u) => u.uid === uid);
    return user?.displayName || user?.email || 'Staff member';
  }

  safeFileLabel(value: string): string {
    return String(value || 'staff').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 48);
  }

  private toLocalInput(ts: any): string {
    const d = tsToDate(ts);
    if (!d) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  startFix(row: any) {
    this.fixEntryId = row.entryId;
    const found = this.entries().find((e) => e.id === row.entryId);
    this.fixUserId = found?.userId || null;
    this.fixShiftId = found?.shiftId || null;
    this.fixCheckInLocal = this.toLocalInput(found?.checkInAt);
    this.fixCheckOutLocal = this.toLocalInput(found?.checkOutAt);
  }

  startFixFromPending(p: TimeEntry) {
    this.fixEntryId = p.id;
    this.fixUserId = p.userId || null;
    this.fixShiftId = p.shiftId || null;
    this.fixCheckInLocal = this.toLocalInput(p.requestedCheckInAt || p.checkInAt);
    this.fixCheckOutLocal = this.toLocalInput(p.requestedCheckOutAt || p.checkOutAt);
  }

  cancelFix() {
    this.fixEntryId = null;
    this.fixUserId = null;
    this.fixShiftId = null;
    this.fixCheckInLocal = '';
    this.fixCheckOutLocal = '';
  }

  async applyFix() {
    if (!this.fixEntryId) return;
    this.fixBusy = true;
    try {
      const inMs = this.fixCheckInLocal ? new Date(this.fixCheckInLocal).getTime() : 0;
      const outMs = this.fixCheckOutLocal ? new Date(this.fixCheckOutLocal).getTime() : 0;

      await this.adminCmd.applyTimeCorrection({
        entryId: this.fixEntryId,
        correctedCheckInAtMs: inMs > 0 ? inMs : undefined,
        correctedCheckOutAtMs: outMs > 0 ? outMs : undefined,
      });

      this.toast.success('Attendance correction applied.');
      this.cancelFix();
    } catch (e: any) {
      this.toast.errorFrom(e, 'Attendance fix failed.');
    } finally {
      this.fixBusy = false;
    }
  }

  async rejectFix() {
    if (!this.fixEntryId) return;
    this.fixBusy = true;
    try {
      await this.adminCmd.decideTimeCorrection(this.fixEntryId, 'rejected');
      this.toast.info('Correction request rejected.');
      this.cancelFix();
    } catch (e: any) {
      this.toast.errorFrom(e, 'Reject failed.');
    } finally {
      this.fixBusy = false;
    }
  }

  // called by template through change detection
  ngDoCheck() {
    const key = `${this.orgId || ''}|${this.selectedUid}|${this.fromDate}|${this.toDate}`;
    if (key !== this.lastFilterKey) {
      this.lastFilterKey = key;
      this.refreshRows();
    }
  }
}
