import { Component, EffectRef, OnDestroy, effect, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { Timestamp } from 'firebase/firestore';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { ShiftsCommands } from '../../core/commands/shifts.commands';
import { NotificationsRepo, UserNotification } from '../../core/repos/notifications.repo';
import { Shift } from '../../shared/models/shift.model';
import { ToastService } from '../../core/ui/toast.service';
import { mapAttendancePolicyError } from '../../shared/utils/attendance-policy-error.util';
import { getCurrentWeekRange, fmtShiftDate, fmtShiftTime, canClaimShift, shiftHours } from '../../shared/utils/shift-lifecycle.utils';
import { scoreShiftMatch, ShiftMatchLabel } from '../../shared/utils/shift-match.util';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, CurrencyPipe],
  template: `
    <div class="vs-page-pad mk-page">
      <header class="mk-header">
        <div>
          <div class="mk-eyebrow">Staff Marketplace</div>
          <h1>Open Shifts</h1>
          <p>Find available shifts, claim extra hours, and manage switch requests.</p>
        </div>
        <div class="mk-header-actions">
          <button class="vs-btn-ghost mk-nav-btn" type="button" (click)="prevWeek()">
            <mat-icon>chevron_left</mat-icon>
            Previous
          </button>
          <button class="vs-btn-secondary mk-nav-btn" type="button" (click)="thisWeek()">
            <mat-icon>today</mat-icon>
            This week
          </button>
          <button class="vs-btn-ghost mk-nav-btn" type="button" (click)="nextWeek()">
            Next
            <mat-icon>chevron_right</mat-icon>
          </button>
        </div>
      </header>

      <div *ngIf="!orgId" class="mk-no-org vs-glass">
        <mat-icon>warning_amber</mat-icon> Missing org context.
      </div>

      <ng-container *ngIf="orgId">
        <section class="mk-current-banner vs-glass-strong" *ngIf="currentShift() as cs">
          <div class="mk-current-inner">
            <span class="vs-badge vs-badge--warning">In Progress</span>
            <strong>{{ cs.title }}</strong>
            <span class="mk-current-time">{{ fmtTime(cs.startAt) }} - {{ fmtTime(cs.endAt) }}</span>
          </div>
          <button class="vs-btn-primary mk-btn" (click)="goToAttendance()">
            <mat-icon>timer</mat-icon> Clock Out
          </button>
        </section>

        <section class="mk-summary-grid">
          <div class="mk-summary-card">
            <mat-icon>event_available</mat-icon>
            <div>
              <span>Available</span>
              <strong>{{ items().length }}</strong>
            </div>
          </div>
          <div class="mk-summary-card">
            <mat-icon>schedule</mat-icon>
            <div>
              <span>Open Hours</span>
              <strong>{{ availableHours().toFixed(1) }}</strong>
            </div>
          </div>
          <div class="mk-summary-card">
            <mat-icon>sync_alt</mat-icon>
            <div>
              <span>My Requests</span>
              <strong>{{ userRequestCount() }}</strong>
            </div>
          </div>
          <div class="mk-summary-card">
            <mat-icon>calendar_month</mat-icon>
            <div>
              <span>Week</span>
              <strong class="mk-summary-date">{{ weekLabel }}</strong>
            </div>
          </div>
        </section>

        <section class="mk-tools vs-glass-strong">
          <div class="mk-search">
            <mat-icon>search</mat-icon>
            <input class="mk-search-input" [(ngModel)]="marketQuery" placeholder="Search shift, location, or role">
          </div>
          <select class="vs-select mk-role-filter" [(ngModel)]="roleFilter">
            <option value="">All roles</option>
            <option *ngFor="let role of roleOptions()" [value]="role">{{ role }}</option>
          </select>
          <div class="mk-tabs" role="tablist">
            <button type="button" [class.is-active]="marketView === 'available'" (click)="marketView='available'">
              <mat-icon>storefront</mat-icon> Available
            </button>
            <button type="button" [class.is-active]="marketView === 'requests'" (click)="marketView='requests'">
              <mat-icon>swap_horiz</mat-icon> Requests
            </button>
            <button type="button" [class.is-active]="marketView === 'activity'" (click)="marketView='activity'">
              <mat-icon>notifications</mat-icon> Activity
            </button>
            <button type="button" *ngIf="isAdminLike" [class.is-active]="marketView === 'approvals'" (click)="marketView='approvals'">
              <mat-icon>verified</mat-icon> Approvals
            </button>
          </div>
        </section>

        <section class="mk-board" *ngIf="marketView === 'available'">
          <div class="mk-state" *ngIf="marketLoading()">
            <mat-icon>hourglass_top</mat-icon>
            <strong>Loading open shifts</strong>
            <span>Checking this week’s available schedule.</span>
          </div>

          <div class="mk-state mk-state--error" *ngIf="!marketLoading() && marketError()">
            <mat-icon>error_outline</mat-icon>
            <strong>Marketplace unavailable</strong>
            <span>{{ marketError() }}</span>
          </div>

          <div class="mk-state" *ngIf="!marketLoading() && !marketError() && filteredItems().length === 0">
            <mat-icon>event_busy</mat-icon>
            <strong>No matching open shifts</strong>
            <span>Try another role, search term, or week.</span>
          </div>

          <div class="mk-shift-grid" *ngIf="!marketLoading() && !marketError() && filteredItems().length > 0">
            <article *ngFor="let s of filteredItems()" class="mk-shift-card">
              <div class="mk-shift-card-top">
                <div class="mk-shift-date">
                  <span>{{ fmtDate(s.startAt).split(' ')[0] }}</span>
                  <strong>{{ fmtDate(s.startAt).replace(fmtDate(s.startAt).split(' ')[0], '').trim() }}</strong>
                </div>
                <div class="mk-shift-title">
                  <h2>{{ s.title }}</h2>
                  <span>{{ s.locationName || 'Location TBD' }}</span>
                </div>
                <span class="vs-badge vs-badge--primary" *ngIf="shiftRole(s)">{{ shiftRole(s) }}</span>
              </div>
              <div class="mk-match" *ngIf="matchBadge(s) as mb" [ngClass]="mb.cls">
                <mat-icon>{{ mb.icon }}</mat-icon>{{ mb.label }}
              </div>
              <div class="mk-shift-meta">
                <span><mat-icon>schedule</mat-icon>{{ fmtTime(s.startAt) }} - {{ fmtTime(s.endAt) }}</span>
                <span><mat-icon>access_time</mat-icon>{{ hrs(s) }}h</span>
                <span><mat-icon>payments</mat-icon>{{ s.payRate ? (s.payRate | currency:moneyCurrency()) + '/hr' : 'Rate TBD' }}</span>
              </div>
              <div class="mk-shift-actions">
                <div>
                  <strong>{{ claimLabel(s) }}</strong>
                  <span>{{ isNightShift(s) ? 'Night shift' : 'Day shift' }}</span>
                </div>
                <button class="vs-btn-primary mk-claim-btn" (click)="claim(s.id)" [disabled]="busyId === s.id || !canClaim(s)">
                  <mat-icon>add_circle</mat-icon>
                  {{ busyId === s.id ? 'Claiming...' : 'Claim Shift' }}
                </button>
              </div>
            </article>
          </div>
        </section>

        <section class="mk-board" *ngIf="marketView === 'requests'">
          <div class="mk-section-head">
            <div>
              <h2>{{ isAdminLike ? 'Shift Switch Requests' : 'My Shift Requests' }}</h2>
              <p>Review pending covers and trades.</p>
            </div>
            <button class="vs-btn-secondary" type="button" (click)="refreshSwapRequests()" [disabled]="swapLoading">
              <mat-icon>refresh</mat-icon>{{ swapLoading ? 'Loading' : 'Refresh' }}
            </button>
          </div>
          <div class="mk-state mk-state--error" *ngIf="swapError">
            <mat-icon>error_outline</mat-icon>
            <strong>Requests unavailable</strong>
            <span>{{ swapError }}</span>
          </div>
          <div class="mk-state" *ngIf="!swapError && swapRequests.length === 0">
            <mat-icon>swap_horiz</mat-icon>
            <strong>No shift requests yet</strong>
            <span>Your cover and trade requests will appear here.</span>
          </div>
          <div class="mk-request-list" *ngIf="!swapError && swapRequests.length > 0">
            <article class="mk-request-row" *ngFor="let r of swapRequests">
              <div class="mk-person-dot">{{ initials(swapCounterparty(r)) }}</div>
              <div class="mk-request-main">
                <strong>{{ swapKindLabel(r) }} - {{ r.shiftTitle }}</strong>
                <span>{{ swapCounterparty(r) }} - {{ fmtMsRange(r.sourceStartAtMs, r.sourceEndAtMs) }}</span>
              </div>
              <span class="vs-badge" [class.vs-badge--warning]="r.status === 'pending'" [class.vs-badge--success]="r.status === 'approved'" [class.vs-badge--danger]="r.status === 'rejected' || r.status === 'cancelled'">
                {{ r.status }}
              </span>
              <div class="mk-request-actions" *ngIf="r.status === 'pending'">
                <button class="vs-btn-secondary" *ngIf="canApproveSwap(r)" (click)="respondSwap(r, 'reject')" [disabled]="swapBusyId === r.requestId">Decline</button>
                <button class="vs-btn-primary" *ngIf="canApproveSwap(r)" (click)="respondSwap(r, 'accept')" [disabled]="swapBusyId === r.requestId">Accept</button>
                <button class="vs-btn-secondary" *ngIf="canCancelSwap(r)" (click)="respondSwap(r, 'cancel')" [disabled]="swapBusyId === r.requestId">Cancel</button>
              </div>
            </article>
          </div>
        </section>

        <section class="mk-board" *ngIf="marketView === 'activity'">
          <div class="mk-section-head">
            <div>
              <h2>Team Activity</h2>
              <p>Recent marketplace and schedule updates.</p>
            </div>
            <button class="vs-btn-secondary" type="button" (click)="goToNotifications()">
              <mat-icon>notifications</mat-icon> Notifications
            </button>
          </div>
          <div class="mk-state" *ngIf="teamActivityItems().length === 0">
            <mat-icon>notifications_none</mat-icon>
            <strong>No recent activity</strong>
            <span>New shift updates will appear here.</span>
          </div>
          <div class="mk-request-list" *ngIf="teamActivityItems().length > 0">
            <article class="mk-request-row" *ngFor="let a of teamActivityItems()">
              <div class="mk-person-dot mk-person-dot--blue">{{ initials(a.title) }}</div>
              <div class="mk-request-main">
                <strong>{{ a.title }}</strong>
                <span>{{ a.body || 'Schedule activity updated.' }}</span>
              </div>
              <small>{{ fmtActivity(a.createdAt) }}</small>
            </article>
          </div>
        </section>

        <section class="mk-board" *ngIf="marketView === 'approvals' && isAdminLike">
          <div class="mk-section-head">
            <div>
              <h2>Quick Approvals</h2>
              <p>Manager review for pending cover and trade requests.</p>
            </div>
            <button class="vs-btn-secondary" type="button" (click)="refreshSwapRequests()">
              <mat-icon>refresh</mat-icon> Refresh
            </button>
          </div>
          <div class="mk-state" *ngIf="quickApprovals().length === 0">
            <mat-icon>done_all</mat-icon>
            <strong>No pending approvals</strong>
            <span>All shift requests are handled.</span>
          </div>
          <div class="mk-request-list" *ngIf="quickApprovals().length > 0">
            <article class="mk-request-row" *ngFor="let r of quickApprovals()">
              <div class="mk-person-dot mk-person-dot--warm">{{ initials(r.requesterName || r.requesterUid) }}</div>
              <div class="mk-request-main">
                <strong>{{ r.requesterName || 'Staff member' }} -> {{ r.targetName || 'Staff member' }}</strong>
                <span>{{ swapKindLabel(r) }} - {{ fmtMsRange(r.sourceStartAtMs, r.sourceEndAtMs) }}</span>
              </div>
              <div class="mk-request-actions">
                <button class="vs-btn-secondary" (click)="respondSwap(r, 'reject')" [disabled]="swapBusyId === r.requestId">Decline</button>
                <button class="vs-btn-primary" (click)="respondSwap(r, 'accept')" [disabled]="swapBusyId === r.requestId">Approve</button>
              </div>
            </article>
          </div>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .mk-page {
      --mk-bg: #020817;
      --mk-panel: rgba(7, 18, 44, 0.86);
      --mk-panel-soft: rgba(15, 23, 42, 0.72);
      --mk-border: rgba(34, 211, 238, 0.20);
      --mk-border-strong: rgba(34, 211, 238, 0.42);
      --mk-blue: #2563eb;
      --mk-cyan: #22d3ee;
      --mk-text: rgba(248, 250, 252, 0.96);
      --mk-muted: rgba(203, 213, 225, 0.78);
      --mk-subtle: rgba(148, 163, 184, 0.68);
      min-height: calc(100vh - 64px);
      margin: -28px -24px;
      padding: 24px;
      color: var(--text);
      background: var(--app-bg);
    }

    .mk-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 18px;
    }
    .mk-eyebrow {
      color: var(--primary);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .mk-header h1 {
      margin: 4px 0 0;
      color: var(--text);
      font-size: clamp(28px, 4vw, 42px);
      line-height: 1;
      font-weight: 950;
      letter-spacing: 0;
    }
    .mk-header p {
      max-width: 620px;
      margin: 8px 0 0;
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.5;
    }
    .mk-header-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }
    .mk-nav-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 40px;
      white-space: nowrap;
    }
    .mk-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin: 16px 0;
    }
    .mk-summary-card {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 86px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg-surface);
      box-shadow: var(--shadow-sm);
    }
    .mk-summary-card mat-icon {
      width: 38px;
      height: 38px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      color: var(--primary);
      background: rgba(29,78,216,0.10);
      font-size: 21px;
    }
    .mk-summary-card span {
      display: block;
      color: var(--text-subtle);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .mk-summary-card strong {
      display: block;
      margin-top: 4px;
      color: var(--text);
      font-size: 26px;
      font-weight: 950;
      line-height: 1;
    }
    .mk-summary-card .mk-summary-date {
      font-size: 16px;
      line-height: 1.2;
    }
    .mk-tools {
      display: grid;
      grid-template-columns: minmax(240px, 1fr) minmax(160px, 220px) auto;
      align-items: center;
      gap: 12px;
      padding: 12px;
      margin-bottom: 16px;
      border: 1px solid var(--border);
    }
    .mk-search {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 44px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-surface);
      color: var(--text-muted);
    }
    .mk-search-input {
      width: 100%;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-size: 14px;
    }
    .mk-search-input::placeholder {
      color: var(--text-subtle);
    }
    .mk-role-filter {
      min-height: 44px;
    }
    .mk-tabs {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-elevated);
    }
    .mk-tabs button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 36px;
      padding: 0 11px;
      border: 1px solid transparent;
      border-radius: 10px;
      background: transparent;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 850;
      cursor: pointer;
      white-space: nowrap;
    }
    .mk-tabs button.is-active {
      color: var(--primary);
      background: rgba(29,78,216,0.10);
      border-color: rgba(29,78,216,0.22);
    }
    .mk-tabs mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .mk-board {
      min-height: 280px;
    }
    .mk-state {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 8px;
      min-height: 260px;
      padding: 28px;
      border: 1px dashed var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg-surface);
      text-align: center;
      color: var(--text-muted);
    }
    .mk-state mat-icon {
      color: var(--primary);
      font-size: 34px;
      width: 34px;
      height: 34px;
    }
    .mk-state strong {
      color: var(--text);
      font-size: 16px;
      font-weight: 900;
    }
    .mk-state span {
      max-width: 420px;
      font-size: 13px;
      line-height: 1.45;
    }
    .mk-state--error {
      border-color: rgba(239,68,68,0.32);
      background: rgba(239,68,68,0.06);
    }
    .mk-state--error mat-icon {
      color: var(--danger);
    }
    .mk-shift-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 14px;
    }
    .mk-shift-card {
      display: flex;
      flex-direction: column;
      min-height: 238px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg-surface);
      box-shadow: var(--shadow-sm);
      transition: transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
    }
    .mk-shift-card:hover {
      transform: translateY(-2px);
      border-color: var(--border-strong);
      box-shadow: var(--shadow);
    }
    .mk-shift-card-top {
      display: grid;
      grid-template-columns: 58px minmax(0, 1fr) auto;
      align-items: start;
      gap: 12px;
    }
    .mk-shift-date {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 58px;
      border-radius: 14px;
      color: var(--primary);
      background: rgba(29,78,216,0.10);
      border: 1px solid rgba(29,78,216,0.18);
      text-align: center;
    }
    .mk-shift-date span {
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
    }
    .mk-shift-date strong {
      margin-top: 2px;
      font-size: 15px;
      font-weight: 950;
    }
    .mk-shift-title {
      min-width: 0;
    }
    .mk-shift-title h2 {
      margin: 0;
      color: var(--text);
      font-size: 16px;
      line-height: 1.25;
      font-weight: 950;
      letter-spacing: 0;
    }
    .mk-shift-title span {
      display: block;
      margin-top: 4px;
      color: var(--text-muted);
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mk-match {
      display: inline-flex; align-items: center; gap: 6px; width: fit-content;
      font-size: 11.5px; font-weight: 800; letter-spacing: 0.02em;
      padding: 4px 10px; border-radius: 100px; margin-top: 10px;
    }
    .mk-match mat-icon { font-size: 14px !important; width: 14px !important; height: 14px !important; }
    .mk-match--good { background: rgba(34,197,94,0.16); color: #4ade80; }
    .mk-match--warn { background: rgba(245,158,11,0.16); color: #fbbf24; }
    .mk-match--bad { background: rgba(239,68,68,0.16); color: #f87171; }
    .mk-match--neutral { background: rgba(148,163,184,0.16); color: var(--mk-subtle); }

    .mk-shift-meta {
      display: grid;
      gap: 8px;
      margin: 18px 0;
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 650;
    }
    .mk-shift-meta span {
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }
    .mk-shift-meta mat-icon {
      color: var(--accent);
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .mk-shift-actions {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
      margin-top: auto;
      padding-top: 14px;
      border-top: 1px solid var(--border);
    }
    .mk-shift-actions strong {
      display: block;
      color: var(--text);
      font-size: 13px;
      font-weight: 900;
    }
    .mk-shift-actions span {
      display: block;
      margin-top: 3px;
      color: var(--text-subtle);
      font-size: 12px;
    }
    .mk-claim-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      white-space: nowrap;
    }
    .mk-section-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
    }
    .mk-section-head h2 {
      margin: 0;
      color: var(--text);
      font-size: 20px;
      font-weight: 950;
    }
    .mk-section-head p {
      margin: 4px 0 0;
      color: var(--text-muted);
      font-size: 13px;
    }
    .mk-request-list {
      display: grid;
      gap: 10px;
    }
    .mk-request-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 12px;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg-surface);
      box-shadow: var(--shadow-sm);
    }
    .mk-request-main {
      min-width: 0;
    }
    .mk-request-main strong {
      display: block;
      color: var(--text);
      font-size: 14px;
      font-weight: 900;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mk-request-main span {
      display: block;
      margin-top: 4px;
      color: var(--text-muted);
      font-size: 12px;
    }
    .mk-request-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .mk-hero-shell {
      position: relative;
      display:grid;
      grid-template-columns: 0.92fr 1.35fr;
      gap: 24px;
      min-height: 560px;
      padding: 28px;
      border-radius: 28px;
      overflow: hidden;
      border: 1px solid var(--mk-border);
      background:
        linear-gradient(120deg, rgba(2, 6, 23, 0.94), rgba(8, 22, 54, 0.92) 58%, rgba(2, 8, 23, 0.94)),
        linear-gradient(90deg, rgba(34, 211, 238, 0.06), rgba(37, 99, 235, 0.08));
      box-shadow: 0 26px 90px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.08);
      isolation: isolate;
    }
    .mk-hero-shell::before {
      content:'';
      position:absolute;
      inset:auto -18% -170px 18%;
      height:360px;
      border-top:3px solid rgba(34,211,238,0.72);
      border-radius:50% 50% 0 0;
      filter: drop-shadow(0 0 26px rgba(34,211,238,0.62));
      pointer-events:none;
      z-index:-1;
    }
    .mk-hero-shell::after {
      content:'';
      position:absolute;
      inset:0;
      background-image:
        linear-gradient(rgba(34,211,238,0.08) 1px, transparent 1px),
        linear-gradient(90deg, rgba(37,99,235,0.07) 1px, transparent 1px);
      background-size: 44px 44px;
      opacity:0.22;
      mask-image: linear-gradient(90deg, transparent, #000 12%, #000 86%, transparent);
      pointer-events:none;
      z-index:-1;
    }

    .mk-brand-row {
      display:inline-flex;
      align-items:center;
      gap:10px;
      color:#fff;
      font-size:22px;
      font-weight:950;
      margin-bottom:22px;
    }
    .mk-brand-mark {
      width:34px;
      height:34px;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      border-radius:10px;
      color:#00111d;
      font-weight:1000;
      background:linear-gradient(135deg, #22d3ee, #2563eb);
      box-shadow:0 0 28px rgba(34,211,238,0.44);
      transform:skew(-10deg);
    }
    .mk-hero-copy {
      position:relative;
      z-index:1;
      display:flex;
      flex-direction:column;
      justify-content:flex-start;
      min-width:0;
    }
    .mk-hero-copy h1 {
      margin:0;
      color:#fff;
      font-size: clamp(46px, 6vw, 76px);
      line-height:0.94;
      font-weight:1000;
      letter-spacing:0;
    }
    .mk-hero-copy h1 span {
      display:block;
      color:#1685ff;
    }
    .mk-hero-copy p {
      max-width:270px;
      margin:28px 0 24px;
      color:var(--mk-muted);
      font-size:18px;
      line-height:1.42;
      font-weight:650;
    }
    .mk-feature-list {
      display:grid;
      gap:18px;
      max-width:360px;
    }
    .mk-feature-item {
      display:grid;
      grid-template-columns:48px 1fr;
      gap:14px;
      align-items:center;
    }
    .mk-feature-icon {
      width:42px;
      height:42px;
      display:flex;
      align-items:center;
      justify-content:center;
      color:var(--mk-cyan);
      border:1px solid rgba(34,211,238,0.42);
      border-radius:10px;
      background:rgba(34,211,238,0.08);
      box-shadow:0 0 20px rgba(34,211,238,0.16);
    }
    .mk-feature-icon mat-icon { font-size:24px; width:24px; height:24px; }
    .mk-feature-item strong {
      display:block;
      color:#fff;
      font-size:15px;
      font-weight:900;
      margin-bottom:3px;
    }
    .mk-feature-item span {
      display:block;
      color:var(--mk-subtle);
      font-size:12px;
      line-height:1.28;
      max-width:220px;
    }

    .mk-hero-visual {
      position:relative;
      display:flex;
      align-items:flex-end;
      min-width:0;
      padding-top:80px;
    }
    .mk-staff-strip {
      position:absolute;
      top:0;
      right:10px;
      display:flex;
      align-items:flex-end;
      gap:12px;
      height:132px;
    }
    .mk-staff-avatar {
      display:flex;
      align-items:center;
      justify-content:center;
      width:72px;
      height:104px;
      border-radius:28px 28px 18px 18px;
      border:1px solid rgba(255,255,255,0.16);
      background:linear-gradient(180deg, rgba(34,211,238,0.24), rgba(37,99,235,0.10));
      box-shadow:0 16px 34px rgba(0,0,0,0.30);
    }
    .mk-staff-avatar mat-icon { color:#dffbff; font-size:34px; width:34px; height:34px; }
    .mk-staff-avatar--two { height:120px; background:linear-gradient(180deg, rgba(14,165,233,0.28), rgba(29,78,216,0.16)); }
    .mk-staff-avatar--three { height:112px; background:linear-gradient(180deg, rgba(245,158,11,0.25), rgba(37,99,235,0.12)); }

    .mk-dashboard-grid {
      width:100%;
      display:grid;
      grid-template-columns:1.55fr 1fr;
      gap:12px;
      align-items:stretch;
    }
    .mk-panel {
      min-width:0;
      padding:14px;
      border:1px solid rgba(148,163,184,0.16);
      border-radius:14px;
      background:linear-gradient(180deg, rgba(8,18,45,0.90), rgba(3,10,26,0.90));
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.06), 0 14px 38px rgba(0,0,0,0.24);
    }
    .mk-panel--wide { grid-row:span 1; }
    .mk-panel-head {
      display:flex;
      justify-content:space-between;
      gap:12px;
      align-items:flex-start;
      margin-bottom:12px;
    }
    .mk-panel-title {
      display:flex;
      align-items:center;
      gap:8px;
      color:#fff;
      font-size:14px;
      font-weight:950;
    }
    .mk-panel-title mat-icon {
      display:inline-flex;
      align-items:center;
      justify-content:center;
      color:#dffbff;
      background:linear-gradient(135deg, #2563eb, #0891b2);
      border-radius:8px;
      padding:4px;
      font-size:18px;
      width:26px;
      height:26px;
    }
    .mk-panel-sub { margin-top:4px; color:var(--mk-subtle); font-size:11px; font-weight:700; }
    .mk-link-btn {
      border:0;
      background:transparent;
      color:#60a5fa;
      font-size:11px;
      font-weight:850;
      cursor:pointer;
    }

    .mk-shift-list,
    .mk-swap-list,
    .mk-approval-list,
    .mk-activity-list {
      display:grid;
      gap:9px;
    }
    .mk-shift-row,
    .mk-swap-row,
    .mk-approval-row,
    .mk-activity-row {
      display:flex;
      align-items:center;
      gap:10px;
      min-width:0;
      padding:10px;
      border:1px solid rgba(148,163,184,0.12);
      border-radius:10px;
      background:rgba(15,23,42,0.62);
    }
    .mk-shift-icon {
      width:36px;
      height:36px;
      display:flex;
      align-items:center;
      justify-content:center;
      flex:0 0 auto;
      color:#fff;
      border-radius:10px;
      background:linear-gradient(135deg, #7c3aed, #2563eb);
    }
    .mk-shift-icon--night { background:linear-gradient(135deg, #0f766e, #0891b2); }
    .mk-shift-icon mat-icon { font-size:20px; width:20px; height:20px; }
    .mk-shift-main,
    .mk-swap-main,
    .mk-approval-main,
    .mk-activity-row > div:not(.mk-person-dot) {
      min-width:0;
      flex:1;
    }
    .mk-shift-main strong,
    .mk-swap-main strong,
    .mk-approval-main strong,
    .mk-activity-row strong {
      display:block;
      color:#fff;
      font-size:12px;
      font-weight:900;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    .mk-shift-main span,
    .mk-swap-main span,
    .mk-approval-main small,
    .mk-activity-row span {
      display:block;
      color:var(--mk-subtle);
      font-size:10.5px;
      font-weight:650;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      margin-top:3px;
    }
    .mk-shift-side {
      display:flex;
      align-items:center;
      gap:8px;
      flex:0 0 auto;
    }
    .mk-mini-pill {
      color:#93c5fd;
      font-size:10px;
      font-weight:900;
      padding:5px 7px;
      border-radius:999px;
      background:rgba(37,99,235,0.16);
      border:1px solid rgba(96,165,250,0.22);
    }
    .mk-review-btn,
    .mk-approve-btn,
    .mk-decline-btn {
      border:0;
      border-radius:7px;
      min-height:28px;
      padding:0 12px;
      color:#fff;
      font-size:11px;
      font-weight:900;
      cursor:pointer;
    }
    .mk-review-btn { background:linear-gradient(135deg, #2563eb, #0ea5e9); }
    .mk-approve-btn { background:linear-gradient(135deg, #0fba8b, #0f766e); }
    .mk-decline-btn { background:rgba(15,23,42,0.84); border:1px solid rgba(148,163,184,0.20); color:var(--mk-muted); }
    .mk-review-btn:disabled,
    .mk-approve-btn:disabled,
    .mk-decline-btn:disabled {
      opacity:0.55;
      cursor:not-allowed;
    }
    .mk-person-dot {
      width:38px;
      height:38px;
      flex:0 0 auto;
      display:flex;
      align-items:center;
      justify-content:center;
      border-radius:50%;
      color:#fff;
      font-size:12px;
      font-weight:950;
      background:linear-gradient(135deg, #f59e0b, #2563eb);
      border:1px solid rgba(255,255,255,0.18);
    }
    .mk-person-dot--warm { background:linear-gradient(135deg, #f97316, #be123c); }
    .mk-person-dot--blue { background:linear-gradient(135deg, #22d3ee, #2563eb); }
    .mk-swap-actions {
      display:flex;
      justify-content:flex-end;
      gap:8px;
      padding-top:8px;
    }
    .mk-approval-main > span {
      display:block;
      color:#93c5fd;
      font-size:10px;
      font-weight:900;
      margin-bottom:2px;
    }
    .mk-approval-actions {
      display:grid;
      gap:6px;
      flex:0 0 auto;
    }
    .mk-activity-row small {
      color:var(--mk-subtle);
      font-size:10px;
      font-weight:800;
      flex:0 0 auto;
    }
    .mk-activity-link {
      width:100%;
      margin-top:10px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      color:#93c5fd;
      background:rgba(37,99,235,0.10);
      border:1px solid rgba(96,165,250,0.14);
      border-radius:10px;
      padding:9px 10px;
      font-size:11px;
      font-weight:900;
      cursor:pointer;
    }
    .mk-activity-link mat-icon { font-size:16px; width:16px; height:16px; }
    .mk-empty-panel {
      min-height:112px;
      display:flex;
      align-items:center;
      justify-content:center;
      flex-direction:column;
      gap:8px;
      color:var(--mk-subtle);
      text-align:center;
      font-size:12px;
      font-weight:750;
      border:1px dashed rgba(148,163,184,0.18);
      border-radius:10px;
      background:rgba(15,23,42,0.38);
    }
    .mk-empty-panel--small { min-height:96px; }
    .mk-empty-panel--error { border-color: rgba(239,68,68,0.28); color: #fecaca; }
    .mk-empty-panel mat-icon { color:#38bdf8; }

    .mk-no-org { display:flex; align-items:center; gap:10px; padding:20px; color:var(--warning); font-weight:600; border-radius:var(--radius-md); margin-top:18px; }
    .mk-empty { display:flex; align-items:center; justify-content:center; flex-direction:column; min-height:180px; margin-top:20px; padding:24px; text-align:center; border-radius:var(--radius-lg); }
    .mk-empty--error { border-color:rgba(239,68,68,0.26) !important; }
    .mk-current-banner { display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-radius:var(--radius-lg); margin:20px 0 0; border-left:4px solid var(--warning); background:var(--bg-surface); }
    .mk-current-inner { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
    .mk-current-time { font-size:13px; color:var(--text-muted); }
    .mk-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:18px; margin-top:22px; }
    .mk-card {
      display:flex;
      flex-direction:column;
      padding:20px;
      border-radius:18px;
      border: 1px solid var(--border);
      box-shadow: var(--shadow-sm);
      background: var(--bg-surface);
      transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
    }
    .mk-card:hover {
      transform:translateY(-2px);
      box-shadow: var(--shadow);
      border-color: var(--border-strong);
    }
    .mk-card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:16px; }
    .mk-card-title { font-size:16px; font-weight:900; color:var(--text); line-height:1.3; }
    .mk-card-body { display:flex; flex-direction:column; gap:10px; margin-bottom:24px; flex-grow:1; }
    .mk-info-row { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text-muted); font-weight:600; }
    .mk-info-row mat-icon { font-size:16px !important; width:16px; height:16px; color:var(--accent); }
    .mk-card-foot {
      display:flex;
      justify-content:space-between;
      align-items:flex-end;
      border-top:1px solid var(--border);
      background: var(--bg-elevated);
      margin: 0 -20px -20px;
      padding: 16px 20px;
      gap:12px;
      border-bottom-left-radius: 18px;
      border-bottom-right-radius: 18px;
    }
    .mk-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
    .mk-rate { display:flex; flex-direction:column; gap:4px; }
    .mk-rate-label { font-size:11px; color:var(--text-subtle); text-transform:uppercase; font-weight:800; letter-spacing:0.05em; }
    .mk-rate-val { font-size:15px; font-weight:900; color:var(--success); }
    .mk-btn { padding:10px 16px !important; display:inline-flex; align-items:center; gap:6px; font-size:13px !important; }
    .mk-btn mat-icon { font-size:18px !important; width:18px; height:18px; }
    .mk-page .vs-btn-ghost {
      color:var(--text-muted);
      background:var(--bg-surface);
      border:1px solid var(--border);
    }
    .mk-page .vs-btn-primary {
      background:linear-gradient(135deg, #2563eb, #0ea5e9);
      border-color:transparent;
      box-shadow:0 10px 28px rgba(37,99,235,0.22);
    }

    @media (max-width: 1180px) {
      .mk-hero-shell { grid-template-columns:1fr; }
      .mk-hero-visual { padding-top:36px; }
      .mk-staff-strip { display:none; }
    }
    @media (max-width: 820px) {
      .mk-page { margin:-16px -14px; padding:14px; }
      .mk-hero-shell { padding:18px; border-radius:22px; }
      .mk-dashboard-grid { grid-template-columns:1fr; }
      .mk-hero-copy h1 { font-size:44px; }
      .mk-hero-copy p { max-width:100%; }
      .mk-feature-list { max-width:100%; grid-template-columns:1fr 1fr; }
    }
    @media (max-width: 560px) {
      .mk-feature-list { grid-template-columns:1fr; }
      .mk-shift-row,
      .mk-approval-row {
        align-items:flex-start;
        flex-wrap:wrap;
      }
      .mk-shift-side,
      .mk-approval-actions {
        width:100%;
        justify-content:flex-end;
      }
      .mk-grid { grid-template-columns:1fr; }
      .mk-card-foot { flex-direction:column; align-items:stretch; }
      .mk-actions { justify-content:stretch; }
      .mk-actions .mk-btn { flex:1; justify-content:center; }
    }
  `]
})
export class MarketplacePage implements OnDestroy {
  orgId: string | null = null;
  uid: string | null = null;
  isAdminLike = false;
  items = signal<Shift[]>([]);
  myShifts = signal<Shift[]>([]);
  currentShift = signal<Shift | null>(null);
  swapRequests: any[] = [];
  activityItems = signal<UserNotification[]>([]);
  busyId: string | null = null;
  swapBusyId: string | null = null;
  marketLoading = signal(true);
  marketError = signal('');
  swapError = '';
  swapLoading = false;
  weekLabel = '';
  marketView: 'available' | 'requests' | 'activity' | 'approvals' = 'available';
  marketQuery = '';
  roleFilter = '';

