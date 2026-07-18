import { Component, OnDestroy, effect, EffectRef, signal, inject, Inject } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { MessagesRepo } from '../../core/repos/messages.repo';
import { NotificationsRepo, UserNotification } from '../../core/repos/notifications.repo';
import { UsersRepo } from '../../core/repos/users.repo';
import { ShiftsCommands } from '../../core/commands/shifts.commands';
import { ToastService } from '../../core/ui/toast.service';
import { AccrualBalance, AccrualsRepo, TimeOffRequest } from '../../core/repos/accruals.repo';

import { Shift } from '../../shared/models/shift.model';
import { OrgMessage } from '../../shared/models/message.model';
import { formatDateTime } from '../../shared/utils/date.util';
import { mapAttendancePolicyError } from '../../shared/utils/attendance-policy-error.util';
import { profileCompletion } from '../../shared/utils/profile-completion.util';

export type ShiftSwapRequestRow = {
  requestId: string;
  status: string;
  kind: string;
  shiftId: string;
  shiftTitle: string;
  sourceStartAtMs: number;
  sourceEndAtMs: number;
  requesterUid: string;
  requesterName: string;
  targetUid: string;
  targetName: string;
  targetShiftId?: string | null;
  targetShiftTitle?: string | null;
  targetStartAtMs?: number | null;
  targetEndAtMs?: number | null;
  createdAtMs: number;
};

export type ShiftSwapCandidateShift = {
  id: string;
  title: string;
  locationName: string;
  startAtMs: number;
  endAtMs: number;
  requiredJobRole?: string | null;
};

export type ShiftSwapMatchLabel = 'great_fit' | 'conflict' | 'tight_turnaround';

export type ShiftSwapCandidate = {
  uid: string;
  displayName: string;
  email?: string | null;
  jobRole?: string | null;
  canCoverSource: boolean;
  shifts: ShiftSwapCandidateShift[];
  match?: { score: number; label: ShiftSwapMatchLabel; hasConflict: boolean };
};

