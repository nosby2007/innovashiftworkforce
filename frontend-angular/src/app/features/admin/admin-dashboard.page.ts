import { Component, OnDestroy, computed, effect, EffectRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { TimeEntriesRepo } from '../../core/repos/time-entries.repo';
import { AdminCommands } from '../../core/commands/admin.commands';
import { MetricsRepo, OrgMetricsSummary } from '../../core/repos/metrics.repo';
import { UsersRepo, OrgUser } from '../../core/repos/users.repo';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { ShiftsCommands } from '../../core/commands/shifts.commands';
import { AccrualsRepo, TimeOffRequest } from '../../core/repos/accruals.repo';
import { TimeEntry } from '../../shared/models/time-entry.model';
import { Shift, ShiftStatus } from '../../shared/models/shift.model';
import { formatDateTime, tsToDate } from '../../shared/utils/date.util';
import { ToastService } from '../../core/ui/toast.service';
import { PlanEntitlementsService } from '../../core/tenancy/plan-entitlements.service';
import { fmtShiftDate, fmtShiftTime, getCurrentWeekRange } from '../../shared/utils/shift-lifecycle.utils';
import { payrollHours } from '../../shared/utils/payroll.util';
import { Timestamp } from 'firebase/firestore';
import { profileCompletion } from '../../shared/utils/profile-completion.util';
import { TableListController } from '../../shared/ui/table-list/table-list.controller';
import { TablePaginatorComponent } from '../../shared/ui/table-list/table-paginator.component';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatIconModule, MatButtonModule, TablePaginatorComponent],
  template: `
    <div class="vs-page-pad admin-brand-page">

      <!-- Page Header -->
      <div class="admin-brand-hero">
        <div>
          <div class="admin-brand-kicker">Staff Operations Center</div>
          <h1>Admin Dashboard</h1>
          <p *ngIf="orgId">Coordinate schedules, requests, timecards, and staff messages for your organization.</p>
          <p *ngIf="!orgId">Missing organization context. Contact a Super Admin to provision your account.</p>
        </div>
        <div class="admin-brand-actions">
          <a routerLink="/admin/employees" class="ad-hero-btn">
            <mat-icon>people</mat-icon> Employees
          </a>
          <a routerLink="/admin/readiness" class="ad-hero-btn">
            <mat-icon>health_and_safety</mat-icon> Readiness
          </a>
          <a routerLink="/admin/documents" class="ad-hero-btn">
            <mat-icon>folder_shared</mat-icon> Documents
          </a>
          <a routerLink="/admin/timesheets" class="ad-hero-btn">
            <mat-icon>receipt_long</mat-icon> Timesheets
          </a>
          <a routerLink="/admin/scheduler" class="ad-hero-btn ad-hero-btn--primary">
            <mat-icon>calendar_month</mat-icon> Scheduler
          </a>
        </div>
      </div>

      <!-- No org context -->
      <div *ngIf="!orgId" class="ad-no-org vs-glass">
        <mat-icon>warning_amber</mat-icon>
        <div>
          <strong>Missing organization context.</strong>
          <p>Your account has no organization assigned. Contact a Super Admin to provision your account.</p>
        </div>
      </div>

      <!-- KPI Cards -->
      <div *ngIf="orgId" class="vs-grid-3 ad-kpis">
        <div class="vs-stat-card vs-stat--primary">
          <div class="vs-stat-label">Open / Published</div>
          <div class="vs-stat-value">{{ metrics()?.openCount ?? 0 }}</div>
          <div class="vs-stat-sub">Shifts available to fill</div>
          <mat-icon class="vs-stat-icon">event_available</mat-icon>
        </div>
        <div class="vs-stat-card vs-stat--success">
          <div class="vs-stat-label">Assigned</div>
          <div class="vs-stat-value">{{ metrics()?.assignedCount ?? 0 }}</div>
          <div class="vs-stat-sub">Shifts with confirmed staff</div>
          <mat-icon class="vs-stat-icon">how_to_reg</mat-icon>
        </div>
        <div class="vs-stat-card vs-stat--warning">
          <div class="vs-stat-label">Open Next 7 Days</div>
          <div class="vs-stat-value">{{ metrics()?.upcoming7dOpenCount ?? 0 }}</div>
          <div class="vs-stat-sub">Require immediate action</div>
          <mat-icon class="vs-stat-icon">schedule</mat-icon>
        </div>
      </div>

      <!-- Workforce KPI Cards -->
      <div *ngIf="orgId" class="vs-grid-4 ad-kpis">
        <div class="vs-stat-card vs-stat--primary">
          <div class="vs-stat-label">Total Employees</div>
          <div class="vs-stat-value">{{ totalEmployeesCount() }}</div>
          <div class="vs-stat-sub">Active headcount</div>
          <mat-icon class="vs-stat-icon">groups</mat-icon>
        </div>
        <div class="vs-stat-card vs-stat--success">
          <div class="vs-stat-label">Active Shifts</div>
          <div class="vs-stat-value">{{ weeklyActiveShiftsCount() }}</div>
          <div class="vs-stat-sub">Live or needing coverage, {{ weekLabel }}</div>
          <mat-icon class="vs-stat-icon">bolt</mat-icon>
        </div>
        <div class="vs-stat-card vs-stat--warning">
          <div class="vs-stat-label">Coverage Rate</div>
          <div class="vs-stat-value">{{ coverageRatePct() !== null ? coverageRatePct() + '%' : '—' }}</div>
          <div class="vs-stat-sub">Assigned vs. all open shifts</div>
          <mat-icon class="vs-stat-icon">verified</mat-icon>
        </div>
        <div class="vs-stat-card vs-stat--primary">
          <div class="vs-stat-label">Labor Worked</div>
          <div class="vs-stat-value">{{ weeklyLaborHours() | number:'1.0-1' }}h</div>
          <div class="vs-stat-sub">Clocked hours, {{ weekLabel }}</div>
          <mat-icon class="vs-stat-icon">timelapse</mat-icon>
        </div>
      </div>

      <section *ngIf="orgId" class="ad-workforce-center">
        <article class="ad-workforce-card" [class.is-warn]="incompleteProfileCount() > 0">
          <mat-icon>manage_accounts</mat-icon>
          <div>
            <span>Profile Readiness</span>
            <strong>{{ profileReadyPercent() }}%</strong>
            <small>{{ incompleteProfileCount() }} employee profile(s) need attention</small>
          </div>
          <a routerLink="/admin/employees">Review</a>
        </article>
        <article class="ad-workforce-card" [class.is-warn]="missingPayrollSetupCount() > 0">
          <mat-icon>payments</mat-icon>
          <div>
            <span>Payroll Setup</span>
            <strong>{{ missingPayrollSetupCount() }}</strong>
            <small>missing pay rate, tax, or W-2 readiness</small>
          </div>
          <a routerLink="/admin/payroll">Open</a>
        </article>
        <article class="ad-workforce-card" [class.is-warn]="pendingPtoCount() > 0">
          <mat-icon>event_available</mat-icon>
          <div>
            <span>PTO Queue</span>
            <strong>{{ pendingPtoCount() }}</strong>
            <small>{{ approvedPtoCount() }} approved request(s) feed payroll</small>
          </div>
          <a routerLink="/admin/pto">Manage</a>
        </article>
        <article class="ad-workforce-card" [class.is-warn]="totalExceptionsForCenter() > 0">
          <mat-icon>fact_check</mat-icon>
          <div>
            <span>Operational Risk</span>
            <strong>{{ totalExceptionsForCenter() }}</strong>
            <small>timecard, shift switch, and open shift actions</small>
          </div>
          <a routerLink="/admin/timesheets">Resolve</a>
        </article>
      </section>

      <!-- Quick Links -->
      <div *ngIf="orgId" class="ad-quick-links">
        <a routerLink="/admin/shifts/new" class="ad-ql-card vs-glass">
          <div class="ad-ql-icon"><mat-icon>add_circle</mat-icon></div>
          <div class="ad-ql-label">Create Shift</div>
        </a>
        <a routerLink="/admin/scheduler" class="ad-ql-card vs-glass">
          <div class="ad-ql-icon"><mat-icon>calendar_month</mat-icon></div>
          <div class="ad-ql-label">Scheduler</div>
        </a>
        <a routerLink="/app/marketplace" class="ad-ql-card vs-glass">
          <div class="ad-ql-icon"><mat-icon>storefront</mat-icon></div>
          <div class="ad-ql-label">Marketplace</div>
        </a>
        <a routerLink="/admin/employees" class="ad-ql-card vs-glass">
          <div class="ad-ql-icon"><mat-icon>people</mat-icon></div>
          <div class="ad-ql-label">Employees</div>
        </a>
        <a routerLink="/admin/timesheets" class="ad-ql-card vs-glass">
          <div class="ad-ql-icon"><mat-icon>receipt_long</mat-icon></div>
          <div class="ad-ql-label">Timesheets</div>
        </a>
        <a routerLink="/admin/payroll" class="ad-ql-card vs-glass">
          <div class="ad-ql-icon"><mat-icon>payments</mat-icon></div>
          <div class="ad-ql-label">Payroll</div>
        </a>
        <a routerLink="/admin/audit" class="ad-ql-card vs-glass" *ngIf="canViewAudit()">
          <div class="ad-ql-icon"><mat-icon>history</mat-icon></div>
          <div class="ad-ql-label">Audit Log</div>
        </a>
        <a routerLink="/admin/org-settings" class="ad-ql-card vs-glass">
          <div class="ad-ql-icon"><mat-icon>business</mat-icon></div>
          <div class="ad-ql-label">Org Settings</div>
        </a>
      </div>

      <section *ngIf="orgId" class="ad-command-grid">
        <article class="ad-command-card ad-command-card--primary">
          <div class="ad-command-icon"><mat-icon>campaign</mat-icon></div>
          <div>
            <h2>Communicate with staff</h2>
            <p>Broadcast schedule updates, policy reminders, open shift alerts, or direct staff messages.</p>
            <a href="#ad-communication-center">Open communication center</a>
          </div>
        </article>
        <article class="ad-command-card">
          <div class="ad-command-icon"><mat-icon>fact_check</mat-icon></div>
          <div>
            <h2>Review employee requests</h2>
            <p>{{ actionQueueCount() }} item(s) need admin action across shift switches and timecard corrections.</p>
            <div class="ad-command-pills">
              <span>{{ swapRequests().length }} shift switch</span>
              <span>{{ pending().length }} timecard</span>
            </div>
          </div>
        </article>
        <article class="ad-command-card">
          <div class="ad-command-icon"><mat-icon>groups</mat-icon></div>
          <div>
            <h2>Staff coverage</h2>
            <p>{{ coverageRate() }}% assigned coverage from current open and assigned shift counts.</p>
            <div class="ad-command-pills">
              <span>{{ metrics()?.assignedCount ?? 0 }} assigned</span>
              <span>{{ metrics()?.openCount ?? 0 }} open</span>
            </div>
          </div>
        </article>
      </section>

      <!-- Shift Lifecycle Status Tabs -->
      <section *ngIf="orgId" class="vs-glass-strong ad-section">
        <div class="vs-panel-head">
          <div>
            <div class="vs-panel-title">Shift Lifecycle Overview</div>
            <div class="vs-panel-subtitle">This week — {{ weekLabel }}</div>
          </div>
        </div>
        <div class="ad-lifecycle-tabs">
          <button *ngFor="let tab of lifecycleTabs"
                  class="ad-lc-tab"
                  [class.ad-lc-tab--active]="lifecycleTab === tab.key"
                  (click)="selectLifecycleTab(tab.key)">
            <mat-icon>{{ tab.icon }}</mat-icon>
            <span>{{ tab.label }}</span>
            <span class="ad-lc-count" *ngIf="lifecycleTab === tab.key">{{ lifecycleShifts().length }}</span>
          </button>
        </div>
        <div class="ad-table-toolbar" *ngIf="lifecycleShifts().length > 0">
          <input
            type="search"
            class="ad-table-search"
            placeholder="Search title, location, or assignee…"
            [value]="lifecycleCtrl.filterText()"
            (input)="lifecycleCtrl.setFilter($any($event.target).value)">
        </div>
        <div class="vs-table-shell">
          <table class="vs-table ad-table">
            <thead>
              <tr>
                <th class="ad-th-sort" (click)="lifecycleCtrl.toggleSort('title')">Title {{ lifecycleCtrl.sortIndicator('title') }}</th>
                <th class="ad-th-sort" (click)="lifecycleCtrl.toggleSort('start')">Date {{ lifecycleCtrl.sortIndicator('start') }}</th>
                <th>Time</th>
                <th>Location</th>
                <th>Assigned To</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr class="vs-empty" *ngIf="lifecycleCtrl.pageRows().length === 0">
                <td colspan="6">No shifts with status "{{ lifecycleTab }}" this week.</td>
              </tr>
              <tr *ngFor="let s of lifecycleCtrl.pageRows()" class="vs-row">
                <td><strong>{{ s.title }}</strong></td>
                <td>{{ fmtDate(s.startAt) }}</td>
                <td>{{ fmtTime(s.startAt) }} – {{ fmtTime(s.endAt) }}</td>
                <td>{{ s.locationName || '—' }}</td>
                <td>{{ assignedUserLabel(s) }}</td>
                <td>
                  <span class="vs-badge"
                        [class.vs-badge--success]="s.status==='completed'"
                        [class.vs-badge--warning]="s.status==='in_progress'"
                        [class.vs-badge--neutral]="s.status==='claimed'||s.status==='assigned'"
                        [class.vs-badge--danger]="s.status==='expired'||s.status==='cancelled'">
                    {{ s.status }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <app-table-paginator *ngIf="lifecycleShifts().length > 0" [controller]="lifecycleCtrl"></app-table-paginator>
      </section>

      <!-- Shift Switch Requests -->
      <section *ngIf="orgId" class="vs-glass-strong ad-section">
        <div class="vs-panel-head">
          <div>
            <div class="vs-panel-title">Shift Switch Requests</div>
            <div class="vs-panel-subtitle">Manager review for shift covers and trades</div>
          </div>
          <div class="ad-actions-cell">
            <span class="vs-badge" [class.vs-badge--warning]="swapRequests().length > 0" [class.vs-badge--neutral]="swapRequests().length === 0">
              {{ swapRequests().length }} pending
            </span>
            <button class="vs-btn-ghost ad-action-btn" (click)="refreshSwapRequests()" [disabled]="swapListBusy">
              <mat-icon>sync</mat-icon> {{ swapListBusy ? 'Loading' : 'Refresh' }}
            </button>
          </div>
        </div>

        <div *ngIf="swapRequests().length === 0" class="ad-empty">
          <mat-icon>check_circle</mat-icon>
          <span>No pending shift switch requests.</span>
        </div>

        <div *ngIf="swapRequests().length > 0" class="vs-table-shell">
          <table class="vs-table ad-table">
            <thead>
              <tr>
                <th>Type</th>
                <th class="ad-th-sort" (click)="swapCtrl.toggleSort('shift')">Source Shift {{ swapCtrl.sortIndicator('shift') }}</th>
                <th>Requester</th>
                <th>Target</th>
                <th class="ad-th-sort" (click)="swapCtrl.toggleSort('requested')">Requested {{ swapCtrl.sortIndicator('requested') }}</th>
                <th style="text-align:right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let r of swapCtrl.pageRows()" class="vs-row">
                <td>
                  <span class="vs-badge" [class.vs-badge--primary]="r.kind === 'swap'" [class.vs-badge--warning]="r.kind !== 'swap'">
                    {{ swapKindLabel(r) }}
                  </span>
                </td>
                <td>
                  <strong>{{ r.shiftTitle }}</strong>
                  <div class="vs-muted">{{ fmtMsRange(r.sourceStartAtMs, r.sourceEndAtMs) }}</div>
                  <div class="vs-muted" *ngIf="r.targetShiftTitle">
                    Trade for {{ r.targetShiftTitle }} - {{ fmtMsRange(r.targetStartAtMs, r.targetEndAtMs) }}
                  </div>
                </td>
                <td>{{ r.requesterName || 'Staff member' }}</td>
                <td>{{ r.targetName || 'Staff member' }}</td>
                <td>{{ fmtMs(r.createdAtMs) }}</td>
                <td style="text-align:right">
                  <div class="ad-actions-cell">
                    <button class="vs-btn-ghost ad-action-btn ad-action-btn--approve"
                            (click)="decideSwap(r, 'accept')"
                            [disabled]="swapBusyId === r.requestId">
                      <mat-icon>check</mat-icon> Approve
                    </button>
                    <button class="vs-btn-ghost ad-action-btn ad-action-btn--reject"
                            (click)="decideSwap(r, 'reject')"
                            [disabled]="swapBusyId === r.requestId">
                      <mat-icon>close</mat-icon> Decline
                    </button>
                    <button class="vs-btn-ghost ad-action-btn"
                            (click)="decideSwap(r, 'cancel')"
                            [disabled]="swapBusyId === r.requestId">
                      <mat-icon>block</mat-icon> Cancel
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <app-table-paginator *ngIf="swapRequests().length > 0" [controller]="swapCtrl"></app-table-paginator>
      </section>

      <!-- Pending Time Corrections -->
      <section *ngIf="orgId" class="vs-glass-strong ad-section">
        <div class="vs-panel-head">
          <div>
            <div class="vs-panel-title">Pending Time Corrections</div>
            <div class="vs-panel-subtitle">Approve or reject employee clock-in/out corrections</div>
          </div>
          <span class="vs-badge" [class.vs-badge--warning]="pending().length > 0" [class.vs-badge--neutral]="pending().length === 0">
            {{ pending().length }} pending
          </span>
        </div>

        <div *ngIf="pending().length === 0" class="ad-empty">
          <mat-icon>check_circle</mat-icon>
          <span>No pending approvals. All caught up!</span>
        </div>

        <div *ngIf="pending().length > 0" class="vs-table-shell">
          <table class="vs-table ad-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Shift</th>
                <th class="ad-th-sort" (click)="pendingCtrl.toggleSort('checkIn')">Check In {{ pendingCtrl.sortIndicator('checkIn') }}</th>
                <th class="ad-th-sort" (click)="pendingCtrl.toggleSort('checkOut')">Check Out {{ pendingCtrl.sortIndicator('checkOut') }}</th>
                <th style="text-align:right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let e of pendingCtrl.pageRows()" class="vs-row">
                <td>
                  <span class="vs-strong">{{ pendingUserLabel(e) }}</span>
                </td>
                <td class="vs-muted">Assigned shift</td>
                <td>{{ fmt(e.checkInAt) }}</td>
                <td>{{ fmt(e.checkOutAt) }}</td>
                <td style="text-align:right">
                  <div class="ad-actions-cell">
                    <button class="vs-btn-ghost ad-action-btn ad-action-btn--approve"
                            (click)="decide(e.id, 'approved')"
                            [disabled]="busyId === e.id">
                      <mat-icon>check</mat-icon> Approve
                    </button>
                    <button class="vs-btn-ghost ad-action-btn ad-action-btn--reject"
                            (click)="decide(e.id, 'rejected')"
                            [disabled]="busyId === e.id">
                      <mat-icon>close</mat-icon> Reject
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <app-table-paginator *ngIf="pending().length > 0" [controller]="pendingCtrl"></app-table-paginator>
      </section>

      <section *ngIf="orgId" id="ad-communication-center" class="vs-glass-strong ad-section ad-comm-section">
        <div class="vs-panel-head">
          <div>
            <div class="vs-panel-title">Communication Center</div>
            <div class="vs-panel-subtitle">Send in-app and internet notifications to one, many, org, or all platform users</div>
          </div>
        </div>

        <div class="ad-comm-form">
          <div class="vs-form-row vs-form-row--2">
            <div>
              <label class="vs-field-label">Title *</label>
              <input class="vs-input" [(ngModel)]="commTitle" placeholder="Important update">
            </div>
            <div>
              <label class="vs-field-label">Type</label>
              <select class="vs-select" [(ngModel)]="commType">
                <option value="announcement">announcement</option>
                <option value="system">system</option>
                <option value="alert">alert</option>
                <option value="policy">policy</option>
              </select>
            </div>
          </div>

          <div class="vs-form-row">
            <div>
              <label class="vs-field-label">Message *</label>
              <textarea class="vs-input" rows="3" [(ngModel)]="commBody" placeholder="Message content..."></textarea>
            </div>
          </div>

          <div class="vs-form-row vs-form-row--2">
            <div>
              <label class="vs-field-label">Audience</label>
              <select class="vs-select" [(ngModel)]="commTargetType" (ngModelChange)="onTargetTypeChange()">
                <option value="single">Single user</option>
                <option value="multi">Multiple users</option>
                <option value="orgAll">All users in my organization</option>
                <option value="platformAll" *ngIf="isSuperAdmin()">All users in platform</option>
              </select>
            </div>
            <div>
              <label class="vs-field-label">Delivery</label>
              <div class="ad-comm-checks">
                <label><input type="checkbox" [(ngModel)]="commInApp"> In-app</label>
                <label><input type="checkbox" [(ngModel)]="commInternet"> Internet (email/sms)</label>
              </div>
            </div>
          </div>

          <div class="vs-form-row" *ngIf="commTargetType==='single' || commTargetType==='multi'">
            <div>
              <label class="vs-field-label">Target Users</label>
              <input class="vs-input" [(ngModel)]="commUserQuery" (ngModelChange)="refreshCommCandidates()" placeholder="Search by name, email or UID">
              <div class="ad-comm-users" *ngIf="commCandidates.length > 0">
                <button type="button"
                        *ngFor="let u of commCandidates"
                        class="ad-user-pill"
                        [class.ad-user-pill--active]="isUserSelected(u.uid)"
                        (click)="toggleUserSelection(u.uid)">
                  {{ commUserLabel(u) }}
                </button>
              </div>
              <div class="ad-comm-help">{{ commTargetType==='single' ? 'Select one user.' : 'Select one or multiple users.' }}</div>
            </div>
          </div>

          <div class="vs-form-row" *ngIf="commInternet">
            <div>
              <label class="vs-field-label">Internet Channel</label>
              <select class="vs-select" [(ngModel)]="commInternetChannel">
                <option value="email">email</option>
                <option value="sms">sms</option>
              </select>
            </div>
          </div>

          <div class="ad-comm-actions">
            <button class="vs-btn-primary" (click)="sendCommunication()" [disabled]="commBusy">
              <mat-icon>send</mat-icon>
              {{ commBusy ? 'Sending...' : 'Send Message' }}
            </button>
          </div>
        </div>
      </section>

      <!-- Metrics timestamp -->
      <div *ngIf="orgId && metrics()?.updatedAt" class="ad-updated">
        <mat-icon>update</mat-icon>
        Metrics refreshed: {{ fmt(metrics()!.updatedAt) }}
      </div>
    </div>
  `,
  styles: [`
    .admin-brand-page {
      color: #1f2937;
    }

    .admin-brand-hero {
      min-height: 150px;
      margin: -24px -22px 22px;
      padding: 28px 28px 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 20px;
      background:
        linear-gradient(135deg, rgba(4,120,87,0.98), rgba(7,83,63,0.98)),
        #07533f;
      color: #fff;
      border-bottom: 1px solid rgba(255,255,255,0.16);
    }

    .admin-brand-kicker {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: rgba(255,255,255,0.72);
      margin-bottom: 8px;
    }

    .admin-brand-hero h1 {
      margin: 0;
      font-size: 32px;
      font-weight: 800;
      letter-spacing: 0;
    }

    .admin-brand-hero p {
      margin: 8px 0 0;
      color: rgba(255,255,255,0.82);
      max-width: 680px;
    }

    .admin-brand-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .ad-hero-btn {
      min-height: 40px;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      border: 1px solid rgba(255,255,255,0.28);
      border-radius: 999px;
      padding: 0 14px;
      color: #fff;
      text-decoration: none;
      font-weight: 800;
      background: rgba(255,255,255,0.10);
    }

    .ad-hero-btn--primary {
      border-color: #fff;
      background: #fff;
      color: #07533f;
    }

    .ad-btn {
      display: inline-flex; align-items: center; gap: 6px;
      text-decoration: none; padding: 8px 14px !important;
    }

    .ad-no-org {
      display: flex; align-items: flex-start; gap: 16px;
      padding: 20px 24px; color: var(--warning);
    }
    .ad-no-org mat-icon { font-size: 28px; flex-shrink: 0; margin-top: 2px; }
    .ad-no-org p { margin: 4px 0 0; color: var(--text-muted); font-size: 13px; }

    .ad-kpis { margin-bottom: 20px; }

    .ad-kpis .vs-stat-card,
    .ad-section,
    .ad-ql-card,
    .ad-workforce-card,
    .ad-command-card {
      border-radius: 8px !important;
      background: rgba(255,255,255,0.92) !important;
      border-color: rgba(15,23,42,0.12) !important;
      box-shadow: 0 12px 30px rgba(15,23,42,0.07) !important;
    }

    .ad-workforce-center {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }

    .ad-workforce-card {
      min-height: 116px;
      display: grid;
      grid-template-columns: 42px 1fr auto;
      align-items: center;
      gap: 12px;
      padding: 14px;
    }

    .ad-workforce-card > mat-icon {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      background: #ecfdf5;
      color: #047857;
      font-size: 22px;
    }

    .ad-workforce-card.is-warn > mat-icon {
      background: #fff7ed;
      color: #b45309;
    }

    .ad-workforce-card span {
      display: block;
      color: #64748b;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .ad-workforce-card strong {
      display: block;
      margin-top: 5px;
      color: #0f172a;
      font-size: 28px;
      line-height: 1;
    }

    .ad-workforce-card small {
      display: block;
      margin-top: 6px;
      color: #475569;
      line-height: 1.25;
    }

    .ad-workforce-card a {
      align-self: end;
      color: #07533f;
      font-size: 12px;
      font-weight: 900;
      text-decoration: none;
    }

    .ad-workforce-card a:hover {
      text-decoration: underline;
    }

    /* Quick links */
    .ad-quick-links {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    @media (max-width: 1100px) { .ad-quick-links { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 600px)  { .ad-quick-links { grid-template-columns: repeat(2, 1fr); } }

    .ad-ql-card {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 18px 10px;
      text-decoration: none;
      border-radius: var(--radius) !important;
      transition: transform var(--t-base), box-shadow var(--t-base), border-color var(--t-base);
    }
    .ad-ql-card:hover {
      transform: translateY(-3px);
      border-color: var(--border-strong) !important;
      box-shadow: var(--shadow) !important;
    }
    .ad-ql-icon {
      width: 44px; height: 44px;
      border-radius: 12px;
      background: var(--panel-2);
      display: flex; align-items: center; justify-content: center;
      color: var(--primary);
    }
    .ad-ql-icon mat-icon { font-size: 22px; }
    .ad-ql-label { font-size: 12px; font-weight: 700; color: var(--text-muted); text-align: center; }

    .ad-command-grid {
      display: grid;
      grid-template-columns: 1.25fr 1fr 1fr;
      gap: 14px;
      margin-bottom: 22px;
    }

    .ad-command-card {
      min-height: 150px;
      padding: 18px;
      display: grid;
      grid-template-columns: 44px 1fr;
      gap: 14px;
      align-items: start;
    }

    .ad-command-card--primary {
      background: linear-gradient(135deg, #ffffff, #ecfdf5) !important;
      border-color: rgba(4,120,87,0.24) !important;
    }

    .ad-command-icon {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      color: #047857;
      background: #d1fae5;
    }

    .ad-command-card h2 {
      margin: 0;
      color: #1f2937;
      font-size: 16px;
      font-weight: 800;
    }

    .ad-command-card p {
      margin: 8px 0 12px;
      color: #475569;
      font-size: 13px;
      line-height: 1.45;
    }

    .ad-command-card a {
      color: #047857;
      font-weight: 800;
      text-decoration: none;
      font-size: 13px;
    }

    .ad-command-pills {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .ad-command-pills span {
      border: 1px solid #cbd5e1;
      border-radius: 999px;
      padding: 5px 9px;
      background: #fff;
      color: #334155;
      font-size: 12px;
      font-weight: 800;
    }

    /* Section */
    .ad-section {
      margin-bottom: 20px;
      overflow: hidden;
      border: 1px solid var(--border);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
    }

    .ad-table th {
      background: var(--bg-elevated);
      color: var(--text-subtle);
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 800;
    }

    .ad-table td {
      background: transparent;
    }

    .ad-table tbody tr:nth-child(even):not(.vs-empty) td {
      background: rgba(148,163,184,0.08);
    }

    .ad-table-toolbar { padding: 12px 16px 0; }
    .ad-table-search {
      width: 100%; max-width: 320px; height: 36px; padding: 0 12px;
      border: 1px solid var(--border); border-radius: 6px;
      background: var(--panel, #fff); color: var(--text, #0f172a); font-size: 13px;
    }
    .ad-th-sort { cursor: pointer; user-select: none; }
    .ad-th-sort:hover { color: var(--primary, #07533f); }

    .ad-empty {
      display: flex; align-items: center; gap: 10px;
      padding: 20px 24px;
      color: var(--success);
      font-size: 14px; font-weight: 600;
    }
    .ad-empty mat-icon { font-size: 20px; }

    .ad-uid { font-family: 'Roboto Mono', monospace; font-size: 12px; }

    .ad-actions-cell { display: flex; gap: 8px; justify-content: flex-end; }
    .ad-action-btn {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 5px 10px !important; font-size: 12px !important;
    }
    .ad-action-btn mat-icon { font-size: 15px !important; }
    .ad-action-btn--approve:not([disabled]) { color: var(--success) !important; border-color: rgba(34,197,94,0.30) !important; }
    .ad-action-btn--reject:not([disabled])  { color: var(--danger)  !important; border-color: rgba(239,68,68,0.30)  !important; }

    .ad-updated {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; color: var(--text-subtle);
      margin-top: 8px;
    }
    .ad-updated mat-icon { font-size: 14px; }
    .ad-comm-form { padding: 14px; }
    .ad-comm-section {
      border-color: rgba(4,120,87,0.22) !important;
      background: linear-gradient(180deg, rgba(236,253,245,0.82), rgba(255,255,255,0.94)) !important;
    }
    .ad-comm-checks { display:flex; gap:14px; padding-top:10px; color:var(--text-muted); font-size:13px; }
    .ad-comm-help { font-size:12px; color:var(--text-subtle); margin-top:6px; }
    .ad-comm-actions { display:flex; justify-content:flex-end; margin-top:8px; }
    .ad-comm-users { margin-top:10px; display:flex; flex-wrap:wrap; gap:8px; max-height:170px; overflow:auto; padding:8px; border:1px dashed var(--border); border-radius:10px; }
    .ad-user-pill { border:1px solid var(--border); background:var(--panel); color:var(--text-muted); font-size:12px; font-weight:600; border-radius:999px; padding:6px 10px; cursor:pointer; }
    .ad-user-pill--active { border-color:rgba(29,78,216,0.45); color:var(--primary); background:rgba(29,78,216,0.12); }

    /* Lifecycle tabs */
    .ad-lifecycle-tabs { display:flex; gap:8px; padding:12px 20px; flex-wrap:wrap; border-bottom:1px solid var(--border); }
    .ad-lc-tab { display:flex; align-items:center; gap:6px; padding:8px 14px; border:1px solid var(--border); border-radius:var(--radius-md); background:var(--panel); color:var(--text-muted); font-size:13px; font-weight:600; cursor:pointer; transition:all var(--t-base); }
    .ad-lc-tab mat-icon { font-size:16px !important; width:16px; height:16px; }
    .ad-lc-tab:hover { border-color:var(--border-strong); color:var(--text); }
    .ad-lc-tab--active { border-color:rgba(29,78,216,0.5); background:rgba(29,78,216,0.12); color:var(--primary); }
    .ad-lc-count { display:inline-flex; align-items:center; justify-content:center; min-width:20px; height:20px; padding:0 6px; border-radius:999px; background:rgba(29,78,216,0.16); color:var(--primary); font-size:11px; font-weight:700; }

    @media (max-width: 1040px) {
      .admin-brand-hero {
        align-items: flex-start;
        flex-direction: column;
      }

      .admin-brand-actions {
        justify-content: flex-start;
      }

      .ad-command-grid {
        grid-template-columns: 1fr;
      }

      .ad-workforce-center {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 680px) {
      .admin-brand-hero {
        margin: -14px -12px 18px;
        padding: 22px 16px;
      }

      .admin-brand-hero h1 {
        font-size: 26px;
      }

      .ad-workforce-center {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class AdminDashboardPage implements OnDestroy {
  orgId: string | null = null;
  metrics = signal<OrgMetricsSummary | null>(null);

  // Workforce KPI cards
  weeklyActiveShiftsCount = signal(0);
  weeklyLaborHours = signal(0);
  totalEmployeesCount = computed(() => this.commOrgUsers().filter((u) => u.active !== false).length);
  coverageRatePct = computed(() => {
    const m = this.metrics();
    if (!m) return null;
    const total = (m.assignedCount || 0) + (m.openCount || 0);
    if (total <= 0) return null;
    return Math.round((m.assignedCount / total) * 100);
  });
  private unsubActiveShifts: (() => void) | null = null;
  private unsubLaborHours: (() => void) | null = null;
  pending = signal<TimeEntry[]>([]);
  pendingCtrl = new TableListController<TimeEntry>(this.pending, {
    pageSize: 10,
    sortAccessor: (e, key) => {
      if (key === 'checkIn') return tsToDate(e.checkInAt)?.getTime() ?? 0;
      if (key === 'checkOut') return tsToDate(e.checkOutAt)?.getTime() ?? 0;
      return null;
    },
  });
  busyId: string | null = null;
  swapRequests = signal<any[]>([]);
  swapCtrl = new TableListController<any>(this.swapRequests, {
    pageSize: 10,
    sortAccessor: (r, key) => {
      if (key === 'requested') return Number(r.createdAtMs) || 0;
      if (key === 'shift') return String(r.shiftTitle || '').toLowerCase();
      return null;
    },
  });
  ptoRequests = signal<TimeOffRequest[]>([]);
  swapBusyId: string | null = null;
  swapListBusy = false;

  // Lifecycle tabs
  lifecycleTab: ShiftStatus = 'open';
  lifecycleShifts = signal<Shift[]>([]);
  lifecycleCtrl = new TableListController<Shift>(this.lifecycleShifts, {
    pageSize: 10,
    filterPredicate: (s, q) => `${s.title} ${s.locationName || ''} ${this.assignedUserLabel(s)}`.toLowerCase().includes(q),
    sortAccessor: (s, key) => {
      if (key === 'title') return String(s.title || '').toLowerCase();
      if (key === 'start') return s.startAt?.toMillis ? s.startAt.toMillis() : Number(s.startAt || 0);
      return null;
    },
  });
  weekLabel = '';
  lifecycleTabs = [
    { key: 'open' as ShiftStatus,       label: 'Open',        icon: 'event_available' },
    { key: 'claimed' as ShiftStatus,    label: 'Claimed',     icon: 'how_to_reg' },
    { key: 'in_progress' as ShiftStatus,label: 'In Progress', icon: 'timelapse' },
    { key: 'completed' as ShiftStatus,  label: 'Completed',   icon: 'check_circle' },
    { key: 'expired' as ShiftStatus,    label: 'Expired',     icon: 'timer_off' },
    { key: 'cancelled' as ShiftStatus,  label: 'Cancelled',   icon: 'cancel' },
  ];
  private unsubLifecycle: (() => void) | null = null;

  commTitle = '';
  commBody = '';
  commType = 'announcement';
  commTargetType: 'single' | 'multi' | 'orgAll' | 'platformAll' = 'orgAll';
  commUserQuery = '';
  commOrgUsers = signal<OrgUser[]>([]);
  commCandidates: OrgUser[] = [];
  commSelectedUserIds: string[] = [];
  commInApp = true;
  commInternet = false;
  commInternetChannel: 'email' | 'sms' = 'email';
  commBusy = false;

  private unsub: Array<() => void> = [];
  private effectRef?: EffectRef;

  constructor(
    private ctx: OrgContextService,
    private timeRepo: TimeEntriesRepo,
    private adminCmd: AdminCommands,
    private metricsRepo: MetricsRepo,
    private usersRepo: UsersRepo,
    private shiftsRepo: ShiftsRepo,
    private shiftCommands: ShiftsCommands,
    private accruals: AccrualsRepo,
    private toast: ToastService,
    private plans: PlanEntitlementsService
  ) {
    this.effectRef = effect(() => {
      const orgId = this.ctx.orgId();
      this.orgId = orgId;
      this.cleanupWatchers();
      if (!orgId) { this.pending.set([]); this.metrics.set(null); this.swapRequests.set([]); this.ptoRequests.set([]); return; }
      this.unsub.push(this.timeRepo.watchPendingApprovals(orgId, (items) => this.pending.set(items)));
      this.unsub.push(this.metricsRepo.watchSummary(orgId, (m) => this.metrics.set(m)));
      this.unsub.push(this.accruals.watchOrgRequests(orgId, (items) => {
        this.ptoRequests.set(items || []);
      }));
      this.unsub.push(this.usersRepo.watchOrgUsers(orgId, (users) => {
        this.commOrgUsers.set(users);
        this.refreshCommCandidates();
      }));
      this.loadLifecycleTab(orgId, this.lifecycleTab);
      this.loadWorkforceKpis(orgId);
      void this.refreshSwapRequests();
    });
  }

  fmtDate(ts: any) { return fmtShiftDate(ts); }
  fmtTime(ts: any) { return fmtShiftTime(ts); }

  selectLifecycleTab(tab: ShiftStatus) {
    this.lifecycleTab = tab;
    if (this.orgId) this.loadLifecycleTab(this.orgId, tab);
  }

  private loadWorkforceKpis(orgId: string) {
    if (this.unsubActiveShifts) { this.unsubActiveShifts(); this.unsubActiveShifts = null; }
    if (this.unsubLaborHours) { this.unsubLaborHours(); this.unsubLaborHours = null; }

    const week = getCurrentWeekRange();
    const startTs = Timestamp.fromDate(week.start);
    const endTs = Timestamp.fromDate(week.end);

    this.unsubActiveShifts = this.shiftsRepo.watchByStatus(
      orgId, ['open', 'published', 'claimed', 'in_progress'], startTs, endTs,
      (shifts) => this.weeklyActiveShiftsCount.set(shifts.length)
    );

    this.unsubLaborHours = this.timeRepo.watchOrgEntriesRange(orgId, startTs, endTs, (entries) => {
      const total = entries.reduce((sum, e) => sum + payrollHours(e), 0);
      this.weeklyLaborHours.set(Math.round(total * 10) / 10);
    });
  }

  private loadLifecycleTab(orgId: string, status: ShiftStatus) {
    if (this.unsubLifecycle) { this.unsubLifecycle(); this.unsubLifecycle = null; }
    const week = getCurrentWeekRange();
    this.weekLabel = `${week.start.toLocaleDateString('en-US', { month:'short', day:'numeric' })} – ${week.end.toLocaleDateString('en-US', { month:'short', day:'numeric' })}`;
    const statuses: ShiftStatus[] = status === 'open' ? ['open', 'published'] : [status];
    const startTs = Timestamp.fromDate(week.start);
    const endTs = Timestamp.fromDate(week.end);
    this.unsubLifecycle = this.shiftsRepo.watchByStatus(
      orgId, statuses, startTs, endTs,
      (shifts) => { this.lifecycleShifts.set(shifts); }
    );
  }

  fmt(ts: any) { return formatDateTime(ts); }

  isSuperAdmin() {
    return (this.ctx.platformRole() || '').toLowerCase() === 'superadmin';
  }

  canViewAudit() {
    return this.plans.has('auditLog');
  }

  async decide(entryId: string, decision: 'approved' | 'rejected') {
    this.busyId = entryId;
    try {
      await this.adminCmd.decideTimeCorrection(entryId, decision);
      this.toast.success(decision === 'approved' ? 'Correction approved.' : 'Correction rejected.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Decision failed.');
    } finally {
      this.busyId = null;
    }
  }

  async refreshSwapRequests() {
    if (!this.orgId) {
      this.swapRequests.set([]);
      return;
    }

    this.swapListBusy = true;
    try {
      const res: any = await this.shiftCommands.listShiftSwapRequests('pending', 50);
      this.swapRequests.set(Array.isArray(res?.items) ? res.items : []);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to load shift switch requests.');
    } finally {
      this.swapListBusy = false;
    }
  }

  async decideSwap(r: any, decision: 'accept' | 'reject' | 'cancel') {
    if (!r?.requestId || this.swapBusyId) return;
    this.swapBusyId = r.requestId;
    try {
      await this.shiftCommands.respondShiftSwap(r.requestId, decision);
      const label = decision === 'accept' ? 'approved' : decision === 'reject' ? 'declined' : 'cancelled';
      this.toast.success(`Shift switch ${label}.`);
      await this.refreshSwapRequests();
    } catch (e: any) {
      this.toast.errorFrom(e, 'Shift switch decision failed.');
    } finally {
      this.swapBusyId = null;
    }
  }

  swapKindLabel(r: any) {
    return r?.kind === 'swap' ? 'Trade' : 'Cover';
  }

  fmtMs(ms: any) {
    const n = Number(ms || 0);
    if (!Number.isFinite(n) || n <= 0) return '-';
    return new Date(n).toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  fmtMsRange(startMs: any, endMs: any) {
    const start = this.fmtMs(startMs);
    const end = Number(endMs || 0);
    const endLabel = Number.isFinite(end) && end > 0
      ? new Date(end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : '-';
    return `${start} - ${endLabel}`;
  }

  async sendCommunication() {
    if (!this.commTitle.trim() || !this.commBody.trim()) {
      this.toast.error('Title and message are required. [E_VALIDATION_MESSAGE_REQUIRED]');
      return;
    }

    const userIds = this.commSelectedUserIds.slice();

    if ((this.commTargetType === 'single' || this.commTargetType === 'multi') && !userIds.length) {
      this.toast.error('Provide at least one target user UID. [E_VALIDATION_TARGET_UID_REQUIRED]');
      return;
    }

    if (this.commTargetType === 'single' && userIds.length !== 1) {
      this.toast.error('Select exactly one user for Single audience. [E_VALIDATION_SINGLE_TARGET]');
      return;
    }

    this.commBusy = true;
    try {
      const res: any = await this.adminCmd.sendMessage({
        title: this.commTitle.trim(),
        body: this.commBody.trim(),
        type: this.commType,
        targetType: this.commTargetType,
        userIds,
        inApp: this.commInApp,
        internet: this.commInternet,
        internetChannel: this.commInternetChannel,
      });

      this.toast.success(`Message sent to ${res?.recipientCount ?? 0} users.`);
      this.commTitle = '';
      this.commBody = '';
      this.commUserQuery = '';
      this.commSelectedUserIds = [];
      this.commInternet = false;
      this.commInApp = true;
      this.commTargetType = 'orgAll';
      this.commType = 'announcement';
      this.refreshCommCandidates();
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to send message.');
    } finally {
      this.commBusy = false;
    }
  }

  onTargetTypeChange() {
    if (this.commTargetType === 'single' && this.commSelectedUserIds.length > 1) {
      this.commSelectedUserIds = [this.commSelectedUserIds[0]];
    }
    if (this.commTargetType !== 'single' && this.commTargetType !== 'multi') {
      this.commSelectedUserIds = [];
    }
    this.refreshCommCandidates();
  }

  refreshCommCandidates() {
    const q = this.commUserQuery.toLowerCase().trim();
    const base = q
      ? this.commOrgUsers().filter((u) => {
          const name = (u.displayName || '').toLowerCase();
          const email = (u.email || '').toLowerCase();
          const uid = (u.uid || '').toLowerCase();
          return name.includes(q) || email.includes(q) || uid.includes(q);
        })
      : this.commOrgUsers();
    this.commCandidates = base.slice(0, 40);
  }

  toggleUserSelection(uid: string) {
    if (this.commTargetType === 'single') {
      this.commSelectedUserIds = [uid];
      return;
    }

    if (this.commSelectedUserIds.includes(uid)) {
      this.commSelectedUserIds = this.commSelectedUserIds.filter((x) => x !== uid);
      return;
    }
    this.commSelectedUserIds = [...this.commSelectedUserIds, uid];
  }

  isUserSelected(uid: string) {
    return this.commSelectedUserIds.includes(uid);
  }

  commUserLabel(u: OrgUser) {
    const n = (u.displayName || '').trim();
    const e = (u.email || '').trim();
    if (n && e) return `${n} (${e})`;
    if (n) return `${n} (${u.uid.slice(0, 8)}...)`;
    if (e) return `${e}`;
    return u.uid;
  }

  pendingUserLabel(e: TimeEntry) {
    const uid = String(e.userId || '').trim();
    if (!uid) return 'Unknown employee';
    const user = this.commOrgUsers().find((u) => u.uid === uid);
    if (!user) return `${uid.slice(0, 8)}...`;
    return user.displayName || user.email || `${uid.slice(0, 8)}...`;
  }

  actionQueueCount() {
    return this.swapRequests().length + this.pending().length;
  }

  coverageRate() {
    const assigned = Number(this.metrics()?.assignedCount || 0);
    const open = Number(this.metrics()?.openCount || 0);
    const total = assigned + open;
    if (!total) return 100;
    return Math.round((assigned / total) * 100);
  }

  incompleteProfileCount() {
    return this.commOrgUsers().filter((user: any) => user.active !== false && profileCompletion(user).score < 100).length;
  }

  profileReadyPercent() {
    const active = this.commOrgUsers().filter((user: any) => user.active !== false);
    if (!active.length) return 100;
    const avg = active.reduce((sum, user: any) => sum + profileCompletion(user).score, 0) / active.length;
    return Math.round(avg);
  }

  missingPayrollSetupCount() {
    return this.commOrgUsers().filter((user: any) => {
      if (user.active === false) return false;
      const taxReady = user.taxWithholding?.certified === true;
      const w2Ready = !!user.w2?.delivery && !!user.w2?.email;
      const rateReady = Number(user.payRate ?? user.profile?.payRate ?? user.payroll?.payRate ?? 0) > 0;
      return !taxReady || !w2Ready || !rateReady;
    }).length;
  }

  pendingPtoCount() {
    return this.ptoRequests().filter((r) => r.status === 'pending').length;
  }

  approvedPtoCount() {
    return this.ptoRequests().filter((r) => r.status === 'approved').length;
  }

  totalExceptionsForCenter() {
    return this.pending().length + this.swapRequests().length + Number(this.metrics()?.upcoming7dOpenCount || 0);
  }

  assignedUserLabel(s: Shift) {
    const uid = String(s.assignedUserId || '').trim();
    if (!uid) return '—';

    const assignedName = String(s.assignedUserName || '').trim();
    if (assignedName && assignedName !== uid) return assignedName;

    const user = this.commOrgUsers().find((u) => u.uid === uid);
    if (!user) return `${uid.slice(0, 8)}...`;

    const name = String(user.displayName || '').trim();
    const email = String(user.email || '').trim();
    if (name) return name;
    if (email) return email;
    return `${uid.slice(0, 8)}...`;
  }

  private cleanupWatchers() {
    this.unsub.forEach((u) => u()); this.unsub = [];
    if (this.unsubLifecycle) { this.unsubLifecycle(); this.unsubLifecycle = null; }
    if (this.unsubActiveShifts) { this.unsubActiveShifts(); this.unsubActiveShifts = null; }
    if (this.unsubLaborHours) { this.unsubLaborHours(); this.unsubLaborHours = null; }
  }

  ngOnDestroy() { this.cleanupWatchers(); this.effectRef?.destroy(); }
}