  private weekOffset = 0;
  private unsub: (() => void) | null = null;
  private unsubCurrent: (() => void) | null = null;
  private unsubActivity: (() => void) | null = null;
  private unsubMyShifts: (() => void) | null = null;
  private ctxEffect?: EffectRef;

  constructor(
    private ctx: OrgContextService,
    private repo: ShiftsRepo,
    private cmd: ShiftsCommands,
    private notifications: NotificationsRepo,
    private router: Router,
    private route: ActivatedRoute,
    private toast: ToastService
  ) {
    this.handlePushActionRedirect();
    this.ctxEffect = effect(() => {
      const orgId = this.ctx.orgId();
      this.uid = this.ctx.uid();
      const role = (this.ctx.accessRole() || '').toLowerCase();
      this.isAdminLike = ['admin', 'manager', 'scheduler', 'hr'].includes(role);
      this.orgId = orgId;

      if (!orgId || !this.uid) {
        this.items.set([]);
        this.myShifts.set([]);
        this.swapRequests = [];
        this.activityItems.set([]);
        this.currentShift.set(null);
        this.marketLoading.set(false);
        return;
      }

      this.loadWeek();
      void this.refreshSwapRequests();

      if (this.unsubCurrent) {
        this.unsubCurrent();
        this.unsubCurrent = null;
      }
      this.unsubCurrent = this.repo.watchCurrentShift(orgId, this.uid, (s) => this.currentShift.set(s));

      if (this.unsubMyShifts) {
        this.unsubMyShifts();
        this.unsubMyShifts = null;
      }
      // Own assigned shifts (any status/date) — used only to score marketplace
      // shifts for role fit and schedule conflicts, never sent anywhere.
      this.unsubMyShifts = this.repo.watchAssignedShifts(orgId, this.uid, (items) => this.myShifts.set(items));

      if (this.unsubActivity) {
        this.unsubActivity();
        this.unsubActivity = null;
      }
      this.unsubActivity = this.notifications.watchMy(orgId, this.uid, (items) => this.activityItems.set(items), 8);
    });
  }