@Component({
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatDialogModule,
  ],
  template: `
    <div class="staff-home">
      <section class="staff-welcome">
        <div class="staff-avatar">{{ staffInitials() }}</div>
        <div>
          <div class="staff-welcome-title">Welcome back, {{ staffFirstName() }}</div>
          <div class="staff-welcome-sub" *ngIf="orgId()">Staff workspace</div>
          <div class="staff-welcome-sub" *ngIf="!orgId()">Missing org context. Contact your administrator.</div>
        </div>
      </section>

      <div *ngIf="!orgId()" class="staff-alert">
        <mat-icon>warning_amber</mat-icon>
        Missing organization context.
      </div>

      <section class="staff-premium-strip" *ngIf="orgId()">
        <button class="staff-premium-item" type="button" (click)="go('/app/onboarding')"
                [class.is-attention]="profileReadiness().score < 100">
          <span class="staff-premium-icon"><mat-icon>task_alt</mat-icon></span>
          <span>
            <strong>Onboarding Center</strong>
            <small>Profile, documents, payroll, PTO</small>
          </span>
          <mat-icon>chevron_right</mat-icon>
        </button>
        <button class="staff-premium-item" type="button" (click)="go('/app/profile')"
                [class.is-attention]="profileReadiness().score < 100">
          <span class="staff-premium-icon"><mat-icon>verified_user</mat-icon></span>
          <span>
            <strong>{{ profileReadiness().score }}% Profile Ready</strong>
            <small>{{ profileReadinessLabel() }}</small>
          </span>
          <mat-icon>chevron_right</mat-icon>
        </button>
        <button class="staff-premium-item" type="button" (click)="go('/app/documents')">
          <span class="staff-premium-icon"><mat-icon>folder_shared</mat-icon></span>
          <span>
            <strong>Document Center</strong>
            <small>W-4, W-2, payslips, dependents</small>
          </span>
          <mat-icon>chevron_right</mat-icon>
        </button>
        <button class="staff-premium-item" type="button" (click)="go('/app/accruals')"
                [class.is-attention]="pendingTimeOffCount() > 0">
          <span class="staff-premium-icon"><mat-icon>event_available</mat-icon></span>
          <span>
            <strong>{{ pendingTimeOffCount() }} PTO Pending</strong>
            <small>{{ approvedTimeOffCount() }} approved request(s)</small>
          </span>
          <mat-icon>chevron_right</mat-icon>
        </button>
        <button class="staff-premium-item" type="button" (click)="go('/app/notifications')"
                [class.is-attention]="unreadNotificationCount() > 0">
          <span class="staff-premium-icon"><mat-icon>notifications_active</mat-icon></span>
          <span>
            <strong>{{ unreadNotificationCount() }} Unread</strong>
            <small>Messages, approvals, shift updates</small>
          </span>
          <mat-icon>chevron_right</mat-icon>
        </button>
      </section>

      <section class="staff-card-grid" *ngIf="orgId()">
        <article class="staff-card staff-actions-card">
          <div class="staff-card-head">
            <h2>Manage My Schedule</h2>
            <button class="staff-icon-link" (click)="go('/app/schedule')" aria-label="Open schedule">
              <mat-icon>arrow_forward</mat-icon>
            </button>
          </div>
          <div class="staff-action-grid">
            <button class="staff-action" (click)="openFirstSwitchableShift()">
              <mat-icon>sync_alt</mat-icon>
              <span>Swap my shift</span>
            </button>
            <button class="staff-action" (click)="go('/app/marketplace')">
              <mat-icon>add_to_queue</mat-icon>
              <span>Pick up an open shift</span>
            </button>
            <button class="staff-action" (click)="go('/app/schedule')">
              <mat-icon>calendar_month</mat-icon>
              <span>Build my schedule</span>
            </button>
            <button class="staff-action" (click)="go('/app/availability')">
              <mat-icon>event_available</mat-icon>
              <span>Change my availability</span>
            </button>
            <button class="staff-action" (click)="go('/app/payroll')">
              <mat-icon>payments</mat-icon>
              <span>View my payroll</span>
            </button>
            <button class="staff-action" (click)="go('/app/attendance')">
              <mat-icon>receipt_long</mat-icon>
              <span>Timecard inquiry</span>
            </button>
          </div>
        </article>

        <article class="staff-card staff-notifications-card">
          <div class="staff-card-head">
            <h2>My Notifications</h2>
            <button class="staff-icon-link" (click)="go('/app/notifications')" aria-label="Open notifications">
              <mat-icon>arrow_forward</mat-icon>
            </button>
          </div>
          <button class="staff-notification-row" (click)="go('/app/notifications')">
            <span>My Requests</span><strong>{{ outgoingSwapCount() }}</strong><mat-icon>chevron_right</mat-icon>
          </button>
          <button class="staff-notification-row" (click)="go('/app/messages')">
            <span>Notices</span><strong>{{ messages().length }}</strong><mat-icon>chevron_right</mat-icon>
          </button>
          <button class="staff-notification-row" (click)="go('/app/marketplace')">
            <span>Open Shift Available</span><strong>{{ openShifts().length }}</strong><mat-icon>chevron_right</mat-icon>
          </button>
          <button class="staff-notification-row" (click)="go('/app/schedule')">
            <span>Shift Swap</span><strong>{{ incomingSwapCount() }}</strong><mat-icon>chevron_right</mat-icon>
          </button>
          <button class="staff-notification-row" (click)="go('/app/notifications')">
            <span>System Messages</span><strong>{{ notificationCount() }}</strong><mat-icon>chevron_right</mat-icon>
          </button>
        </article>

        <article class="staff-card staff-schedule-card">
          <div class="staff-card-head">
            <h2>My Schedule</h2>
            <button class="staff-icon-link" (click)="go('/app/schedule')" aria-label="Open my schedule">
              <mat-icon>arrow_forward</mat-icon>
            </button>
          </div>
          <ng-container *ngIf="nextShift() as s; else noNextShift">
            <div class="staff-day-chip">
              <span>{{ shortWeekday(s.startAt) }}</span>
              <strong>{{ dayNumber(s.startAt) }}</strong>
            </div>
            <div class="staff-shift-title">{{ s.title || 'Day shift' }}</div>
            <div class="staff-shift-time">{{ fmtTimeRange(s.startAt, s.endAt) }} [{{ calcHours(s.startAt, s.endAt) }}h]</div>
            <div class="staff-shift-meta">
              <mat-icon>local_activity</mat-icon>
              <span>{{ s.locationName || 'Location pending' }}</span>
            </div>
            <div class="staff-shift-meta">
              <mat-icon>school</mat-icon>
              <span>{{ s.requiredJobRole || 'Education' }}</span>
            </div>
            <div class="staff-card-actions">
              <button class="staff-pill" (click)="openShiftDialog(s, 'assigned')">View shift</button>
              <button class="staff-pill staff-pill-primary" *ngIf="canSwitchShift(s)" (click)="openSwapDialog(s)">Swap</button>
            </div>
          </ng-container>
          <ng-template #noNextShift>
            <div class="staff-empty">No assigned shift in the next 14 days.</div>
            <button class="staff-pill staff-pill-primary" (click)="go('/app/marketplace')">Find open shifts</button>
          </ng-template>
        </article>

        <article class="staff-card staff-accrual-card">
          <div class="staff-card-head">
            <h2>My Accruals</h2>
            <button class="staff-icon-link" (click)="go('/app/accruals')" aria-label="Open accruals">
              <mat-icon>more_vert</mat-icon>
            </button>
          </div>
          <div class="staff-accrual-balance">
            <span>Balance as of Today</span>
            <strong>SICK</strong>
          </div>
          <div class="staff-accrual-row">
            <span>PTO</span>
            <strong>{{ ptoBalance() }} h</strong>
          </div>
          <div class="staff-accrual-row">
            <span>Sick</span>
            <strong>{{ sickBalance() }} h</strong>
          </div>
          <div class="staff-accrual-row">
            <span>Taken to Date</span>
            <strong>{{ takenToDate() }} h</strong>
          </div>
          <button class="staff-timeoff-link" (click)="go('/app/accruals')">
            Time-Off Request <mat-icon>chevron_right</mat-icon>
          </button>
        </article>
      </section>
    </div>
  `,
  styleUrl: './employee-dashboard.page.scss',
})
export class EmployeeDashboardPage implements OnDestroy {
  // Signals rather than plain fields: these are written from inside Firestore
  // snapshot callbacks, and signal writes reliably schedule a re-render even
  // if the callback's zone re-entry timing is ever imperfect — plain-field
  // mutations rely entirely on a zone-triggered tick() happening promptly.
  orgId = signal<string | null>(null);
  uid = signal<string | null>(null);

