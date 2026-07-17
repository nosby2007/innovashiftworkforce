import { Component, Inject, computed, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerInputEvent, MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog, MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { SchedulerCommands } from '../../core/commands/scheduler.commands';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { ToastService } from '../../core/ui/toast.service';

// ─── Models ───────────────────────────────────────────────────────────────────

export type ScheduleRow = {
  id: string;
  date: Date;
  shiftLabel: string;
  hours: number;
  projected: number;
  position: string;
  assignment: string;
  location: string;
  status: string;
  rawStatus: string;
};

export type ListShiftItem = {
  id: string;
  title: string;
  locationName: string;
  status: string;
  requiredJobRole?: string | null;
  assignedUserId?: string | null;
  payRate?: number | null;
  startAtMs?: number | null;
  endAtMs?: number | null;
};

type DateRange = { start: Date; end: Date };
type ShiftStatusFilter =
  | ''
  | 'open'
  | 'published'
  | 'assigned'
  | 'claimed'
  | 'in_progress'
  | 'completed'
  | 'expired'
  | 'cancelled'
  | 'no_show';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const STATUS_BADGE: Record<string, string> = {
  OPEN:      'vs-badge--open',
  PUBLISHED: 'vs-badge--published',
  ASSIGNED:  'vs-badge--assigned',
  CLAIMED:   'vs-badge--assigned',
  IN_PROGRESS: 'vs-badge--published',
  COMPLETED: 'vs-badge--completed',
  EXPIRED:   'vs-badge--cancelled',
  CANCELLED: 'vs-badge--cancelled',
  NO_SHOW:   'vs-badge--cancelled',
};

// ─── Schedule Page ─────────────────────────────────────────────────────────────

@Component({
  selector: 'vs-schedule',
  standalone: true,
  imports: [
    CommonModule,
    NgIf,
    FormsModule,
    CurrencyPipe,
    DatePipe,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatTableModule,
    MatSortModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="sched-page">
      <header class="sched-header">
        <h1>My Schedule</h1>
        <div class="sched-actions">
          <details class="sched-request-menu">
            <summary>Request <mat-icon>expand_more</mat-icon></summary>
            <button (click)="go('/app/accruals')">Time-off</button>
            <button (click)="go('/app/dashboard')">Swap shifts</button>
            <button (click)="go('/app/marketplace')">Open shift</button>
            <button (click)="assignedToMeOnly = true; resetAndLoad()">Self-schedule</button>
            <button (click)="clearFilters()">Change availability</button>
          </details>
          <button class="sched-icon" (click)="picker.open()" aria-label="Pick date"><mat-icon>tune</mat-icon></button>
          <button class="sched-icon" (click)="resetAndLoad()" aria-label="Refresh"><mat-icon>refresh</mat-icon></button>
          <mat-form-field class="vs-hidden-date" appearance="outline">
            <input matInput [matDatepicker]="picker" (dateChange)="onDatePicked($event)" aria-label="Pick date" />
            <mat-datepicker #picker></mat-datepicker>
          </mat-form-field>
        </div>
      </header>

      <div class="sched-layout">
        <aside class="sched-mini">
          <div class="sched-mini-head">
            <strong>{{ rangeStartMonth() }}</strong>
            <button (click)="prevRange()" aria-label="Previous"><mat-icon>chevron_left</mat-icon></button>
            <button (click)="nextRange()" aria-label="Next"><mat-icon>chevron_right</mat-icon></button>
          </div>
          <button class="sched-today" (click)="goToday()">Today</button>
          <div class="sched-weekdays">
            <span *ngFor="let d of ['Fri','Sat','Sun','Mon','Tue','Wed','Thu']">{{ d }}</span>
          </div>
          <div class="sched-days">
            <button *ngFor="let d of calendarDays()"
                    [class.is-today]="isToday(d)"
                    [class.has-shift]="hasShiftOn(d)"
                    (click)="range.set(makeRange(d)); resetAndLoad()">
              <span>{{ d.getDate() }}</span>
              <i *ngIf="hasShiftOn(d)"></i>
            </button>
          </div>
        </aside>

        <main class="sched-list-card">
          <div class="sched-list-tools">
            <input [ngModel]="searchQuery()" (ngModelChange)="searchQuery.set($event); onSearch()" placeholder="Search schedule">
            <select [(ngModel)]="statusFilter" (change)="resetAndLoad()">
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="published">Published</option>
              <option value="assigned">Assigned</option>
              <option value="claimed">Claimed</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div class="sched-summary">
            <span>{{ rangeLabel() }}</span>
            <strong>{{ totalHours() }} scheduled hours</strong>
          </div>

          <div class="sched-empty" *ngIf="!loading() && displayRows().length === 0">No shifts found for this range.</div>
          <div class="sched-empty" *ngIf="loading() && displayRows().length === 0">Loading schedule...</div>

          <button *ngFor="let row of displayRows()"
                  class="sched-row"
                  [class.is-selected]="row.id === selectedId()"
                  (click)="selectRow(row.id)">
            <div class="sched-date">
              <span>{{ row.date | date:'EEE' }}</span>
              <strong>{{ row.date | date:'d' }}</strong>
            </div>
            <div class="sched-shift">
              <div class="sched-open" *ngIf="row.assignment === 'OPEN'">
                <i></i> Open shifts are available
              </div>
              <div class="sched-shift-title">
                <mat-icon>{{ row.assignment === 'OPEN' ? 'local_offer' : 'spa' }}</mat-icon>
                {{ row.position }} {{ row.shiftLabel }}
              </div>
              <div class="sched-shift-meta">{{ row.location }}</div>
              <div class="sched-shift-meta">{{ row.status }} · {{ row.hours }}h · {{ row.projected | currency:moneyCurrency() }}</div>
            </div>
            <mat-icon class="sched-tag">sell</mat-icon>
            <mat-icon class="sched-more">more_vert</mat-icon>
          </button>

          <div class="vs-load-more" *ngIf="hasMore()">
            <button mat-stroked-button (click)="loadMore()" [disabled]="loading()">
              <mat-icon>expand_more</mat-icon>
              Load more
            </button>
          </div>
        </main>

        <div class="sched-backdrop" *ngIf="selectedRow()" (click)="selectedId.set(null)"></div>
        <aside class="sched-detail" *ngIf="selectedRow() as row">
          <button class="sched-detail-close" (click)="selectedId.set(null)" aria-label="Close"><mat-icon>close</mat-icon></button>
          <h2>Your Shift</h2>
          <div class="sched-detail-title">
            <mat-icon>spa</mat-icon>
            {{ row.position }} {{ row.shiftLabel }}
          </div>
          <div class="sched-detail-meta">{{ row.date | date:'EEE M/d' }}</div>
          <div class="sched-detail-meta">{{ row.location }}</div>
          <div class="sched-detail-section">
            <strong>When</strong>
            <span>{{ row.date | date:'EEE M/d' }}</span>
          </div>
          <button class="sched-outline" (click)="go('/app/dashboard')">Swap my shift</button>
          <button class="sched-outline" (click)="go('/app/accruals')">Request time off</button>
        </aside>
      </div>
    </div>
  `,
  styleUrl: './schedule.page.scss',
})
export class SchedulePage {
  private dialog   = inject(MatDialog);
  private commands = inject(SchedulerCommands);
  private ctx      = inject(OrgContextService);
  private router   = inject(Router);

  displayedColumns = ['date', 'shift', 'status', 'hours', 'projected', 'position', 'assignment', 'location', 'action'];

  // ── Range ───────────────────────────────────────────────────────────────────
  range = signal<DateRange>(this.makeRange(new Date()));

  rangeLabel = computed(() => {
    const { start, end } = this.range();
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
    return `${fmt(start)} — ${fmt(end)}`;
  });

  canPostShift = computed(() => {
    const role = (this.ctx.accessRole() ?? '').toLowerCase();
    const platform = String(this.ctx.platformRole() ?? '').toLowerCase();
    return role === 'admin' || role === 'scheduler' || role === 'hr' || role === 'manager'
      || platform === 'superadmin' || platform === 'super_admin' || platform === 'super-admin';
  });

  // ── Filters ─────────────────────────────────────────────────────────────────
  statusFilter: ShiftStatusFilter = '';
  roleFilter     = '';
  searchQuery    = signal('');
  siteFilter     = signal('');
  assignedToMeOnly = true;

  hasActiveFilters(): boolean {
    return !!(this.statusFilter || this.roleFilter || this.searchQuery() || this.siteFilter() || this.assignedToMeOnly);
  }

  clearFilters() {
    this.statusFilter    = '';
    this.roleFilter      = '';
    this.searchQuery.set('');
    this.siteFilter.set('');
    this.assignedToMeOnly = false;
    this.resetAndLoad();
  }

  // ── State ───────────────────────────────────────────────────────────────────
  private allRows     = signal<ScheduleRow[]>([]);
  private nextCursor  = signal<string | null>(null);
  hasMore             = signal(false);
  loading             = signal(false);
  postingId           = signal<string | null>(null);
  errorMessage        = signal<string | null>(null);
  successMessage      = signal<string | null>(null);
  selectedId          = signal<string | null>(null);
  private sortState   = signal<Sort>({ active: 'date', direction: 'asc' });

  // ── Derived ─────────────────────────────────────────────────────────────────
  displayRows = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const site = this.siteFilter().toLowerCase().trim();
    let rows = this.allRows();

    if (q) {
      rows = rows.filter(r =>
        r.shiftLabel.toLowerCase().includes(q) ||
        r.location.toLowerCase().includes(q)   ||
        r.position.toLowerCase().includes(q)
      );
    }

    if (site) {
      rows = rows.filter(r => r.location.toLowerCase().includes(site));
    }

    return this.sortRows(rows, this.sortState().active, this.sortState().direction);
  });

  totalHours    = computed(() => this.displayRows().reduce((s, r) => s + r.hours, 0));
  totalEarnings = computed(() => this.displayRows().reduce((s, r) => s + r.projected, 0));
  moneyCurrency = computed(() => this.ctx.currencyCode() || 'USD');

  private toast = inject(ToastService);

  constructor() { this.resetAndLoad(); }

  // ── Data loading ─────────────────────────────────────────────────────────────
  async resetAndLoad() {
    this.nextCursor.set(null);
    this.hasMore.set(false);
    this.allRows.set([]);
    this.selectedId.set(null);
    this.errorMessage.set(null);
    await this.fetchPage(null);
  }

  async loadMore() {
    await this.fetchPage(this.nextCursor());
  }

  private async fetchPage(afterDocId: string | null) {
    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      const { start, end } = this.range();
      const res = await this.commands.listShifts({
        startAtMs:       start.getTime(),
        endAtMs:         end.getTime(),
        status:          this.statusFilter,
        requiredJobRole: this.roleFilter || undefined,
        assignedToMe:    this.assignedToMeOnly,
        limit:           PAGE_SIZE,
        afterDocId,
      });

      const incoming: ScheduleRow[] = Array.isArray(res?.items)
        ? (res.items as ListShiftItem[]).map((x) => this.toRow(x))
        : [];

      this.allRows.update(prev => afterDocId ? [...prev, ...incoming] : incoming);
      this.hasMore.set(Boolean(res?.hasMore));
      this.nextCursor.set(res?.nextCursor ?? null);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to load shifts.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────────
  selectRow(id: string) { this.selectedId.set(id); }

  selectedRow(): ScheduleRow | null {
    const id = this.selectedId();
    return this.displayRows().find((r) => r.id === id) || null;
  }

  go(path: string) {
    void this.router.navigateByUrl(path);
  }

  onSort(sort: Sort) {
    this.sortState.set(!sort.direction ? { active: 'date', direction: 'asc' } : sort);
  }

  onSearch() { this.selectedId.set(null); }

  async prevRange() {
    const { start, end } = this.range();
    const days = this.diffDays(start, end) + 1;
    this.range.set({ start: this.addDays(start, -days), end: this.addDays(end, -days) });
    await this.resetAndLoad();
  }

  async nextRange() {
    const { start, end } = this.range();
    const days = this.diffDays(start, end) + 1;
    this.range.set({ start: this.addDays(start, days), end: this.addDays(end, days) });
    await this.resetAndLoad();
  }

  async onDatePicked(ev: MatDatepickerInputEvent<Date>) {
    const d = ev.value;
    if (!d) return;
    this.range.set(this.makeRange(d));
    await this.resetAndLoad();
  }

  openPostDialog(row: ScheduleRow) {
    const ref = this.dialog.open(PostShiftDialogComponent, {
      width: '520px',
      maxWidth: '92vw',
      data: row,
    });

    ref.afterClosed().subscribe((result: { confirm: boolean; note?: string } | undefined) => {
      if (!result?.confirm) return;
      this.executePostShift(row);
    });
  }

  private async executePostShift(row: ScheduleRow) {
    this.postingId.set(row.id);
    this.successMessage.set(null);
    this.errorMessage.set(null);

    try {
      await this.commands.postShiftToMarketplace(row.id);
      // Update row in-place to avoid full reload
      this.allRows.update(rows =>
        rows.map(r => r.id === row.id
          ? { ...r, rawStatus: 'published', status: 'PUBLISHED' }
          : r
        )
      );
      this.successMessage.set(`Shift ${row.shiftLabel} published to marketplace.`);
      setTimeout(() => this.successMessage.set(null), 4000);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to publish shift.');
    } finally {
      this.postingId.set(null);
    }
  }

  badgeClass(rawStatus: string): string {
    return STATUS_BADGE[rawStatus.toUpperCase()] ?? '';
  }

  // ── Mapping ──────────────────────────────────────────────────────────────────
  private toRow(item: ListShiftItem): ScheduleRow {
    const start    = item.startAtMs ? new Date(item.startAtMs) : new Date();
    const end      = item.endAtMs   ? new Date(item.endAtMs)   : start;
    const ms       = Math.max(0, end.getTime() - start.getTime());
    const hours    = Math.round((ms / 3_600_000) * 100) / 100;
    const projected = item.payRate ? Math.round(item.payRate * hours * 100) / 100 : 0;
    const raw      = String(item.status || 'open');

    return {
      id:         item.id,
      date:       start,
      shiftLabel: this.timeLabel(start, end),
      hours,
      projected,
      position:   String(item.requiredJobRole || '—'),
      assignment: item.assignedUserId ? 'ASSIGNED' : 'OPEN',
      location:   String(item.locationName || '—'),
      rawStatus:  raw,
      status:     raw.toUpperCase(),
    };
  }

  private timeLabel(s: Date, e: Date): string {
    const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${fmt(s)} – ${fmt(e)}`;
  }

  // ── Date utils ────────────────────────────────────────────────────────────────
  makeRange(anchor: Date): DateRange {
    const start = this.startOfWeek(anchor);
    const end   = this.addDays(start, 13);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  private sortRows(rows: ScheduleRow[], active: string, dir: 'asc' | 'desc' | '') {
    if (!dir) return rows;
    const m  = dir === 'desc' ? -1 : 1;
    const by = (a: any, b: any) => (a > b ? 1 : a < b ? -1 : 0);
    return [...rows].sort((a, b) => {
      switch (active) {
        case 'date':      return m * by(a.date.getTime(), b.date.getTime());
        case 'hours':     return m * by(a.hours, b.hours);
        case 'projected': return m * by(a.projected, b.projected);
        default:          return m * by(String((a as any)[active] ?? ''), String((b as any)[active] ?? ''));
      }
    });
  }

  private startOfWeek(d: Date): Date {
    const date = new Date(d);
    const day  = date.getDay();
    date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
    return date;
  }

  private addDays(d: Date, n: number): Date {
    const x = new Date(d); x.setDate(x.getDate() + n); return x;
  }

  private diffDays(a: Date, b: Date): number {
    const aa = new Date(a); aa.setHours(0, 0, 0, 0);
    const bb = new Date(b); bb.setHours(0, 0, 0, 0);
    return Math.round((bb.getTime() - aa.getTime()) / 86_400_000);
  }

  async goToday() {
    this.range.set(this.makeRange(new Date()));
    await this.resetAndLoad();
  }

  rangeStartMonth(): string {
    return this.range().start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  calendarDays(): Date[] {
    const start = new Date(this.range().start);
    start.setDate(start.getDate() - 3);
    return Array.from({ length: 42 }, (_, i) => this.addDays(start, i));
  }

  isToday(d: Date): boolean {
    const now = new Date();
    return d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
  }

  hasShiftOn(d: Date): boolean {
    return this.allRows().some((row) =>
      row.date.getFullYear() === d.getFullYear()
      && row.date.getMonth() === d.getMonth()
      && row.date.getDate() === d.getDate()
    );
  }
}

// ─── Dialog: Post Shift ────────────────────────────────────────────────────────

@Component({
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DatePipe,
    CurrencyPipe,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDividerModule,
  ],
  template: `
    <div class="vs-dialog">
      <div class="vs-dialog-header">
        <div>
          <div class="vs-dialog-title">Share Shift to Marketplace</div>
          <div class="vs-dialog-subtitle">Once published, staff can see and claim this shift.</div>
        </div>
        <button mat-icon-button class="vs-icon-btn" (click)="close(false)" aria-label="Close">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div class="vs-dialog-alert">
        <mat-icon class="vs-alert-icon">warning_amber</mat-icon>
        <div class="vs-alert-text">
          <div class="vs-alert-head">Confirm before publishing</div>
          <div class="vs-alert-body">Staff will be notified and can claim this shift.</div>
        </div>
      </div>

      <div class="vs-shift-summary">
        <div class="vs-summary-row">
          <span class="vs-label">Date</span>
          <span class="vs-value">{{ data.date | date:'EEE, MMM d, y' }}</span>
        </div>
        <div class="vs-summary-row">
          <span class="vs-label">Shift</span>
          <span class="vs-value">{{ data.shiftLabel }} ({{ data.hours }}h)</span>
        </div>
        <div class="vs-summary-row">
          <span class="vs-label">Projected</span>
          <span class="vs-value vs-strong">{{ data.projected | currency:moneyCurrency() }}</span>
        </div>
        <mat-divider></mat-divider>
        <div class="vs-summary-row">
          <span class="vs-label">Position</span>
          <span class="vs-value">{{ data.position }}</span>
        </div>
        <div class="vs-summary-row">
          <span class="vs-label">Location</span>
          <span class="vs-value">{{ data.location }}</span>
        </div>
      </div>

      <mat-form-field appearance="outline" class="vs-note">
        <mat-label>Optional note</mat-label>
        <input matInput [(ngModel)]="note" placeholder="e.g. Please arrive 10 min early" />
      </mat-form-field>

      <div class="vs-dialog-actions">
        <button mat-button (click)="close(false)">Cancel</button>
        <button mat-flat-button class="vs-btn-primary" (click)="close(true)">
          <mat-icon>send</mat-icon>
          Publish Shift
        </button>
      </div>
    </div>
  `,
  styles: [`
    .vs-dialog { padding:6px; color:var(--text); min-width:320px; }
    .vs-dialog-header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:12px; }
    .vs-dialog-title { font-weight:900; font-size:16px; }
    .vs-dialog-subtitle { color:var(--text-muted); font-size:13px; margin-top:4px; }
    .vs-icon-btn { border-radius:14px; background:rgba(255,255,255,0.06); border:1px solid var(--border); }
    .vs-dialog-alert {
      display:flex; gap:10px; align-items:flex-start; padding:12px; border-radius:14px;
      border:1px solid rgba(255,191,102,0.35); background:rgba(255,191,102,0.10); margin-bottom:12px;
    }
    .vs-alert-icon { margin-top:1px; }
    .vs-alert-head { font-weight:900; }
    .vs-alert-body { color:var(--text-muted); margin-top:2px; font-size:13px; }
    .vs-shift-summary {
      border:1px solid var(--border); background:rgba(255,255,255,0.06); border-radius:14px;
      padding:12px; display:flex; flex-direction:column; gap:8px; margin-bottom:12px;
    }
    .vs-summary-row { display:flex; justify-content:space-between; gap:12px; font-size:13px; }
    .vs-label { color:var(--text-muted); }
    .vs-value { color:var(--text); text-align:right; }
    .vs-strong { font-weight:900; }
    .vs-note { width:100%; }
    .vs-dialog-actions { margin-top:6px; display:flex; justify-content:flex-end; gap:10px; }
  `],
})
export class PostShiftDialogComponent {
  private ref = inject(MatDialogRef<PostShiftDialogComponent>);
  private ctx = inject(OrgContextService);
  note = '';

  @Inject(MAT_DIALOG_DATA) data!: ScheduleRow;

  close(confirm: boolean) {
    this.ref.close(confirm
      ? { confirm: true, note: this.note?.trim() || undefined }
      : { confirm: false }
    );
  }

  moneyCurrency() {
    return this.ctx.currencyCode() || 'USD';
  }
}