  private handlePushActionRedirect() {
    const params = this.route.snapshot.queryParamMap;
    const pushAction = params.get('pushAction');
    if (!pushAction) return;

    if (pushAction === 'claimed') {
      this.toast.success('Shift claimed from your notification.');
    } else if (pushAction === 'error') {
      const reason = params.get('reason') || '';
      const message = reason === 'already_used'
        ? 'That notification link was already used.'
        : reason.includes('claimed by another')
          ? reason
          : 'Unable to claim that shift from the notification — it may no longer be available.';
      this.toast.error(message);
    }

    this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  private loadWeek() {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    if (!this.orgId) {
      this.marketLoading.set(false);
      this.items.set([]);
      return;
    }

    this.marketLoading.set(true);
    this.marketError.set('');

    const base = new Date();
    base.setDate(base.getDate() + this.weekOffset * 7);
    const { start, end } = getCurrentWeekRange(base);

    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    this.weekLabel = `${fmt(start)} – ${fmt(end)}`;

    if (this.weekOffset === 0) {
      this.unsub = this.repo.watchMarketplace(
        this.orgId,
        (items) => {
          this.items.set(items);
          this.marketLoading.set(false);
        },
        100,
        () => {
          this.marketError.set('Open shifts could not be loaded. Ask an administrator to deploy the latest Firestore indexes.');
          this.marketLoading.set(false);
        }
      );
      return;
    }

    const startTs = Timestamp.fromDate(start);
    const endTs = Timestamp.fromDate(end);
    this.unsub = this.repo.watchOrgRange(this.orgId, startTs, endTs, (all) => {
      const nowMs = Date.now();
      this.items.set(all.filter((s) => {
        if (!['open', 'published'].includes(s.status)) return false;
        if (s.assignedUserId) return false;
        if (s.marketplaceVisible === false) return false;
        const endMs = typeof s.endAt?.toMillis === 'function' ? s.endAt.toMillis() : Number(s.endAt || 0);
        return !(endMs > 0 && endMs < nowMs);
      }));
      this.marketLoading.set(false);
    });
  }

  moneyCurrency() {
    return this.ctx.currencyCode() || 'USD';
  }

  prevWeek() { this.weekOffset--; this.loadWeek(); }
  nextWeek() { this.weekOffset++; this.loadWeek(); }
  thisWeek() { this.weekOffset = 0; this.loadWeek(); }

  fmtDate(ts: any) { return fmtShiftDate(ts); }
  fmtTime(ts: any) { return fmtShiftTime(ts); }
  hrs(s: Shift) { return shiftHours(s).toFixed(1); }

  canClaim(s: Shift) { return canClaimShift(s, this.uid); }

  availableHours() {
    return this.items().reduce((sum, s) => sum + shiftHours(s), 0);
  }

  userRequestCount() {
    if (this.isAdminLike) return this.swapRequests.filter((r) => String(r?.status || '') === 'pending').length;
    return this.swapRequests.filter((r) => r?.requesterUid === this.uid || r?.targetUid === this.uid).length;
  }

  roleOptions() {
    const roles = new Set<string>();
    for (const s of this.items()) {
      const role = this.shiftRole(s);
      if (role) roles.add(role);
    }
    return Array.from(roles).sort((a, b) => a.localeCompare(b));
  }

  filteredItems() {
    const q = this.marketQuery.trim().toLowerCase();
    const role = this.roleFilter.trim().toLowerCase();
    const matched = this.items()
      .filter((s) => {
        const shiftRole = this.shiftRole(s).toLowerCase();
        if (role && shiftRole !== role) return false;
        if (!q) return true;
        const haystack = [
          s.title,
          s.locationName,
          shiftRole,
          String(s.description || ''),
          String(s.notes || ''),
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      })
      .map((s) => ({ shift: s, match: this.matchFor(s) }));

    // Best-fit shifts first (role match, no schedule conflict); shifts that
    // conflict with something the staff member is already assigned to sink
    // to the bottom rather than being hidden — they can still see why.
    matched.sort((a, b) => b.match.score - a.match.score);
    return matched.map((m) => m.shift);
  }

  matchFor(s: Shift) {
    return scoreShiftMatch(s, this.myShifts(), this.ctx.jobRole());
  }

  matchBadge(s: Shift): { label: string; icon: string; cls: string } | null {
    const label: ShiftMatchLabel = this.matchFor(s).label;
    switch (label) {
      case 'great_fit': return { label: 'Great fit', icon: 'stars', cls: 'mk-match--good' };
      case 'conflict': return { label: 'Conflicts with your schedule', icon: 'event_busy', cls: 'mk-match--bad' };
      case 'tight_turnaround': return { label: 'Tight turnaround', icon: 'schedule', cls: 'mk-match--warn' };
      case 'role_mismatch': return { label: 'Different role', icon: 'info', cls: 'mk-match--neutral' };
      default: return null;
    }
  }

  shiftRole(s: Shift) {
    if (Array.isArray(s.requiredJobRoles) && s.requiredJobRoles.length) return s.requiredJobRoles.join(', ');
    return String(s.requiredJobRole || s.roleRequired || '').trim();
  }

  claimLabel(s: Shift) {
    if (!this.uid) return 'Sign in required';
    return canClaimShift(s, this.uid) ? 'Ready to claim' : 'Not available';
  }

  visibleOpenShifts() {
    return this.items().slice(0, 4);
  }

  isNightShift(s: Shift) {
    const d = this.toDate(s.startAt);
    const hour = d?.getHours() ?? 12;
    return hour < 6 || hour >= 18;
  }

  async refreshSwapRequests() {
    if (!this.orgId || !this.uid || this.swapLoading) return;
    this.swapLoading = true;
    this.swapError = '';
    try {
      const res: any = await this.cmd.listShiftSwapRequests('', 50);
      this.swapRequests = Array.isArray(res?.items) ? res.items : [];
    } catch (e: any) {
      this.swapError = 'Shift switch requests could not be loaded.';
      this.toast.errorFrom(e, 'Unable to load swap requests.');
    } finally {
      this.swapLoading = false;
    }
  }

  swapPanelItems() {
    return this.swapRequests
      .filter((r) => String(r?.status || '') === 'pending')
      .slice(0, 2);
  }

  primarySwap() {
    return this.swapPanelItems()[0] || null;
  }

  quickApprovals() {
    return this.swapRequests
      .filter((r) => String(r?.status || '') === 'pending' && this.canApproveSwap(r))
      .slice(0, 2);
  }

  teamActivityItems() {
    return this.activityItems().slice(0, 4);
  }

  canApproveSwap(r: any) {
    return String(r?.status || '') === 'pending' && (this.isAdminLike || r?.targetUid === this.uid);
  }

  canCancelSwap(r: any) {
    return String(r?.status || '') === 'pending' && r?.requesterUid === this.uid && !this.canApproveSwap(r);
  }

  async respondSwap(r: any, decision: 'accept' | 'reject' | 'cancel') {
    if (!r?.requestId || this.swapBusyId) return;
    this.swapBusyId = r.requestId;
    try {
      await this.cmd.respondShiftSwap(r.requestId, decision);
      const label = decision === 'accept' ? 'approved' : decision === 'reject' ? 'declined' : 'cancelled';
      this.toast.success(`Swap request ${label}.`);
      await this.refreshSwapRequests();
    } catch (e: any) {
      this.toast.errorFrom(e, 'Swap request update failed.');
    } finally {
      this.swapBusyId = null;
    }
  }

  swapCounterparty(r: any) {
    if (!r) return 'Staff';
    if (r.requesterUid === this.uid) return r.targetName || 'Staff';
    return r.requesterName || r.requesterUid || 'Staff';
  }

  swapKindLabel(r: any) {
    return r?.kind === 'swap' ? 'Swap Request' : 'Open Shift Filled';
  }

  initials(value: any) {
    const text = String(value || 'VS').trim();
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return text.slice(0, 2).toUpperCase();
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

  fmtActivity(ts: any) {
    const ms = this.toMillis(ts);
    if (!ms) return '';
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'now';
    if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m`;
    if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))}h`;
    return `${Math.max(1, Math.floor(diff / 86_400_000))}d`;
  }

  private toDate(ts: any): Date | null {
    if (!ts) return null;
    if (ts instanceof Date) return ts;
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private toMillis(ts: any): number {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    const n = Number(ts);
    return Number.isFinite(n) ? n : 0;
  }

  async claim(shiftId: string) {
    this.busyId = shiftId;
    try {
      await this.cmd.claimShift(shiftId);
      this.toast.success('Shift claimed! Check your schedule.');
      await this.router.navigate(['/app/shift-chat'], { queryParams: { shiftId } });
    } catch (e: any) {
      this.toast.errorFrom(e, mapAttendancePolicyError(e, 'Claim failed.'));
    } finally {
      this.busyId = null;
    }
  }

  canOpenChat(s: Shift) {
    return this.isAdminLike || (!!this.uid && s.assignedUserId === this.uid);
  }

  async openShiftChat(shiftId: string) {
    await this.router.navigate(['/app/shift-chat'], { queryParams: { shiftId } });
  }

  async goToAttendance() {
    await this.router.navigate(['/app/attendance']);
  }

  async goToNotifications() {
    await this.router.navigate(['/app/notifications']);
  }

  ngOnDestroy() {
    this.ctxEffect?.destroy();
    if (this.unsub) this.unsub();
    if (this.unsubCurrent) this.unsubCurrent();
    if (this.unsubActivity) this.unsubActivity();
    if (this.unsubMyShifts) this.unsubMyShifts();
    this.unsub = null;
    this.unsubCurrent = null;
    this.unsubActivity = null;
    this.unsubMyShifts = null;
  }
}