  lookahead = signal<Shift[]>([]);
  openShifts = signal<Shift[]>([]);
  messages = signal<OrgMessage[]>([]);
  notifications = signal<UserNotification[]>([]);
  timeOffRequests = signal<TimeOffRequest[]>([]);
  profileUser = signal<any>(null);
  swapRequests = signal<ShiftSwapRequestRow[]>([]);
  accrualBalance = signal<AccrualBalance>({
    uid: '',
    orgId: '',
    ptoBalance: 0,
    sickBalance: 0,
    ptoTaken: 0,
    sickTaken: 0,
    plannedPto: 0,
    plannedSick: 0,
  });

  selectedAssignedId = signal<string | null>(null);
  selectedOpenId = signal<string | null>(null);
  claimingId = signal<string | null>(null);
  swapBusyId = signal<string | null>(null);
  swapListBusy = signal(false);

  assignedColumns: string[] = ['date', 'shift', 'hours', 'projected', 'position', 'location', 'action'];
  openColumns: string[] = ['date', 'shift', 'hours', 'projected', 'position', 'location', 'action'];

  private unsub: Array<() => void> = [];
  private effectRef?: EffectRef;

  constructor(
    private ctx: OrgContextService,
    private shifts: ShiftsRepo,
    private msgs: MessagesRepo,
    private notificationsRepo: NotificationsRepo,
    private usersRepo: UsersRepo,
    private dialog: MatDialog,
    private commands: ShiftsCommands,
    private accruals: AccrualsRepo,
    private toast: ToastService,
    private router: Router
  ) {
    this.effectRef = effect(() => {
      const orgId = this.ctx.orgId();
      const uid = this.ctx.uid();

      this.orgId.set(orgId);
      this.uid.set(uid);

      this.cleanup();

      if (!orgId || !uid) {
        this.lookahead.set([]);
        this.openShifts.set([]);
        this.messages.set([]);
        this.notifications.set([]);
        this.timeOffRequests.set([]);
        this.profileUser.set(null);
        this.swapRequests.set([]);
        this.accrualBalance.set(this.accruals.emptyBalance('', ''));
        return;
      }

      this.accrualBalance.set(this.accruals.emptyBalance(orgId, uid));

      this.unsub.push(
        this.shifts.watchLookahead(orgId, uid, (items) => {
          this.lookahead.set(items || []);
        })
      );

      this.unsub.push(
        this.shifts.watchOpenShifts(orgId, (items) => {
          this.openShifts.set(items || []);
        })
      );

      this.unsub.push(
        this.msgs.watchLatest(orgId, (items) => {
          this.messages.set(items || []);
        })
      );

      this.unsub.push(
        this.notificationsRepo.watchMy(orgId, uid, (items) => {
          this.notifications.set(items || []);
        }, 75)
      );

      this.unsub.push(
        this.accruals.watchRequests(orgId, uid, (items) => {
          this.timeOffRequests.set(items || []);
        })
      );

      this.unsub.push(
        this.usersRepo.watchOrgUser(orgId, uid, (item) => {
          this.profileUser.set(item);
        })
      );

      this.unsub.push(
        this.accruals.watchBalance(orgId, uid, (balance) => {
          this.accrualBalance.set(balance);
        })
      );

      void this.refreshSwapRequests();
    });
  }

