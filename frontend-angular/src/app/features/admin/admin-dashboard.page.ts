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
import { StatCardComponent } from '../../shared/ui/stat-card/stat-card.component';
import { TerminologyService } from '../../core/experience/terminology.service';
import { OrgExperienceService } from '../../core/experience/org-experience.service';
import { isNavKeyHidden } from '../../shared/utils/dashboard-visibility.util';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatIconModule, MatButtonModule, TablePaginatorComponent, StatCardComponent, TranslocoModule],
  template: `
    <div class="vs-page-pad admin-brand-page">

      <!-- Page Header -->
      <div class="admin-brand-hero">
        <div>
          <div class="admin-brand-kicker">{{ 'adminDashboard.kicker' | transloco }}</div>
          <h1>{{ 'adminDashboard.title' | transloco }}</h1>
          <p *ngIf="orgId">{{ 'adminDashboard.subtitle' | transloco }}</p>
          <p *ngIf="!orgId">{{ 'adminDashboard.missingOrgContextSubtitle' | transloco }}</p>
        </div>
        <div class="admin-brand-actions">
          <a routerLink="/admin/employees" class="ad-hero-btn">
            <mat-icon>people</mat-icon> {{ terminology.workforceMemberPlural() }}
          </a>
          <a routerLink="/admin/readiness" class="ad-hero-btn">
            <mat-icon>health_and_safety</mat-icon> {{ 'adminDashboard.readiness' | transloco }}
          </a>
          <a routerLink="/admin/documents" class="ad-hero-btn">
            <mat-icon>folder_shared</mat-icon> {{ 'adminDashboard.documents' | transloco }}
          </a>
          <a routerLink="/admin/timesheets" class="ad-hero-btn">
            <mat-icon>receipt_long</mat-icon> {{ 'adminDashboard.timesheets' | transloco }}
          </a>
          <a routerLink="/admin/scheduler" class="ad-hero-btn ad-hero-btn--primary">
            <mat-icon>calendar_month</mat-icon> {{ 'adminDashboard.scheduler' | transloco }}
          </a>
        </div>
      </div>

      <!-- No org context -->
      <div *ngIf="!orgId" class="ad-no-org vs-glass">
        <mat-icon>warning_amber</mat-icon>
        <div>
          <strong>{{ 'adminDashboard.missingOrgContextTitle' | transloco }}</strong>
          <p>{{ 'adminDashboard.missingOrgContextBody' | transloco }}</p>
        </div>
      </div>

      <!-- KPI Cards -->
      <div *ngIf="orgId" class="vs-grid-3 ad-kpis">
        <app-stat-card variant="primary" icon="event_available"
          [label]="'adminDashboard.kpiOpenPublished' | transloco" [value]="metrics()?.openCount ?? 0"
          [sub]="'adminDashboard.kpiOpenPublishedSub' | transloco: { term: terminology.workUnitPlural() }">
        </app-stat-card>
        <app-stat-card variant="success" icon="how_to_reg"
          [label]="'adminDashboard.kpiAssigned' | transloco" [value]="metrics()?.assignedCount ?? 0"
          [sub]="'adminDashboard.kpiAssignedSub' | transloco: { term: terminology.workUnitPlural() }">
        </app-stat-card>
        <app-stat-card variant="warning" icon="schedule"
          [label]="'adminDashboard.kpiOpenNext7Days' | transloco" [value]="metrics()?.upcoming7dOpenCount ?? 0"
          [sub]="'adminDashboard.kpiOpenNext7DaysSub' | transloco">
        </app-stat-card>
      </div>

      <!-- Workforce KPI Cards -->
      <div *ngIf="orgId" class="vs-grid-4 ad-kpis">
        <app-stat-card variant="primary" icon="groups"
          [label]="'adminDashboard.kpiTotalEmployees' | transloco: { term: terminology.workforceMemberPlural() }" [value]="totalEmployeesCount()"
          [sub]="'adminDashboard.kpiTotalEmployeesSub' | transloco">
        </app-stat-card>
        <app-stat-card variant="success" icon="bolt"
          [label]="'adminDashboard.kpiActiveShifts' | transloco: { term: terminology.workUnitPlural() }" [value]="weeklyActiveShiftsCount()"
          [sub]="'adminDashboard.kpiActiveShiftsSub' | transloco: { week: weekLabel }">
        </app-stat-card>
        <app-stat-card variant="warning" icon="verified"
          [label]="'adminDashboard.kpiCoverageRate' | transloco" [value]="coverageRatePct() !== null ? coverageRatePct() + '%' : '—'"
          [sub]="'adminDashboard.kpiCoverageRateSub' | transloco: { term: terminology.workUnitPlural() }">
        </app-stat-card>
        <app-stat-card variant="primary" icon="timelapse"
          [label]="'adminDashboard.kpiLaborWorked' | transloco" [value]="(weeklyLaborHours() | number:'1.0-1') + 'h'"
          [sub]="'adminDashboard.kpiLaborWorkedSub' | transloco: { week: weekLabel }">
        </app-stat-card>
      </div>

      <section *ngIf="orgId" class="ad-workforce-center">
        <article class="ad-workforce-card" [class.is-warn]="incompleteProfileCount() > 0">
          <mat-icon>manage_accounts</mat-icon>
          <div>
            <span>{{ 'adminDashboard.profileReadiness' | transloco }}</span>
            <strong>{{ profileReadyPercent() }}%</strong>
            <small>{{ 'adminDashboard.profileReadinessSub' | transloco: { count: incompleteProfileCount(), term: terminology.workforceMemberSingular() | lowercase } }}</small>
          </div>
          <a routerLink="/admin/employees">{{ 'adminDashboard.review' | transloco }}</a>
        </article>
        <article class="ad-workforce-card" [class.is-warn]="missingPayrollSetupCount() > 0">
          <mat-icon>payments</mat-icon>
          <div>
            <span>{{ 'adminDashboard.payrollSetup' | transloco }}</span>
            <strong>{{ missingPayrollSetupCount() }}</strong>
            <small>{{ 'adminDashboard.payrollSetupSub' | transloco }}</small>
          </div>
          <a routerLink="/admin/payroll">{{ 'adminDashboard.open' | transloco }}</a>
        </article>
        <article class="ad-workforce-card" [class.is-warn]="pendingPtoCount() > 0">
          <mat-icon>event_available</mat-icon>
          <div>
            <span>{{ 'adminDashboard.ptoQueue' | transloco }}</span>
            <strong>{{ pendingPtoCount() }}</strong>
            <small>{{ 'adminDashboard.ptoQueueSub' | transloco: { count: approvedPtoCount() } }}</small>
          </div>
          <a routerLink="/admin/pto">{{ 'adminDashboard.manage' | transloco }}</a>
        </article>
        <article class="ad-workforce-card" [class.is-warn]="totalExceptionsForCenter() > 0">
          <mat-icon>fact_check</mat-icon>
          <div>
            <span>{{ 'adminDashboard.operationalRisk' | transloco }}</span>
            <strong>{{ totalExceptionsForCenter() }}</strong>
            <small>{{ 'adminDashboard.operationalRiskSub' | transloco: { term: terminology.workUnitSingular() | lowercase, termPlural: terminology.workUnitPlural() | lowercase } }}</small>
          </div>
          <a routerLink="/admin/timesheets">{{ 'adminDashboard.resolve' | transloco }}</a>
        </article>
      </section>

      <!-- Quick Links -->
      <div *ngIf="orgId" class="ad-quick-links">
        <a routerLink="/admin/shifts/new" class="ad-ql-card vs-glass" *ngIf="!isHidden('quickLinks.createShift')">
          <div class="ad-ql-icon"><mat-icon>add_circle</mat-icon></div>
          <div class="ad-ql-label">{{ 'adminDashboard.quickLinkCreateShift' | transloco: { term: terminology.workUnitSingular() } }}</div>
        </a>
        <a routerLink="/admin/scheduler" class="ad-ql-card vs-glass" *ngIf="!isHidden('quickLinks.scheduler')">
          <div class="ad-ql-icon"><mat-icon>calendar_month</mat-icon></div>
          <div class="ad-ql-label">{{ 'adminDashboard.scheduler' | transloco }}</div>
        </a>
        <a routerLink="/app/marketplace" class="ad-ql-card vs-glass" *ngIf="!isHidden('quickLinks.marketplace')">
          <div class="ad-ql-icon"><mat-icon>storefront</mat-icon></div>
          <div class="ad-ql-label">{{ 'adminDashboard.marketplace' | transloco }}</div>
        </a>
        <a routerLink="/admin/employees" class="ad-ql-card vs-glass" *ngIf="!isHidden('quickLinks.employees')">
          <div class="ad-ql-icon"><mat-icon>people</mat-icon></div>
          <div class="ad-ql-label">{{ terminology.workforceMemberPlural() }}</div>
        </a>
        <a routerLink="/admin/timesheets" class="ad-ql-card vs-glass" *ngIf="!isHidden('quickLinks.timesheets')">
          <div class="ad-ql-icon"><mat-icon>receipt_long</mat-icon></div>
          <div class="ad-ql-label">{{ 'adminDashboard.timesheets' | transloco }}</div>
        </a>
        <a routerLink="/admin/payroll" class="ad-ql-card vs-glass" *ngIf="!isHidden('quickLinks.payroll')">
          <div class="ad-ql-icon"><mat-icon>payments</mat-icon></div>
          <div class="ad-ql-label">{{ 'adminDashboard.payroll' | transloco }}</div>
        </a>
        <a routerLink="/admin/audit" class="ad-ql-card vs-glass" *ngIf="canViewAudit() && !isHidden('quickLinks.auditLog')">
          <div class="ad-ql-icon"><mat-icon>history</mat-icon></div>
          <div class="ad-ql-label">{{ 'adminDashboard.auditLog' | transloco }}</div>
        </a>
        <a routerLink="/admin/org-settings" class="ad-ql-card vs-glass" *ngIf="!isHidden('quickLinks.orgSettings')">
          <div class="ad-ql-icon"><mat-icon>business</mat-icon></div>
          <div class="ad-ql-label">{{ 'adminDashboard.orgSettings' | transloco }}</div>
        </a>
      </div>

      <section *ngIf="orgId" class="ad-command-grid">
        <article class="ad-command-card ad-command-card--primary">
          <div class="ad-command-icon"><mat-icon>campaign</mat-icon></div>
          <div>
            <h2>{{ 'adminDashboard.communicateTitle' | transloco }}</h2>
            <p>{{ 'adminDashboard.communicateBody' | transloco: { term: terminology.workUnitSingular() | lowercase } }}</p>
            <a href="#ad-communication-center">{{ 'adminDashboard.openCommunicationCenter' | transloco }}</a>
          </div>
        </article>
        <article class="ad-command-card">
          <div class="ad-command-icon"><mat-icon>fact_check</mat-icon></div>
          <div>
            <h2>{{ 'adminDashboard.reviewRequestsTitle' | transloco: { term: terminology.workforceMemberPlural() | lowercase } }}</h2>
            <p>{{ 'adminDashboard.reviewRequestsBody' | transloco: { count: actionQueueCount(), term: terminology.workUnitSingular() | lowercase } }}</p>
            <div class="ad-command-pills">
              <span>{{ 'adminDashboard.pillShiftSwitch' | transloco: { count: swapRequests().length, term: terminology.workUnitSingular() | lowercase } }}</span>
              <span>{{ 'adminDashboard.pillTimecard' | transloco: { count: pending().length } }}</span>
            </div>
          </div>
        </article>
        <article class="ad-command-card">
          <div class="ad-command-icon"><mat-icon>groups</mat-icon></div>
          <div>
            <h2>{{ 'adminDashboard.staffCoverageTitle' | transloco }}</h2>
            <p>{{ 'adminDashboard.staffCoverageBody' | transloco: { pct: coverageRate(), term: terminology.workUnitPlural() | lowercase } }}</p>
            <div class="ad-command-pills">
              <span>{{ 'adminDashboard.pillAssigned' | transloco: { count: metrics()?.assignedCount ?? 0 } }}</span>
              <span>{{ 'adminDashboard.pillOpen' | transloco: { count: metrics()?.openCount ?? 0 } }}</span>
            </div>
          </div>
        </article>
      </section>

      <!-- Shift Lifecycle Status Tabs -->
      <section *ngIf="orgId" class="vs-glass-strong ad-section">
        <div class="vs-panel-head">
          <div>
            <div class="vs-panel-title">{{ 'adminDashboard.lifecycleOverview' | transloco: { term: terminology.workUnitSingular() } }}</div>
            <div class="vs-panel-subtitle">{{ 'adminDashboard.thisWeek' | transloco: { week: weekLabel } }}</div>
          </div>
        </div>
        <div class="ad-lifecycle-tabs">
          <button *ngFor="let tab of lifecycleTabs"
                  class="ad-lc-tab"
                  [class.ad-lc-tab--active]="lifecycleTab === tab.key"
                  (click)="selectLifecycleTab(tab.key)">
            <mat-icon>{{ tab.icon }}</mat-icon>
            <span>{{ tab.labelKey | transloco }}</span>
            <span class="ad-lc-count" *ngIf="lifecycleTab === tab.key">{{ lifecycleShifts().length }}</span>
          </button>
        </div>
        <div class="ad-table-toolbar" *ngIf="lifecycleShifts().length > 0">
          <input
            type="search"
            class="ad-table-search"
            [placeholder]="'adminDashboard.searchLifecyclePlaceholder' | transloco"
            [value]="lifecycleCtrl.filterText()"
            (input)="lifecycleCtrl.setFilter($any($event.target).value)">
        </div>
        <div class="vs-table-shell">
          <table class="vs-table ad-table">
            <thead>
              <tr>
                <th class="ad-th-sort" (click)="lifecycleCtrl.toggleSort('title')">{{ 'adminDashboard.colTitle' | transloco }} {{ lifecycleCtrl.sortIndicator('title') }}</th>
                <th class="ad-th-sort" (click)="lifecycleCtrl.toggleSort('start')">{{ 'adminDashboard.colDate' | transloco }} {{ lifecycleCtrl.sortIndicator('start') }}</th>
                <th>{{ 'adminDashboard.colTime' | transloco }}</th>
                <th>{{ 'adminDashboard.colLocation' | transloco }}</th>
                <th>{{ 'adminDashboard.colAssignedTo' | transloco }}</th>
                <th>{{ 'adminDashboard.colStatus' | transloco }}</th>
              </tr>
            </thead>
            <tbody>
              <tr class="vs-empty" *ngIf="lifecycleCtrl.pageRows().length === 0">
                <td colspan="6">{{ 'adminDashboard.noShiftsForStatus' | transloco: { term: terminology.workUnitPlural(), status: lifecycleTab } }}</td>
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
            <div class="vs-panel-title">{{ 'adminDashboard.switchRequests' | transloco: { term: terminology.workUnitSingular() } }}</div>
            <div class="vs-panel-subtitle">{{ 'adminDashboard.switchRequestsSub' | transloco: { term: terminology.workUnitSingular() | lowercase } }}</div>
          </div>
          <div class="ad-actions-cell">
            <span class="vs-badge" [class.vs-badge--warning]="swapRequests().length > 0" [class.vs-badge--neutral]="swapRequests().length === 0">
              {{ 'adminDashboard.pending' | transloco: { count: swapRequests().length } }}
            </span>
            <button class="vs-btn-ghost ad-action-btn" (click)="refreshSwapRequests()" [disabled]="swapListBusy">
              <mat-icon>sync</mat-icon> {{ (swapListBusy ? 'adminDashboard.loading' : 'adminDashboard.refresh') | transloco }}
            </button>
          </div>
        </div>

        <div *ngIf="swapRequests().length === 0" class="ad-empty">
          <mat-icon>check_circle</mat-icon>
          <span>{{ 'adminDashboard.noPendingSwitchRequests' | transloco: { term: terminology.workUnitSingular() | lowercase } }}</span>
        </div>

        <div *ngIf="swapRequests().length > 0" class="vs-table-shell">
          <table class="vs-table ad-table">
            <thead>
              <tr>
                <th>{{ 'adminDashboard.colType' | transloco }}</th>
                <th class="ad-th-sort" (click)="swapCtrl.toggleSort('shift')">{{ 'adminDashboard.colSourceShift' | transloco: { term: terminology.workUnitSingular() } }} {{ swapCtrl.sortIndicator('shift') }}</th>
                <th>{{ 'adminDashboard.colRequester' | transloco }}</th>
                <th>{{ 'adminDashboard.colTarget' | transloco }}</th>
                <th class="ad-th-sort" (click)="swapCtrl.toggleSort('requested')">{{ 'adminDashboard.colRequested' | transloco }} {{ swapCtrl.sortIndicator('requested') }}</th>
                <th style="text-align:right">{{ 'adminDashboard.colActions' | transloco }}</th>
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
                    {{ 'adminDashboard.tradeFor' | transloco: { title: r.targetShiftTitle, range: fmtMsRange(r.targetStartAtMs, r.targetEndAtMs) } }}
                  </div>
                </td>
                <td>{{ r.requesterName || ('adminDashboard.staffMemberFallback' | transloco) }}</td>
                <td>{{ r.targetName || ('adminDashboard.staffMemberFallback' | transloco) }}</td>
                <td>{{ fmtMs(r.createdAtMs) }}</td>
                <td style="text-align:right">
                  <div class="ad-actions-cell">
                    <button class="vs-btn-ghost ad-action-btn ad-action-btn--approve"
                            (click)="decideSwap(r, 'accept')"
                            [disabled]="swapBusyId === r.requestId">
                      <mat-icon>check</mat-icon> {{ 'adminDashboard.approve' | transloco }}
                    </button>
                    <button class="vs-btn-ghost ad-action-btn ad-action-btn--reject"
                            (click)="decideSwap(r, 'reject')"
                            [disabled]="swapBusyId === r.requestId">
                      <mat-icon>close</mat-icon> {{ 'adminDashboard.decline' | transloco }}
                    </button>
                    <button class="vs-btn-ghost ad-action-btn"
                            (click)="decideSwap(r, 'cancel')"
                            [disabled]="swapBusyId === r.requestId">
                      <mat-icon>block</mat-icon> {{ 'adminDashboard.cancel' | transloco }}
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
            <div class="vs-panel-title">{{ 'adminDashboard.pendingTimeCorrections' | transloco }}</div>
            <div class="vs-panel-subtitle">{{ 'adminDashboard.pendingTimeCorrectionsSub' | transloco: { term: terminology.workforceMemberSingular() | lowercase } }}</div>
          </div>
          <span class="vs-badge" [class.vs-badge--warning]="pending().length > 0" [class.vs-badge--neutral]="pending().length === 0">
            {{ 'adminDashboard.pending' | transloco: { count: pending().length } }}
          </span>
        </div>

        <div *ngIf="pending().length === 0" class="ad-empty">
          <mat-icon>check_circle</mat-icon>
          <span>{{ 'adminDashboard.noPendingApprovals' | transloco }}</span>
        </div>

        <div *ngIf="pending().length > 0" class="vs-table-shell">
          <table class="vs-table ad-table">
            <thead>
              <tr>
                <th>{{ terminology.workforceMemberSingular() }}</th>
                <th>{{ terminology.workUnitSingular() }}</th>
                <th class="ad-th-sort" (click)="pendingCtrl.toggleSort('checkIn')">{{ 'adminDashboard.colCheckIn' | transloco }} {{ pendingCtrl.sortIndicator('checkIn') }}</th>
                <th class="ad-th-sort" (click)="pendingCtrl.toggleSort('checkOut')">{{ 'adminDashboard.colCheckOut' | transloco }} {{ pendingCtrl.sortIndicator('checkOut') }}</th>
                <th style="text-align:right">{{ 'adminDashboard.colActions' | transloco }}</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let e of pendingCtrl.pageRows()" class="vs-row">
                <td>
                  <span class="vs-strong">{{ pendingUserLabel(e) }}</span>
                </td>
                <td class="vs-muted">{{ 'adminDashboard.assignedShiftFallback' | transloco: { term: terminology.workUnitSingular() } }}</td>
                <td>{{ fmt(e.checkInAt) }}</td>
                <td>{{ fmt(e.checkOutAt) }}</td>
                <td style="text-align:right">
                  <div class="ad-actions-cell">
                    <button class="vs-btn-ghost ad-action-btn ad-action-btn--approve"
                            (click)="decide(e.id, 'approved')"
                            [disabled]="busyId === e.id">
                      <mat-icon>check</mat-icon> {{ 'adminDashboard.approve' | transloco }}
                    </button>
                    <button class="vs-btn-ghost ad-action-btn ad-action-btn--reject"
                            (click)="decide(e.id, 'rejected')"
                            [disabled]="busyId === e.id">
                      <mat-icon>close</mat-icon> {{ 'adminDashboard.reject' | transloco }}
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
            <div class="vs-panel-title">{{ 'adminDashboard.communicationCenter' | transloco }}</div>
            <div class="vs-panel-subtitle">{{ 'adminDashboard.communicationCenterSub' | transloco }}</div>
          </div>
        </div>

        <div class="ad-comm-form">
          <div class="vs-form-row vs-form-row--2">
            <div>
              <label class="vs-field-label">{{ 'adminDashboard.titleRequired' | transloco }}</label>
              <input class="vs-input" [(ngModel)]="commTitle" [placeholder]="'adminDashboard.titlePlaceholder' | transloco">
            </div>
            <div>
              <label class="vs-field-label">{{ 'adminDashboard.type' | transloco }}</label>
              <select class="vs-select" [(ngModel)]="commType">
                <option value="announcement">{{ 'adminDashboard.typeAnnouncement' | transloco }}</option>
                <option value="system">{{ 'adminDashboard.typeSystem' | transloco }}</option>
                <option value="alert">{{ 'adminDashboard.typeAlert' | transloco }}</option>
                <option value="policy">{{ 'adminDashboard.typePolicy' | transloco }}</option>
              </select>
            </div>
          </div>

          <div class="vs-form-row">
            <div>
              <label class="vs-field-label">{{ 'adminDashboard.messageRequired' | transloco }}</label>
              <textarea class="vs-input" rows="3" [(ngModel)]="commBody" [placeholder]="'adminDashboard.messagePlaceholder' | transloco"></textarea>
            </div>
          </div>

          <div class="vs-form-row vs-form-row--2">
            <div>
              <label class="vs-field-label">{{ 'adminDashboard.audience' | transloco }}</label>
              <select class="vs-select" [(ngModel)]="commTargetType" (ngModelChange)="onTargetTypeChange()">
                <option value="single">{{ 'adminDashboard.audienceSingle' | transloco }}</option>
                <option value="multi">{{ 'adminDashboard.audienceMulti' | transloco }}</option>
                <option value="orgAll">{{ 'adminDashboard.audienceOrgAll' | transloco }}</option>
                <option value="platformAll" *ngIf="isSuperAdmin()">{{ 'adminDashboard.audiencePlatformAll' | transloco }}</option>
              </select>
            </div>
            <div>
              <label class="vs-field-label">{{ 'adminDashboard.delivery' | transloco }}</label>
              <div class="ad-comm-checks">
                <label><input type="checkbox" [(ngModel)]="commInApp"> {{ 'adminDashboard.deliveryInApp' | transloco }}</label>
                <label><input type="checkbox" [(ngModel)]="commInternet"> {{ 'adminDashboard.deliveryInternet' | transloco }}</label>
              </div>
            </div>
          </div>

          <div class="vs-form-row" *ngIf="commTargetType==='single' || commTargetType==='multi'">
            <div>
              <label class="vs-field-label">{{ 'adminDashboard.targetUsers' | transloco }}</label>
              <input class="vs-input" [(ngModel)]="commUserQuery" (ngModelChange)="refreshCommCandidates()" [placeholder]="'adminDashboard.targetUsersPlaceholder' | transloco">
              <div class="ad-comm-users" *ngIf="commCandidates.length > 0">
                <button type="button"
                        *ngFor="let u of commCandidates"
                        class="ad-user-pill"
                        [class.ad-user-pill--active]="isUserSelected(u.uid)"
                        (click)="toggleUserSelection(u.uid)">
                  {{ commUserLabel(u) }}
                </button>
              </div>
              <div class="ad-comm-help">{{ (commTargetType==='single' ? 'adminDashboard.selectOneUser' : 'adminDashboard.selectOneOrMultipleUsers') | transloco }}</div>
            </div>
          </div>

          <div class="vs-form-row" *ngIf="commInternet">
            <div>
              <label class="vs-field-label">{{ 'adminDashboard.internetChannel' | transloco }}</label>
              <select class="vs-select" [(ngModel)]="commInternetChannel">
                <option value="email">{{ 'adminDashboard.channelEmail' | transloco }}</option>
                <option value="sms">{{ 'adminDashboard.channelSms' | transloco }}</option>
              </select>
            </div>
          </div>

          <div class="ad-comm-actions">
            <button class="vs-btn-primary" (click)="sendCommunication()" [disabled]="commBusy">
              <mat-icon>send</mat-icon>
              {{ (commBusy ? 'adminDashboard.sending' : 'adminDashboard.sendMessage') | transloco }}
            </button>
          </div>
        </div>
      </section>

      <!-- Metrics timestamp -->
      <div *ngIf="orgId && metrics()?.updatedAt" class="ad-updated">
        <mat-icon>update</mat-icon>
        {{ 'adminDashboard.metricsRefreshed' | transloco: { time: fmt(metrics()!.updatedAt) } }}
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
    { key: 'open' as ShiftStatus,       labelKey: 'adminDashboard.lifecycleOpen',       icon: 'event_available' },
    { key: 'claimed' as ShiftStatus,    labelKey: 'adminDashboard.lifecycleClaimed',    icon: 'how_to_reg' },
    { key: 'in_progress' as ShiftStatus,labelKey: 'adminDashboard.lifecycleInProgress', icon: 'timelapse' },
    { key: 'completed' as ShiftStatus,  labelKey: 'adminDashboard.lifecycleCompleted',  icon: 'check_circle' },
    { key: 'expired' as ShiftStatus,    labelKey: 'adminDashboard.lifecycleExpired',    icon: 'timer_off' },
    { key: 'cancelled' as ShiftStatus,  labelKey: 'adminDashboard.lifecycleCancelled',  icon: 'cancel' },
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
    private plans: PlanEntitlementsService,
    public terminology: TerminologyService,
    private orgExperience: OrgExperienceService,
    private i18n: TranslocoService
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

  isHidden(key: string) {
    return isNavKeyHidden(key, this.orgExperience.config());
  }

  async decide(entryId: string, decision: 'approved' | 'rejected') {
    this.busyId = entryId;
    try {
      await this.adminCmd.decideTimeCorrection(entryId, decision);
      this.toast.success(this.i18n.translate(decision === 'approved' ? 'adminDashboard.correctionApproved' : 'adminDashboard.correctionRejected'));
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('adminDashboard.decisionFailed'));
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
      this.toast.errorFrom(e, this.i18n.translate('adminDashboard.failedToLoadSwitchRequests', { term: this.terminology.workUnitSingular().toLowerCase() }));
    } finally {
      this.swapListBusy = false;
    }
  }

  async decideSwap(r: any, decision: 'accept' | 'reject' | 'cancel') {
    if (!r?.requestId || this.swapBusyId) return;
    this.swapBusyId = r.requestId;
    try {
      await this.shiftCommands.respondShiftSwap(r.requestId, decision);
      const key = decision === 'accept' ? 'adminDashboard.switchApproved' : decision === 'reject' ? 'adminDashboard.switchDeclined' : 'adminDashboard.switchCancelled';
      this.toast.success(this.i18n.translate(key, { term: this.terminology.workUnitSingular() }));
      await this.refreshSwapRequests();
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('adminDashboard.switchDecisionFailed', { term: this.terminology.workUnitSingular() }));
    } finally {
      this.swapBusyId = null;
    }
  }

  swapKindLabel(r: any) {
    return this.i18n.translate(r?.kind === 'swap' ? 'adminDashboard.trade' : 'adminDashboard.cover');
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
      this.toast.error(this.i18n.translate('adminDashboard.titleAndMessageRequired'));
      return;
    }

    const userIds = this.commSelectedUserIds.slice();

    if ((this.commTargetType === 'single' || this.commTargetType === 'multi') && !userIds.length) {
      this.toast.error(this.i18n.translate('adminDashboard.targetUidRequired'));
      return;
    }

    if (this.commTargetType === 'single' && userIds.length !== 1) {
      this.toast.error(this.i18n.translate('adminDashboard.singleTargetRequired'));
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

      this.toast.success(this.i18n.translate('adminDashboard.messageSentTo', { count: res?.recipientCount ?? 0 }));
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
      this.toast.errorFrom(e, this.i18n.translate('adminDashboard.failedToSendMessage'));
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
    if (!uid) return this.i18n.translate('adminDashboard.unknownEmployeeFallback', { term: this.terminology.workforceMemberSingular() });
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