  ngOnDestroy() {
    this.cleanup();
    this.effectRef?.destroy();
  }

  private cleanup() {
    this.unsub.forEach(u => u());
    this.unsub = [];
  }

  // ✅ Dialog open on row click OR on action button
  openShiftDialog(s: Shift, mode: 'assigned' | 'open') {
    if (mode === 'assigned') this.selectedAssignedId.set(s.id);
    else this.selectedOpenId.set(s.id);

    const ref = this.dialog.open(ShiftDetailsDialogComponent, {
      width: '640px',
      maxWidth: '92vw',
      data: { shift: s, mode } as ShiftDetailsDialogData,
    });

    ref.afterClosed().subscribe((res: any) => {
      if (!res) return;
      if (res.action === 'request') this.requestShift(s);
      if (res.action === 'view') this.viewShift(s);
    });
  }

  async viewShift(s: Shift) {
    await this.router.navigate(['/app/shift-chat'], { queryParams: { shiftId: s.id } });
  }

  async requestShift(s: Shift) {
    if (!s?.id || this.claimingId()) return;
    this.claimingId.set(s.id);
    try {
      await this.commands.claimShift(s.id);
      this.toast.success('Shift claimed. It is now on your schedule.');
      await this.router.navigate(['/app/shift-chat'], { queryParams: { shiftId: s.id } });
    } catch (e: any) {
      this.toast.errorFrom(e, mapAttendancePolicyError(e, 'Shift request failed.'));
    } finally {
      this.claimingId.set(null);
    }
  }

  async refreshSwapRequests() {
    if (!this.orgId() || !this.uid()) {
      this.swapRequests.set([]);
      return;
    }

    this.swapListBusy.set(true);
    try {
      const res = await this.commands.listShiftSwapRequests('', 100);
      this.swapRequests.set(Array.isArray(res?.items) ? res.items : []);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to load shift switch requests.');
    } finally {
      this.swapListBusy.set(false);
    }
  }

  canSwitchShift(s: Shift): boolean {
    if (!this.uid() || !s?.id) return false;
    const status = String(s.status || '').toLowerCase();
    const endMs = this.toDate(s.endAt).getTime();
    return s.assignedUserId === this.uid()
      && (status === 'assigned' || status === 'claimed')
      && endMs > Date.now();
  }

  async openSwapDialog(s: Shift) {
    if (!this.canSwitchShift(s) || this.swapBusyId()) return;
    this.swapBusyId.set(s.id);
    try {
      const res = await this.commands.listShiftSwapCandidates(s.id);
      const ref = this.dialog.open(ShiftSwapDialogComponent, {
        width: '720px',
        maxWidth: '94vw',
        data: {
          shift: s,
          candidates: Array.isArray(res?.candidates) ? res.candidates : [],
        } as ShiftSwapDialogData,
      });

      this.swapBusyId.set(null);
      ref.afterClosed().subscribe(async (result: any) => {
        if (!result?.targetUid) return;
        this.swapBusyId.set(s.id);
        try {
          await this.commands.requestShiftSwap({
            shiftId: s.id,
            targetUid: result.targetUid,
            targetShiftId: result.targetShiftId || null,
            note: result.note || null,
          });
          this.toast.success(result.targetShiftId ? 'Shift trade request sent.' : 'Shift cover request sent.');
          await this.refreshSwapRequests();
        } catch (e: any) {
          this.toast.errorFrom(e, 'Shift switch request failed.');
        } finally {
          this.swapBusyId.set(null);
        }
      });
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to load switch candidates.');
      this.swapBusyId.set(null);
    }
  }

  async respondSwapRequest(r: ShiftSwapRequestRow, decision: 'accept' | 'reject' | 'cancel') {
    if (!r?.requestId || this.swapBusyId()) return;
    this.swapBusyId.set(r.requestId);
    try {
      await this.commands.respondShiftSwap(r.requestId, decision);
      const msg = decision === 'accept'
        ? 'Shift switch approved.'
        : decision === 'reject'
          ? 'Shift switch declined.'
          : 'Shift switch cancelled.';
      this.toast.success(msg);
      await this.refreshSwapRequests();
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to update shift switch request.');
    } finally {
      this.swapBusyId.set(null);
    }
  }

  isIncomingSwap(r: ShiftSwapRequestRow): boolean {
    return r?.status === 'pending' && r?.targetUid === this.uid();
  }

  isOutgoingSwap(r: ShiftSwapRequestRow): boolean {
    return r?.status === 'pending' && r?.requesterUid === this.uid();
  }

  swapKindLabel(r: ShiftSwapRequestRow): string {
    return r?.kind === 'swap' ? 'Trade' : 'Cover';
  }

  swapCounterparty(r: ShiftSwapRequestRow): string {
    if (!r) return '-';
    if (r.requesterUid === this.uid()) return r.targetName || 'Staff';
    return r.requesterName || r.requesterUid || '-';
  }

  swapStatusClass(status: string): string {
    switch (String(status || '').toLowerCase()) {
      case 'approved': return 'vs-badge--success';
      case 'pending': return 'vs-badge--warning';
      case 'rejected':
      case 'cancelled': return 'vs-badge--danger';
      default: return 'vs-badge--neutral';
    }
  }

  go(path: string) {
    void this.router.navigateByUrl(path);
  }

  staffFirstName(): string {
    const raw = String(this.ctx.displayName() || this.ctx.email() || 'Staff').trim();
    return raw.includes('@') ? raw.split('@')[0] : raw.split(/\s+/)[0];
  }

  staffInitials(): string {
    const raw = String(this.ctx.displayName() || this.ctx.email() || 'VS').trim();
    const cleaned = raw.includes('@') ? raw.split('@')[0] : raw;
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return cleaned.slice(0, 2).toUpperCase();
  }

  nextShift(): Shift | null {
    const now = Date.now();
    return [...this.lookahead()]
      .filter((s) => this.toDate(s.endAt).getTime() >= now)
      .sort((a, b) => this.toDate(a.startAt).getTime() - this.toDate(b.startAt).getTime())[0] || null;
  }

  openFirstSwitchableShift() {
    const shift = this.lookahead().find((s) => this.canSwitchShift(s));
    if (shift) {
      void this.openSwapDialog(shift);
      return;
    }
    this.go('/app/schedule');
  }

  incomingSwapCount(): number {
    return this.swapRequests().filter((r) => this.isIncomingSwap(r)).length;
  }

  outgoingSwapCount(): number {
    return this.swapRequests().filter((r) => this.isOutgoingSwap(r)).length;
  }

  notificationCount(): number {
    return this.messages().length + this.swapRequests().length;
  }

  unreadNotificationCount(): number {
    return this.notifications().filter((n) => !n.read).length;
  }

  pendingTimeOffCount(): number {
    return this.timeOffRequests().filter((r) => r.status === 'pending').length;
  }

  approvedTimeOffCount(): number {
    return this.timeOffRequests().filter((r) => r.status === 'approved').length;
  }

  profileReadiness() {
    return profileCompletion(this.profileUser() || {
      displayName: this.ctx.displayName(),
      email: this.ctx.email(),
      jobRole: this.ctx.jobRole(),
    });
  }

  profileReadinessLabel(): string {
    const c = this.profileReadiness();
    if (c.score >= 100) return 'Ready for payroll and HR';
    const next = c.missing.slice(0, 2).join(', ');
    return next ? `Missing ${next}` : 'Needs review';
  }

  ptoBalance(): number {
    return this.accrualBalance().ptoBalance;
  }

  sickBalance(): number {
    return this.accrualBalance().sickBalance;
  }

  takenToDate(): number {
    return Math.round((this.accrualBalance().ptoTaken + this.accrualBalance().sickTaken) * 10) / 10;
  }

  shortWeekday(ts: any): string {
    return this.toDate(ts).toLocaleDateString('en-US', { weekday: 'short' });
  }

  dayNumber(ts: any): string {
    return this.toDate(ts).toLocaleDateString('en-US', { day: 'numeric' });
  }

  // ===== Display helpers =====
  fmt(ts: any) { return formatDateTime(ts); }

  private toDate(ts: any): Date {
    if (!ts) return new Date(0);
    if (ts instanceof Date) return ts;
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
    return new Date(ts);
  }

  fmtDateOnly(ts: any): string {
    const d = this.toDate(ts);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
  }

  fmtTime(ts: any): string {
    const d = this.toDate(ts);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  fmtTimeRange(startAt: any, endAt: any): string {
    return `${this.fmtTime(startAt)} - ${this.fmtTime(endAt)}`;
  }

  fmtMs(ms: any): string {
    const n = Number(ms || 0);
    if (!Number.isFinite(n) || n <= 0) return '-';
    return new Date(n).toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  fmtMsRange(startMs: any, endMs: any): string {
    const start = this.fmtMs(startMs);
    const end = Number(endMs || 0);
    const endLabel = Number.isFinite(end) && end > 0
      ? new Date(end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : '-';
    return `${start} - ${endLabel}`;
  }

  calcHours(startAt: any, endAt: any): number {
    const a = this.toDate(startAt).getTime();
    const b = this.toDate(endAt).getTime();
    const h = (b - a) / (1000 * 60 * 60);
    return Math.max(0, Math.round(h * 100) / 100);
  }

  calcProjected(s: Shift): number {
    const hours = this.calcHours(s.startAt, s.endAt);
    const rate = s.payRate ?? 0;
    return Math.round(hours * rate * 100) / 100;
  }

}

/** ===================== DIALOG ===================== */

export type ShiftDetailsDialogData = {
  shift: Shift;
  mode: 'assigned' | 'open';
};

@Component({
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    CurrencyPipe,
    MatDialogModule,
    MatIconModule
  ],
  template: `
    <div class="vs-dialog">
      <div class="vs-dialog-header">
        <div>
          <div class="vs-dialog-title">Shift Details</div>
          <div class="vs-dialog-subtitle">
            {{ data.mode === 'assigned' ? 'Assigned shift' : 'Open shift' }} &bull; Status: <span class="vs-badge" [ngClass]="data.shift.status==='assigned' ? 'vs-badge--success' : 'vs-badge--warning'">{{ data.shift.status }}</span>
          </div>
        </div>
        <button class="vs-btn-secondary" style="padding:6px;border-radius:50%;border:none;background:rgba(255,255,255,0.05);" (click)="close()">
          <mat-icon style="color:var(--text-muted);font-size:20px;width:20px;height:20px;">close</mat-icon>
        </button>
      </div>

      <div class="vs-dialog-body" style="padding:24px;">
        
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div style="display:flex;justify-content:space-between;">
            <div style="font-size:13px;color:var(--text-subtle);">Title</div>
            <div style="font-size:15px;font-weight:600;">{{ data.shift.title }}</div>
          </div>
          
          <div style="display:flex;justify-content:space-between;">
            <div style="font-size:13px;color:var(--text-subtle);">Location</div>
            <div style="font-size:15px;font-weight:600;">{{ data.shift.locationName }}</div>
          </div>
          
          <div style="display:flex;justify-content:space-between;">
            <div style="font-size:13px;color:var(--text-subtle);">Date</div>
            <div style="font-size:15px;font-weight:600;">{{ toDate(data.shift.startAt) | date:'EEE, MMM d, y' }}</div>
          </div>
          
          <div style="display:flex;justify-content:space-between;">
            <div style="font-size:13px;color:var(--text-subtle);">Time</div>
            <div style="font-size:15px;font-weight:600;">{{ toDate(data.shift.startAt) | date:'h:mm a' }} &ndash; {{ toDate(data.shift.endAt) | date:'h:mm a' }}</div>
          </div>
          
          <div style="display:flex;justify-content:space-between;">
            <div style="font-size:13px;color:var(--text-subtle);">Hours</div>
            <div style="font-size:15px;font-weight:600;">{{ hours(data.shift.startAt, data.shift.endAt) }} hrs</div>
          </div>
          
          <div style="display:flex;justify-content:space-between;">
            <div style="font-size:13px;color:var(--text-subtle);">Role</div>
            <div style="font-size:15px;font-weight:600;">{{ data.shift.requiredJobRole || '&mdash;' }}</div>
          </div>
          
          <div style="display:flex;justify-content:space-between;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">
            <div style="font-size:13px;color:var(--text-subtle);">Pay Rate</div>
            <div style="font-size:15px;font-weight:600;">{{ (data.shift.payRate ?? 0) | currency:moneyCurrency() }} / hr</div>
          </div>
          
          <div style="display:flex;justify-content:space-between;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.1);">
            <div style="font-size:13px;color:var(--text-subtle);">Projected</div>
            <div style="font-size:18px;font-weight:900;color:var(--success);">{{ projected(data.shift) | currency:moneyCurrency() }}</div>
          </div>

          <div *ngIf="data.shift.notes" style="background:rgba(255,255,255,0.02);padding:16px;border-radius:8px;">
            <div style="font-size:11px;color:var(--text-subtle);text-transform:uppercase;margin-bottom:6px;font-weight:700;">Notes</div>
            <div style="font-size:14px;color:var(--text);line-height:1.5;">{{ data.shift.notes }}</div>
          </div>
        </div>

      </div>

      <div class="vs-dialog-footer" style="padding:16px 24px;border-top:1px solid rgba(255,255,255,0.1);display:flex;justify-content:flex-end;gap:12px;background:rgba(0,0,0,0.2);">
        <button class="vs-btn-secondary" (click)="close()">Close</button>

        <button *ngIf="data.mode === 'open'" class="vs-btn-primary" (click)="confirmRequest()">
          <mat-icon>how_to_reg</mat-icon> Request Shift
        </button>

        <button *ngIf="data.mode === 'assigned'" class="vs-btn-primary" (click)="confirmView()">
          <mat-icon>visibility</mat-icon> View
        </button>
      </div>
    </div>
  `,
})
export class ShiftDetailsDialogComponent {
  private ref = inject(MatDialogRef<ShiftDetailsDialogComponent>);
  private ctx = inject(OrgContextService);
  // ✅ Inject dialog data properly using inject()
  public data = inject<ShiftDetailsDialogData>(MAT_DIALOG_DATA);

  close() {
    this.ref.close({ action: 'close' });
  }

  confirmRequest() {
    this.ref.close({ action: 'request', shiftId: this.data.shift.id });
  }

  confirmView() {
    this.ref.close({ action: 'view', shiftId: this.data.shift.id });
  }

  // ✅ MUST be public for template access
  toDate(ts: any): Date {
    if (!ts) return new Date(0);
    if (ts instanceof Date) return ts;
    if (typeof ts.toDate === 'function') return ts.toDate(); // Firestore Timestamp
    if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
    return new Date(ts);
  }

  // ✅ MUST be public for template access
  hours(startAt: any, endAt: any): number {
    const a = this.toDate(startAt).getTime();
    const b = this.toDate(endAt).getTime();
    const h = (b - a) / (1000 * 60 * 60);
    return Math.max(0, Math.round(h * 100) / 100);
  }

  // Public is fine
  projected(s: Shift): number {
    const h = this.hours(s.startAt, s.endAt);
    const rate = s.payRate ?? 0;
    return Math.round(h * rate * 100) / 100;
  }

  moneyCurrency() {
    return this.ctx.currencyCode() || 'USD';
  }
}

export type ShiftSwapDialogData = {
  shift: Shift;
  candidates: ShiftSwapCandidate[];
};

@Component({
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatIconModule,
  ],
  template: `
    <div class="vs-dialog shift-switch-dialog">
      <div class="vs-dialog-header">
        <div>
          <div class="vs-dialog-title">Switch Shift</div>
          <div class="vs-dialog-subtitle">Ask another staff member to cover this shift, or trade for one of theirs.</div>
        </div>
        <button class="vs-btn-secondary shift-switch-close" (click)="close()" aria-label="Close">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div class="vs-dialog-body shift-switch-body">
        <div class="shift-switch-source">
          <div>
            <div class="shift-switch-kicker">Your shift</div>
            <div class="shift-switch-title">{{ data.shift.title }}</div>
            <div class="shift-switch-meta">{{ data.shift.locationName }} - {{ fmtDateRange(data.shift.startAt, data.shift.endAt) }}</div>
          </div>
          <span class="vs-badge vs-badge--primary">{{ data.shift.requiredJobRole || 'Role open' }}</span>
        </div>

        <div *ngIf="data.candidates.length === 0" class="shift-switch-empty">
          No compatible staff are available for this shift yet.
        </div>

        <div *ngIf="data.candidates.length > 0" class="shift-switch-form">
          <label class="shift-switch-field">
            <span>Staff member</span>
            <select class="vs-select" [(ngModel)]="targetUid" (ngModelChange)="targetShiftId = ''">
              <option value="">Select staff</option>
              <option *ngFor="let c of data.candidates" [value]="c.uid">
                {{ c.displayName }} - {{ c.jobRole || 'No role' }} ({{ matchText(c) }})
              </option>
            </select>
          </label>

          <div *ngIf="selectedCandidate() as c" class="shift-switch-person">
            <div>
              <div class="shift-switch-title">{{ c.displayName }}</div>
              <div class="shift-switch-meta">{{ c.email || 'Email not set' }} - {{ c.jobRole || 'No role' }}</div>
            </div>
            <span class="vs-badge" [ngClass]="matchBadgeClass(c)">{{ matchText(c) }}</span>
          </div>

          <label *ngIf="selectedCandidate() as c" class="shift-switch-field">
            <span>Request type</span>
            <select class="vs-select" [(ngModel)]="targetShiftId">
              <option value="">Ask {{ c.displayName }} to cover my shift</option>
              <option *ngFor="let s of c.shifts" [value]="s.id">
                Trade for {{ s.title }} - {{ fmtMsRange(s.startAtMs, s.endAtMs) }}
              </option>
            </select>
          </label>

          <label class="shift-switch-field">
            <span>Note</span>
            <textarea class="vs-input"
                      rows="4"
                      maxlength="1000"
                      [(ngModel)]="note"
                      placeholder="Optional message for the other staff member"></textarea>
          </label>
        </div>
      </div>

      <div class="vs-dialog-footer">
        <button class="vs-btn-secondary" (click)="close()">Close</button>
        <button class="vs-btn-primary"
                [disabled]="!targetUid"
                (click)="submit()">
          <mat-icon>send</mat-icon>
          Send Request
        </button>
      </div>
    </div>
  `,
  styles: [`
    .shift-switch-dialog {
      min-width: min(680px, 92vw);
    }

    .shift-switch-close {
      padding: 6px;
      border-radius: 50%;
      min-width: 34px;
      width: 34px;
      height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .shift-switch-close mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .shift-switch-body {
      display: grid;
      gap: 16px;
    }

    .shift-switch-source,
    .shift-switch-person {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: rgba(255,255,255,0.04);
    }

    .shift-switch-kicker {
      color: var(--text-subtle);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 5px;
    }

    .shift-switch-title {
      color: var(--text);
      font-size: 15px;
      font-weight: 900;
    }

    .shift-switch-meta {
      color: var(--text-muted);
      font-size: 12px;
      margin-top: 5px;
      line-height: 1.4;
    }

    .shift-switch-empty {
      padding: 20px;
      text-align: center;
      color: var(--text-muted);
      border: 1px dashed var(--border);
      border-radius: var(--radius);
    }

    .shift-switch-form {
      display: grid;
      gap: 14px;
    }

    .shift-switch-field {
      display: grid;
      gap: 7px;
      color: var(--text);
      font-size: 13px;
      font-weight: 800;
    }
  `],
})
export class ShiftSwapDialogComponent {
  private ref = inject(MatDialogRef<ShiftSwapDialogComponent>);
  public data = inject<ShiftSwapDialogData>(MAT_DIALOG_DATA);

  targetUid = '';
  targetShiftId = '';
  note = '';

  close() {
    this.ref.close(null);
  }

  submit() {
    if (!this.targetUid) return;
    this.ref.close({
      targetUid: this.targetUid,
      targetShiftId: this.targetShiftId || null,
      note: this.note.trim() || null,
    });
  }

  selectedCandidate(): ShiftSwapCandidate | null {
    return this.data.candidates.find((c) => c.uid === this.targetUid) || null;
  }

  matchText(c: ShiftSwapCandidate): string {
    switch (c.match?.label) {
      case 'conflict': return 'Schedule conflict';
      case 'tight_turnaround': return 'Tight turnaround';
      default: return 'Great fit';
    }
  }

  matchBadgeClass(c: ShiftSwapCandidate): string {
    switch (c.match?.label) {
      case 'conflict': return 'vs-badge--danger';
      case 'tight_turnaround': return 'vs-badge--warning';
      default: return 'vs-badge--success';
    }
  }

  fmtDateRange(startAt: any, endAt: any): string {
    const start = this.toDate(startAt);
    const end = this.toDate(endAt);
    return `${start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' })} ${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }

  fmtMsRange(startMs: any, endMs: any): string {
    const start = Number(startMs || 0);
    const end = Number(endMs || 0);
    if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end) || end <= 0) return '-';
    const s = new Date(start);
    const e = new Date(end);
    return `${s.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })} ${s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${e.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }

  private toDate(ts: any): Date {
    if (!ts) return new Date(0);
    if (ts instanceof Date) return ts;
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
    return new Date(ts);
  }
}
