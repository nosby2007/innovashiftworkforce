import { Component, EffectRef, OnDestroy, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { AttendanceCommands } from '../../core/commands/attendance.commands';
import { ShiftsCommands } from '../../core/commands/shifts.commands';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { TimeEntriesRepo } from '../../core/repos/time-entries.repo';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { TimeEntry } from '../../shared/models/time-entry.model';
import { Shift } from '../../shared/models/shift.model';
import { formatDateTime, tsToDate } from '../../shared/utils/date.util';
import { ToastService } from '../../core/ui/toast.service';
import { mapAttendancePolicyError } from '../../shared/utils/attendance-policy-error.util';
import { PlanEntitlementsService } from '../../core/tenancy/plan-entitlements.service';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import { fmtShiftDate, fmtShiftTime, shiftHours } from '../../shared/utils/shift-lifecycle.utils';
import { GeofenceMapComponent, GeofenceSite } from '../../shared/ui/geofence-map/geofence-map.component';
import { TipCardComponent } from '../../shared/ui/tip-card/tip-card.component';
import { TableListController } from '../../shared/ui/table-list/table-list.controller';
import { TablePaginatorComponent } from '../../shared/ui/table-list/table-paginator.component';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, GeofenceMapComponent, TablePaginatorComponent, TipCardComponent],
  template: `
    <div class="vs-page-pad">
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">Time & Attendance</h1>
          <p class="vs-page-subtitle">Log your shift hours and manage active time entries</p>
        </div>
      </div>

      <app-tip-card tipId="attendance-intro" title="Clocking in with GPS" icon="my_location">
        Your location is checked against the shift's site when you clock in or out — make sure location access is allowed so the map can confirm you're on-site.
      </app-tip-card>

      <div *ngIf="!orgId" class="at-no-org vs-glass">
        <mat-icon>warning_amber</mat-icon> Missing org context.
      </div>

      <div *ngIf="orgId" class="at-content">
        <section class="at-timecard">
          <div class="at-timecard-top">
            <div>
              <h2>Timecard Inquiry</h2>
              <p>Name & ID/Badge: {{ staffName() }}</p>
            </div>
            <div class="at-timecard-period">
              <label>Time Period</label>
              <select>
                <option>{{ timePeriodLabel() }}</option>
              </select>
            </div>
          </div>
          <div class="at-timecard-actions">
            <button type="button" (click)="returnToDashboard()">Return</button>
            <button type="button" (click)="toggleSelectMenu()" [class.at-action-active]="timecardMenu==='select'">
              Select <span *ngIf="selectedEntryIds.size">({{ selectedEntryIds.size }})</span>
            </button>
            <button type="button" (click)="toggleActionsMenu()" [class.at-action-active]="timecardMenu==='actions'">Actions</button>
            <button type="button" (click)="toggleViewMenu()" [class.at-action-active]="timecardMenu==='view'">View</button>
            <button type="button" (click)="emailTimecard()">Email Timecard</button>
            <button type="button" (click)="approveTimecard()" [class.at-action-active]="timecardApproved">Approve</button>
          </div>
          <div class="at-timecard-menu" *ngIf="timecardMenu">
            <ng-container *ngIf="timecardMenu === 'select'">
              <button type="button" (click)="selectAllEntries()">Select all</button>
              <button type="button" (click)="clearEntrySelection()">De-select all</button>
              <span>{{ selectedEntryIds.size }} selected</span>
            </ng-container>
            <ng-container *ngIf="timecardMenu === 'actions'">
              <button type="button" (click)="requestFixForSelected()">Request correction</button>
              <button type="button" (click)="printTimecard()">Print / Save PDF</button>
              <button type="button" (click)="showBreakdown()">Breakdown</button>
            </ng-container>
            <ng-container *ngIf="timecardMenu === 'view'">
              <button type="button" (click)="toggleRoundedTime()">{{ showRoundedTime ? 'Show actual time' : 'Show rounded time' }}</button>
              <button type="button" (click)="toggleComments()">{{ showComments ? 'Hide comments' : 'Show comments' }}</button>
              <button type="button" (click)="showEmployeeDefaults()">Employee defaults</button>
            </ng-container>
          </div>
          <div class="at-table-toolbar" *ngIf="entries().length > 0">
            <input
              class="at-table-search"
              type="search"
              placeholder="Search timecard rows…"
              [value]="timecardCtrl.filterText()"
              (input)="timecardCtrl.setFilter($any($event.target).value)"
              aria-label="Search timecard rows">
          </div>
          <div class="at-timecard-table-shell">
            <table class="at-timecard-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th class="at-th-sort" (click)="timecardCtrl.toggleSort('checkInAt')">Actual In Date <span>{{ timecardCtrl.sortIndicator('checkInAt') }}</span></th>
                  <th>Actual In Time</th>
                  <th>Actual Out Time</th>
                  <th class="at-th-sort" (click)="timecardCtrl.toggleSort('punchHours')">Punch Hours <span>{{ timecardCtrl.sortIndicator('punchHours') }}</span></th>
                  <th>Pay Code</th>
                  <th>Shift Hours</th>
                  <th class="at-th-sort" (click)="timecardCtrl.toggleSort('scheduledHours')">Scheduled Hours <span>{{ timecardCtrl.sortIndicator('scheduledHours') }}</span></th>
                  <th>Approval Level</th>
                  <th>Shift Code</th>
                  <th>Labor Levels</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngIf="timecardCtrl.pageRows().length===0">
                  <td colspan="12">No timecard rows for this period.</td>
                </tr>
                <tr *ngFor="let e of timecardCtrl.pageRows(); let i = index; trackBy: trackByEntry" [class.at-row-selected]="isEntrySelected(e.id)">
                  <td>
                    <input type="checkbox" [checked]="isEntrySelected(e.id)" (change)="toggleEntrySelection(e.id, $any($event.target).checked)" aria-label="Select timecard row">
                  </td>
                  <td>{{ fmtShortDate(e.checkInAt) }}</td>
                  <td>{{ fmtDisplayTime(e.checkInAt) }}</td>
                  <td>{{ fmtDisplayTime(e.checkOutAt) }}</td>
                  <td>{{ workedHours(e).toFixed(2) }}</td>
                  <td>EDU</td>
                  <td>{{ workedHours(e).toFixed(2) }}</td>
                  <td>{{ scheduledHours(e).toFixed(2) }}</td>
                  <td>{{ e.exceptionStatus === 'approved' ? 6 : 0 }}</td>
                  <td>A</td>
                  <td>{{ laborLevel(e) }}</td>
                  <td>{{ entryAnomalies(e).length ? 'AC' : 'C' }}</td>
                </tr>
                <tr *ngIf="showComments && entries().length > 0">
                  <td colspan="12" class="at-comments-row">
                    Comments visible: AC means anomaly/correction recommended. Open entries can be corrected after clock out.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <app-table-paginator *ngIf="entries().length > 0" [controller]="timecardCtrl"></app-table-paginator>
          <div class="at-timecard-footer">
            <strong>Pay Code Hours Breakdown</strong>
            <span>EDU {{ totalHours().toFixed(2) }}</span>
            <span>Total Non-Premium Hours: {{ totalHours().toFixed(2) }}</span>
          </div>
        </section>

        <section class="vs-glass-strong at-panel at-current" *ngIf="currentShift() as cs">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Current Shift - In Progress</div>
              <div class="vs-panel-subtitle">{{ cs.title }} &bull; {{ cs.locationName }}</div>
            </div>
            <span class="vs-badge vs-badge--warning">In Progress</span>
          </div>
          <div class="at-current-row">
            <div class="at-current-info">
              <mat-icon>calendar_today</mat-icon>
              <span>{{ fmtDate(cs.startAt) }}</span>
              <mat-icon>schedule</mat-icon>
              <span>{{ fmtTime(cs.startAt) }} &ndash; {{ fmtTime(cs.endAt) }}</span>
              <mat-icon>access_time</mat-icon>
              <span>{{ hrs(cs) }} hrs</span>
            </div>
            <div class="at-current-status" *ngIf="entryId()">
              <span class="vs-dot vs-dot--green"></span>
              <strong>Active Entry:</strong>
              <span class="at-mono">{{ entryId() }}</span>
              <span *ngIf="onBreak()" class="vs-badge vs-badge--warning">On Break</span>
            </div>
          </div>
          <app-geofence-map *ngIf="punchMethod === 'gps' && canUseGps()" [site]="activeSiteForMap()"></app-geofence-map>

          <div class="at-actions at-actions-current">
            <button class="vs-btn-ghost at-btn-break" (click)="breakOut()" [disabled]="busy || !entryId() || onBreak()">
              <mat-icon>pause_circle</mat-icon> Break Out
            </button>
            <button class="vs-btn-ghost at-btn-break" (click)="breakIn()" [disabled]="busy || !entryId() || !onBreak()">
              <mat-icon>play_circle</mat-icon> Break In
            </button>
            <button class="vs-btn-primary at-btn-out" (click)="checkOut()" [disabled]="busy || !entryId()">
              <mat-icon>logout</mat-icon> Clock Out
            </button>
          </div>
        </section>

        <section class="vs-glass-strong at-panel" *ngIf="todaysSchedule().length > 0 && !currentShift()">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">My Upcoming Shifts</div>
              <div class="vs-panel-subtitle">Today's shift — clock in when you're ready</div>
            </div>
            <mat-icon style="color:var(--primary);">event</mat-icon>
          </div>
          <div class="at-schedule-cards">
            <div *ngFor="let s of todaysSchedule()" class="at-schedule-card vs-glass">
              <div class="at-schedule-card-head">
                <strong>{{ s.title }}</strong>
                <span class="at-schedule-card-date">{{ fmtDate(s.startAt) }}</span>
              </div>
              <div class="at-schedule-card-time">{{ fmtTime(s.startAt) }} &ndash; {{ fmtTime(s.endAt) }}</div>
              <div class="at-loc"><mat-icon>location_on</mat-icon>{{ s.locationName }}</div>
              <div class="at-schedule-card-actions">
                <button class="vs-btn-primary at-btn-in" (click)="clockInToShift(s)" [disabled]="busy">
                  <mat-icon>login</mat-icon> Clock In
                </button>
                <button class="vs-btn-ghost at-btn-callout" (click)="openCallOut(s)" [disabled]="busy">
                  <mat-icon>event_busy</mat-icon> Call Out
                </button>
              </div>
            </div>
          </div>

          <div class="at-callout-form vs-glass" *ngIf="callOutTargetShift">
            <div class="at-callout-form-title">
              <mat-icon>event_busy</mat-icon>
              Call Out — <span>{{ callOutTargetShift.title }}</span>
            </div>
            <p class="at-callout-help">This immediately removes you from the shift, puts it back on the marketplace, and notifies your admin.</p>
            <label class="vs-field-label">Reason (optional)</label>
            <input class="vs-input" [(ngModel)]="callOutReason" placeholder="Feeling sick, family emergency…" aria-label="Call-out reason">
            <div class="at-callout-form-actions">
              <button class="vs-btn-ghost" (click)="cancelCallOut()" [disabled]="callOutBusy">Cancel</button>
              <button class="vs-btn-primary" (click)="submitCallOut()" [disabled]="callOutBusy">
                {{ callOutBusy ? 'Calling out…' : 'Confirm Call Out' }}
              </button>
            </div>
          </div>
        </section>

        <section class="vs-glass-strong at-panel" *ngIf="!currentShift()">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Manual Punch</div>
              <div class="vs-panel-subtitle">Select one of your shifts to clock in</div>
            </div>
            <mat-icon style="color:var(--primary);">timer</mat-icon>
          </div>

          <div class="at-form">
            <div class="at-mode-card" *ngIf="gpsRequired() || canUseGps()">
              <div>
                <div class="vs-field-label">Attendance Verification</div>
                <div class="vs-muted" *ngIf="gpsRequired()">This organization requires GPS-verified attendance.</div>
                <div class="vs-muted" *ngIf="!gpsRequired()">Use GPS for on-site punches or manual for standard workflows.</div>
              </div>
              <div class="at-mode-toggle">
                <button class="vs-btn-ghost" [class.at-mode-active]="punchMethod==='manual'" (click)="setPunchMethod('manual')" [disabled]="busy || gpsRequired()">Manual</button>
                <button class="vs-btn-ghost" [class.at-mode-active]="punchMethod==='gps'" (click)="setPunchMethod('gps')" [disabled]="busy || !canUseGps()">GPS Verified</button>
              </div>
            </div>

            <app-geofence-map *ngIf="punchMethod === 'gps' && canUseGps()" [site]="activeSiteForMap()"></app-geofence-map>

            <div class="at-upgrade-card" *ngIf="!canUseGps() && !gpsRequired()">
              <mat-icon>workspace_premium</mat-icon>
              <div>
                <strong>Upgrade to Pro</strong>
                <div>GPS attendance and geofence validation are available on Pro and Enterprise plans.</div>
              </div>
            </div>

            <div class="vs-form-row">
              <div>
                <label class="vs-field-label">Shift *</label>
                <input
                  class="vs-input at-input"
                  [(ngModel)]="shiftSelection"
                  (ngModelChange)="onShiftSelectionChange($event)"
                  list="attendance-shift-options"
                  placeholder="Type date, title or location"
                  [disabled]="!!entryId()">
                <datalist id="attendance-shift-options">
                  <option *ngFor="let s of mySchedule()" [value]="toShiftOptionLabel(s)"></option>
                </datalist>
              </div>
            </div>

            <div class="at-actions">
              <button class="vs-btn-primary at-btn-in" (click)="checkIn()" [disabled]="busy || !shiftId || !!entryId()">
                <mat-icon>login</mat-icon> Clock In
              </button>
            </div>
          </div>
        </section>

        <div class="vs-grid-3 at-kpis" *ngIf="entries().length > 0">
          <div class="vs-stat-card vs-stat--primary">
            <div class="vs-stat-label">Hours Logged</div>
            <div class="vs-stat-value">{{ totalHours().toFixed(2) }}</div>
          </div>
          <div class="vs-stat-card vs-stat--success">
            <div class="vs-stat-label">Estimated Earnings</div>
            <div class="vs-stat-value">{{ totalEarnings() | currency:moneyCurrency():'symbol':'1.2-2' }}</div>
          </div>
          <div class="vs-stat-card vs-stat--warning">
            <div class="vs-stat-label">Pending Fixes</div>
            <div class="vs-stat-value">{{ pendingFixCount() }}</div>
          </div>
          <div class="vs-stat-card vs-stat--danger">
            <div class="vs-stat-label">Anomalies</div>
            <div class="vs-stat-value">{{ anomalyCount() }}</div>
          </div>
        </div>

        <section class="vs-glass-strong at-panel">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Recent Punches</div>
              <div class="vs-panel-subtitle">Your time entries for this week</div>
            </div>
          </div>
          <div class="at-table-toolbar" *ngIf="entries().length > 0">
            <input
              class="at-table-search"
              type="search"
              placeholder="Search recent punches…"
              [value]="punchesCtrl.filterText()"
              (input)="punchesCtrl.setFilter($any($event.target).value)"
              aria-label="Search recent punches">
          </div>
          <div class="vs-table-shell at-table-shell">
            <table class="vs-table at-table">
              <caption class="sr-only">Recent punches with calculated hours, estimated pay, status and anomaly warnings.</caption>
              <thead>
                <tr>
                  <th class="at-th-sort" (click)="punchesCtrl.toggleSort('shift')">Shift <span>{{ punchesCtrl.sortIndicator('shift') }}</span></th>
                  <th class="at-th-sort" (click)="punchesCtrl.toggleSort('checkInAt')">Clock In <span>{{ punchesCtrl.sortIndicator('checkInAt') }}</span></th>
                  <th class="at-th-sort" (click)="punchesCtrl.toggleSort('checkOutAt')">Clock Out <span>{{ punchesCtrl.sortIndicator('checkOutAt') }}</span></th>
                  <th class="at-th-sort" (click)="punchesCtrl.toggleSort('hours')">Hours <span>{{ punchesCtrl.sortIndicator('hours') }}</span></th>
                  <th class="at-th-sort" (click)="punchesCtrl.toggleSort('pay')">Est. Pay <span>{{ punchesCtrl.sortIndicator('pay') }}</span></th>
                  <th class="at-th-sort" (click)="punchesCtrl.toggleSort('status')">Status <span>{{ punchesCtrl.sortIndicator('status') }}</span></th>
                  <th>Anomalies</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr class="vs-empty" *ngIf="punchesCtrl.pageRows().length===0">
                  <td colspan="8">No recent time entries.</td>
                </tr>
                <tr *ngFor="let e of punchesCtrl.pageRows(); let i = index; trackBy: trackByEntry" class="vs-row"
                    [class.at-row--pending]="e.exceptionStatus==='pending'"
                    [class.at-row--approved]="e.exceptionStatus==='approved'"
                    [class.at-row--rejected]="e.exceptionStatus==='rejected'">
                  <td><strong>{{ shiftLabel(e.shiftId) }}</strong></td>
                  <td>{{ fmt(e.checkInAt) }}</td>
                  <td>{{ fmt(e.checkOutAt) }}</td>
                  <td>{{ workedHours(e).toFixed(2) }}</td>
                  <td>{{ estimatedPay(e) | currency:moneyCurrency():'symbol':'1.2-2' }}</td>
                  <td>
                    <span class="vs-badge"
                          [class.vs-badge--success]="e.exceptionStatus==='none'"
                          [class.vs-badge--warning]="e.exceptionStatus==='pending'"
                          [class.vs-badge--neutral]="e.exceptionStatus==='approved'"
                          [class.vs-badge--danger]="e.exceptionStatus==='rejected'">
                      {{ e.exceptionStatus | titlecase }}
                    </span>
                  </td>
                  <td>
                    <div class="at-anom-list" *ngIf="entryAnomalies(e).length > 0; else noAnomaly">
                      <span class="at-anom-chip" *ngFor="let a of entryAnomalies(e)">{{ a }}</span>
                    </div>
                    <ng-template #noAnomaly>—</ng-template>
                  </td>
                  <td class="at-actions-cell">
                    <button class="vs-btn-ghost at-fix-btn"
                            (click)="openFixRequest(e)"
                            [disabled]="busy || e.exceptionStatus==='pending'"
                            *ngIf="e.exceptionStatus !== 'pending'">
                      <mat-icon>edit_note</mat-icon> Request Fix
                    </button>
                    <span class="at-pending-chip" *ngIf="e.exceptionStatus==='pending'">
                      <mat-icon>hourglass_top</mat-icon> Pending Review
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <app-table-paginator *ngIf="entries().length > 0" [controller]="punchesCtrl"></app-table-paginator>
        </section>

        <!-- ── My Corrections ── -->
        <section class="vs-glass-strong at-panel" *ngIf="corrections.length > 0 || fixRequestEntry">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">My Correction Requests</div>
              <div class="vs-panel-subtitle">Track your submitted requests and their status</div>
            </div>
            <mat-icon style="color:var(--warning);">pending_actions</mat-icon>
          </div>

          <!-- Inline request form -->
          <div class="at-fix-form" *ngIf="fixRequestEntry">
            <div class="at-fix-form-title">
              <mat-icon>edit_calendar</mat-icon>
              Request Correction — <span>{{ shiftLabel(fixRequestEntry.shiftId) }}</span>
            </div>
            <div class="at-fix-form-body">
              <div class="vs-form-row at-fix-form-row">
                <div>
                  <label class="vs-field-label">Correction Type *</label>
                  <select class="vs-input" [(ngModel)]="fixCategory" (ngModelChange)="onFixCategoryChange()" aria-label="Correction type">
                    <option value="missed_punch">Missed punch</option>
                    <option value="wrong_hours">Wrong working hours</option>
                    <option value="missed_break">Missed or wrong break</option>
                    <option value="site_mismatch">Wrong site/location</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div class="vs-form-row at-fix-form-row">
                <div>
                  <label class="vs-field-label">Reason *</label>
                  <input class="vs-input" [(ngModel)]="fixReason" placeholder="Missed punch, wrong times, missed lunch break…" aria-label="Correction reason">
                  <div class="at-guidance" *ngIf="fixHint()">{{ fixHint() }}</div>
                </div>
              </div>
              <div class="vs-form-row at-fix-form-row">
                <div>
                  <label class="vs-field-label">Proposed Check-In (optional)</label>
                  <input type="datetime-local" class="vs-input" [(ngModel)]="fixProposedIn" aria-label="Proposed check-in">
                </div>
                <div>
                  <label class="vs-field-label">Proposed Check-Out (optional)</label>
                  <input type="datetime-local" class="vs-input" [(ngModel)]="fixProposedOut" aria-label="Proposed check-out">
                </div>
              </div>
              <div class="at-fix-form-actions">
                <button class="vs-btn-ghost" (click)="cancelFixRequest()" [disabled]="busy">Cancel</button>
                <button class="vs-btn-primary" (click)="submitFixRequest()" [disabled]="busy || !isFixRequestValid()" aria-label="Submit correction request">
                  <mat-icon>send</mat-icon> {{ busy ? 'Sending…' : 'Submit Request' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Corrections table -->
          <div class="vs-table-shell at-table-shell" *ngIf="corrections.length > 0">
            <table class="vs-table at-table">
              <caption class="sr-only">My correction requests with original and proposed times, status and decision metadata.</caption>
              <thead>
                <tr>
                  <th>Shift</th>
                  <th>Original In</th>
                  <th>Original Out</th>
                  <th>Proposed In</th>
                  <th>Proposed Out</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Decision By</th>
                  <th>Decided At</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let e of corrections" class="vs-row"
                    [class.at-row--pending]="e.exceptionStatus==='pending'"
                    [class.at-row--approved]="e.exceptionStatus==='approved'"
                    [class.at-row--rejected]="e.exceptionStatus==='rejected'">
                  <td><strong>{{ shiftLabel(e.shiftId) }}</strong></td>
                  <td>{{ fmt(e.checkInAt) }}</td>
                  <td>{{ fmt(e.checkOutAt) }}</td>
                  <td>{{ fmt(e.requestedCheckInAt) }}</td>
                  <td>{{ fmt(e.requestedCheckOutAt) }}</td>
                  <td class="at-reason">{{ e.correctionReason || '—' }}</td>
                  <td>
                    <span class="vs-badge"
                          [class.vs-badge--warning]="e.exceptionStatus==='pending'"
                          [class.vs-badge--success]="e.exceptionStatus==='approved'"
                          [class.vs-badge--danger]="e.exceptionStatus==='rejected'">
                      {{ e.exceptionStatus | titlecase }}
                    </span>
                  </td>
                  <td>{{ decisionActor(e) }}</td>
                  <td>{{ fmt(e.correctionLastDecision?.decidedAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </div>
  `,
  styles: [`
    .at-no-org { display:flex; align-items:center; gap:10px; padding:20px; color:var(--warning); font-weight:600; border-radius:var(--radius-md); }
    .at-content { width: 100%; }
    .at-timecard {
      margin-bottom: 24px;
      border: 1px solid #b7c3bb;
      border-radius: 8px;
      background: #f6f8f5;
      color: #1f2937;
      overflow: hidden;
      box-shadow: 0 10px 24px rgba(15,23,42,0.06);
    }
    .at-timecard-top {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: end;
      padding: 12px 16px;
      background: #eef3ef;
      border-bottom: 1px solid #b7c3bb;
    }
    .at-timecard-top h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 800;
    }
    .at-timecard-top p {
      margin: 4px 0 0;
      font-size: 12px;
      color: #475569;
    }
    .at-timecard-period {
      display: grid;
      gap: 4px;
      min-width: 220px;
      font-size: 11px;
      color: #475569;
      font-weight: 800;
    }
    .at-timecard-period select {
      height: 30px;
      border: 1px solid #9ca3af;
      background: #fff;
      color: #111827;
    }
    .at-timecard-actions {
      display: flex;
      gap: 4px;
      padding: 8px 10px;
      border-bottom: 1px solid #b7c3bb;
      background: #dfe9e1;
      flex-wrap: wrap;
    }
    .at-timecard-actions button {
      border: 1px solid #94a3b8;
      background: #f8fafc;
      color: #1f2937;
      font-size: 11px;
      padding: 4px 9px;
      border-radius: 3px;
    }
    .at-timecard-actions button:hover,
    .at-timecard-actions .at-action-active {
      border-color: #0f766e;
      background: #ecfdf5;
      color: #064e3b;
    }
    .at-timecard-menu {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 8px 10px;
      border-bottom: 1px solid #b7c3bb;
      background: #f8fafc;
      color: #334155;
      font-size: 12px;
    }
    .at-timecard-menu button {
      border: 1px solid #94a3b8;
      background: #fff;
      color: #1f2937;
      font-weight: 700;
      padding: 5px 10px;
      border-radius: 4px;
    }
    .at-timecard-table-shell {
      overflow: auto;
      background: #fff;
    }
    .at-timecard-table {
      width: 100%;
      min-width: 1180px;
      border-collapse: collapse;
      font-size: 11px;
    }
    .at-timecard-table th {
      background: #c6d6cc;
      color: #1f2937;
      border: 1px solid #a8b7ae;
      padding: 5px 6px;
      font-weight: 800;
      text-align: left;
      white-space: nowrap;
    }
    .at-timecard-table td {
      border: 1px solid #d1d5db;
      padding: 5px 6px;
      white-space: nowrap;
      color: #111827;
    }
    .at-timecard-table tbody tr:nth-child(even) td {
      background: #eef3ef;
    }
    .at-timecard-table .at-row-selected td {
      background: #dbeafe !important;
    }
    .at-timecard-table input[type="checkbox"] {
      width: 16px;
      height: 16px;
    }
    .at-comments-row {
      color: #475569 !important;
      font-style: italic;
      background: #f8fafc !important;
    }
    .at-timecard-footer {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 18px;
      padding: 9px 14px;
      background: #eef3ef;
      border-top: 1px solid #b7c3bb;
      color: #334155;
      font-size: 12px;
    }
    .at-panel {
      width: 100%;
      max-width: none;
      margin-bottom:24px;
      border: 1px solid var(--border);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
    }
    .at-kpis { margin-bottom: 16px; }

    .at-current { border-left: 4px solid var(--warning); }
    .at-current-row { padding: 0 20px 8px; display:flex; flex-direction:column; gap:10px; }
    .at-current-info { display:flex; align-items:center; gap:10px; font-size:13px; color:var(--text-muted); flex-wrap:wrap; }
    .at-current-info mat-icon { font-size:16px !important; width:16px; height:16px; color:var(--primary); }
    .at-current-status { display:flex; align-items:center; gap:8px; padding:10px 16px; background:rgba(34,197,94,0.12); border:1px solid rgba(34,197,94,0.26); border-radius:var(--radius-md); font-size:13px; color:var(--success); }
    .at-actions-current { padding: 0 20px 20px; border-top: none; }

    .at-schedule-cards { padding:8px 20px 20px; display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:14px; }
    .at-schedule-card { display:flex; flex-direction:column; gap:8px; padding:16px; border-radius:var(--radius-md); }
    .at-schedule-card-head { display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
    .at-schedule-card-head strong { font-size:15px; color:var(--text); }
    .at-schedule-card-date { font-size:12px; color:var(--text-subtle); white-space:nowrap; }
    .at-schedule-card-time { font-size:13px; font-weight:700; color:var(--text-muted); }
    .at-loc { display:flex; align-items:center; gap:4px; font-size:13px; color:var(--text-muted); }
    .at-loc mat-icon { font-size:14px !important; width:14px; height:14px; }
    .at-schedule-card-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:6px; }
    .at-btn-callout { color:var(--danger); border-color:rgba(239,68,68,0.4) !important; }
    .at-callout-form { margin:12px 20px 4px; padding:16px; border:1px solid rgba(239,68,68,0.35); border-radius:var(--radius-md); background:rgba(239,68,68,0.06); }
    .at-callout-form-title { display:flex; align-items:center; gap:8px; font-weight:700; color:var(--text-muted); font-size:13px; margin-bottom:8px; }
    .at-callout-form-title mat-icon { font-size:16px !important; width:16px; height:16px; color:var(--danger); }
    .at-callout-form-title span { color:var(--text); }
    .at-callout-help { font-size:12px; color:var(--text-subtle); margin:0 0 12px; }
    .at-callout-form-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:12px; }

    .at-form { padding:20px; }
    .at-input { font-family:monospace; font-size:16px; letter-spacing:0.05em; }
    .at-actions { display:flex; gap:16px; margin-top:20px; border-top:1px solid var(--border); padding-top:20px; }
    .at-mode-card { display:flex; justify-content:space-between; gap:16px; align-items:center; margin-bottom:16px; padding:14px 16px; border:1px solid var(--border); border-radius:var(--radius-md); background:var(--bg-surface); }
    .at-mode-toggle { display:flex; gap:8px; flex-wrap:wrap; }
    .at-mode-active { border-color: rgba(34,197,94,0.45) !important; background: rgba(34,197,94,0.12) !important; color: #86efac !important; }
    .at-upgrade-card { display:flex; gap:12px; align-items:flex-start; padding:14px 16px; margin-bottom:16px; border:1px dashed rgba(217,119,6,0.36); border-radius:var(--radius-md); background:rgba(217,119,6,0.10); color:var(--warning); }

    .at-btn-in, .at-btn-out { display:flex; align-items:center; gap:8px; padding:12px 24px !important; font-size:15px !important; font-weight:700 !important; letter-spacing:0.02em; }
    .at-btn-break { display:flex; align-items:center; gap:8px; padding:12px 16px !important; font-size:14px !important; }
    .at-btn-in { background: var(--success); color:#000; }
    .at-btn-in:hover { background: #4ade80; filter:brightness(1.1); box-shadow: 0 0 15px rgba(34,197,94,0.4); }
    .at-btn-out { background: var(--danger); color:#fff; }
    .at-btn-out:hover { background: #ef4444; filter:brightness(1.1); box-shadow: 0 0 15px rgba(239,68,68,0.4); }
    .at-btn-in[disabled], .at-btn-out[disabled] { opacity:0.5; filter:grayscale(1); box-shadow:none !important; cursor:not-allowed; }
    .at-fix-btn { padding: 6px 10px !important; font-size: 12px !important; }
    .at-mono { font-family:monospace; font-size:12px; color:var(--text-subtle); }

    .at-table-shell {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--bg-surface);
      overflow: auto;
    }

    .at-table-toolbar { padding: 0 0 10px; }
    .at-table-search {
      width: 100%; max-width: 320px; height: 36px; padding: 0 12px;
      border: 1px solid var(--border); border-radius: var(--radius-sm, 6px);
      background: var(--panel, #fff); color: var(--text, #0f172a); font-size: 13px;
    }
    .at-th-sort { cursor: pointer; user-select: none; white-space: nowrap; }
    .at-th-sort:hover { color: var(--primary, #07533f); }
    .at-th-sort span { display: inline-block; width: 10px; font-size: 10px; }

    .at-table {
      width: 100%;
      min-width: 980px;
      table-layout: auto;
    }

    .at-table th {
      background: var(--bg-elevated);
      color: var(--text-subtle);
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 800;
      white-space: nowrap;
    }

    .at-table tbody tr:nth-child(even):not(.vs-empty) td {
      background: rgba(148,163,184,0.08);
    }

    .at-table td {
      vertical-align: middle;
      white-space: nowrap;
    }

    .at-table td:first-child {
      white-space: normal;
      min-width: 220px;
    }

    .at-actions-cell {
      text-align: right;
    }

    .at-pending-chip { display:inline-flex; align-items:center; gap:4px; font-size:12px; color:#fde68a; padding:4px 8px; border:1px solid rgba(250,204,21,0.35); border-radius:var(--radius-sm); }
    .at-pending-chip mat-icon { font-size:14px !important; width:14px; height:14px; }
    .at-row--pending td { background: rgba(250,204,21,0.05) !important; }
    .at-row--approved td { background: rgba(34,197,94,0.05) !important; }
    .at-row--rejected td { background: rgba(239,68,68,0.05) !important; }
    .at-reason { font-size:12px; color:var(--text-muted); max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

    .at-fix-form { margin:16px 20px; padding:16px; border:1px solid rgba(96,165,250,0.35); border-radius:var(--radius-md); background:rgba(96,165,250,0.07); }
    .at-fix-form-title { display:flex; align-items:center; gap:8px; font-weight:700; color:var(--text-muted); font-size:13px; margin-bottom:14px; }
    .at-fix-form-title mat-icon { font-size:16px !important; width:16px; height:16px; color:#60a5fa; }
    .at-fix-form-title span { color:var(--text); }
    .at-fix-form-row { display:grid; grid-template-columns: 1fr 1fr; gap:14px; }
    @media (max-width: 600px) { .at-fix-form-row { grid-template-columns: 1fr; } }
    .at-fix-form-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:10px; }
    .at-guidance { margin-top:6px; font-size:12px; color:var(--text-subtle); }
    .at-anom-list { display:flex; flex-wrap:wrap; gap:6px; }
    .at-anom-chip { font-size:10px; color:#fef3c7; border:1px solid rgba(245,158,11,0.5); background:rgba(245,158,11,0.16); border-radius:999px; padding:2px 7px; font-weight:700; }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0, 0, 0, 0); white-space:nowrap; border:0; }
  `]
})
export class AttendancePage implements OnDestroy {
  orgId: string | null = null;
  uid: string | null = null;

  shiftId = '';
  shiftSelection = '';
  entryId = signal<string | null>(null);
  onBreak = signal(false);
  busy = false;
  punchMethod: 'manual' | 'gps' = 'manual';
  orgSettings: { gpsAttendanceEnabled?: boolean; sites?: any[] } | null = null;
  timecardMenu: 'select' | 'actions' | 'view' | null = null;
  selectedEntryIds = new Set<string>();
  showRoundedTime = false;
  showComments = false;
  timecardApproved = false;

  entries = signal<TimeEntry[]>([]);

  timecardCtrl = new TableListController<TimeEntry>(this.entries, {
    pageSize: 10,
    filterPredicate: (e, q) => this.timecardSearchText(e).includes(q),
    sortAccessor: (e, key) => {
      if (key === 'checkInAt') return tsToDate(e.checkInAt)?.getTime() ?? 0;
      if (key === 'punchHours') return this.workedHours(e);
      if (key === 'scheduledHours') return this.scheduledHours(e);
      return null;
    },
  });

  punchesCtrl = new TableListController<TimeEntry>(this.entries, {
    pageSize: 10,
    filterPredicate: (e, q) => this.timecardSearchText(e).includes(q),
    sortAccessor: (e, key) => {
      if (key === 'shift') return this.shiftLabel(e.shiftId).toLowerCase();
      if (key === 'checkInAt') return tsToDate(e.checkInAt)?.getTime() ?? 0;
      if (key === 'checkOutAt') return tsToDate(e.checkOutAt)?.getTime() ?? 0;
      if (key === 'hours') return this.workedHours(e);
      if (key === 'pay') return this.estimatedPay(e);
      if (key === 'status') return e.exceptionStatus ?? '';
      return null;
    },
  });

  private timecardSearchText(e: TimeEntry): string {
    return `${this.shiftLabel(e.shiftId)} ${e.exceptionStatus ?? ''} ${this.laborLevel(e)}`.toLowerCase();
  }

  shiftMap = signal<Record<string, Shift>>({});
  currentShift = signal<Shift | null>(null);
  mySchedule = signal<Shift[]>([]);
  todaysSchedule = computed(() => {
    const today = new Date();
    return this.mySchedule().filter((s) => {
      const d = tsToDate(s.startAt);
      return d ? this.isSameDay(d, today) : false;
    });
  });
  private shiftOptionToId: Record<string, string> = {};
  private shiftIdToOption: Record<string, string> = {};

  // Correction request form
  fixRequestEntry: TimeEntry | null = null;
  fixCategory: 'missed_punch' | 'wrong_hours' | 'missed_break' | 'site_mismatch' | 'other' = 'missed_punch';
  fixReason = '';
  fixProposedIn = '';
  fixProposedOut = '';

  // Call-out confirm form
  callOutTargetShift: Shift | null = null;
  callOutReason = '';
  callOutBusy = false;

  get corrections(): TimeEntry[] {
    return this.entries().filter((e) => e.exceptionStatus && e.exceptionStatus !== 'none');
  }

  moneyCurrency() {
    return this.ctx.currencyCode() || 'USD';
  }

  private unsub: (() => void) | null = null;
  private unsubCurrentShift: (() => void) | null = null;
  private unsubSchedule: (() => void) | null = null;
  private ctxEffect!: EffectRef;

  constructor(
    private ctx: OrgContextService,
    private cmd: AttendanceCommands,
    private repo: TimeEntriesRepo,
    private shiftsRepo: ShiftsRepo,
    private shiftsCmd: ShiftsCommands,
    private toast: ToastService,
    private entitlements: PlanEntitlementsService,
    private router: Router
  ) {
    this.ctxEffect = effect(() => {
      const orgId = this.ctx.orgId();
      const uid = this.ctx.uid();
      this.orgId = orgId;
      this.uid = uid;
      if (!orgId || !uid) return;
      if (this.unsub) return;

      void this.loadOrgSettings(orgId);

      this.unsub = this.repo.watchMyEntries(orgId, uid, async (items) => {
        this.entries.set(items);
        const shiftIds = Array.from(new Set(items.map((x) => x.shiftId))).filter(Boolean);
        this.shiftMap.set(shiftIds.length ? await this.shiftsRepo.getManyByIds(orgId, shiftIds) : {});
        const active = items.find((x) => !x.checkOutAt) || null;
        this.entryId.set(active?.id ?? null);
        this.onBreak.set(Boolean(active?.onBreak));
        if (active?.shiftId && !this.shiftId) {
          this.shiftId = String(active.shiftId);
          this.shiftSelection = this.shiftIdToOption[this.shiftId] || this.shiftSelection;
        }
      });

      this.unsubCurrentShift = this.shiftsRepo.watchCurrentShift(orgId, uid, (s) => {
        this.currentShift.set(s);
        if (s) {
          this.shiftId = s.id;
          const option = this.toShiftOptionLabel(s);
          this.shiftSelection = option;
          this.shiftOptionToId[option] = s.id;
          this.shiftIdToOption[s.id] = option;
        }
      });

      this.unsubSchedule = this.shiftsRepo.watchMySchedule(orgId, uid, (items) => {
        this.mySchedule.set(items);
        this.rebuildShiftOptions();
      });
    });
  }

  ngOnDestroy(): void {
    this.unsub?.();
    this.unsubCurrentShift?.();
    this.unsubSchedule?.();
    this.ctxEffect.destroy();
  }

  fmtDate(ts: any) {
    return fmtShiftDate(ts);
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  fmtTime(ts: any) {
    return fmtShiftTime(ts);
  }

  hrs(s: Shift) {
    return shiftHours(s).toFixed(1);
  }

  fmt(ts: any) {
    return ts ? formatDateTime(ts) : '—';
  }

  staffName(): string {
    return String(this.ctx.displayName() || this.ctx.email() || this.uid || 'Employee');
  }

  fmtShortDate(ts: any): string {
    const d = tsToDate(ts);
    return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'numeric', day: 'numeric', year: '2-digit' }) : '—';
  }

  fmtShortTime(ts: any): string {
    const d = tsToDate(ts);
    return d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false }) : '—';
  }

  timePeriodLabel(): string {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - 13);
    return `${start.toLocaleDateString()} - ${now.toLocaleDateString()}`;
  }

  toggleSelectMenu() {
    this.timecardMenu = this.timecardMenu === 'select' ? null : 'select';
  }

  toggleActionsMenu() {
    this.timecardMenu = this.timecardMenu === 'actions' ? null : 'actions';
  }

  toggleViewMenu() {
    this.timecardMenu = this.timecardMenu === 'view' ? null : 'view';
  }

  async returnToDashboard() {
    await this.router.navigateByUrl('/app/dashboard');
  }

  isEntrySelected(entryId: string): boolean {
    return this.selectedEntryIds.has(entryId);
  }

  toggleEntrySelection(entryId: string, checked: boolean) {
    const next = new Set(this.selectedEntryIds);
    if (checked) next.add(entryId);
    else next.delete(entryId);
    this.selectedEntryIds = next;
  }

  selectAllEntries() {
    this.selectedEntryIds = new Set(this.entries().map((e) => e.id));
  }

  clearEntrySelection() {
    this.selectedEntryIds = new Set<string>();
  }

  private selectedEntries(): TimeEntry[] {
    if (!this.selectedEntryIds.size) return this.entries();
    return this.entries().filter((e) => this.selectedEntryIds.has(e.id));
  }

  requestFixForSelected() {
    const selected = this.selectedEntries();
    const first = selected.find((e) => e.exceptionStatus !== 'pending') || null;
    if (!first) {
      this.toast.error('Select an entry that is not already pending review.');
      return;
    }
    this.openFixRequest(first);
    this.timecardMenu = null;
  }

  printTimecard() {
    this.timecardMenu = null;
    setTimeout(() => window.print(), 50);
  }

  showBreakdown() {
    this.toast.success(`Pay code EDU: ${this.totalHours().toFixed(2)} hours.`);
    this.timecardMenu = null;
  }

  toggleRoundedTime() {
    this.showRoundedTime = !this.showRoundedTime;
  }

  toggleComments() {
    this.showComments = !this.showComments;
  }

  showEmployeeDefaults() {
    const rate = Number((this.orgSettings as any)?.defaultPayRate || 0);
    this.toast.success(`Defaults: ${this.moneyCurrency()} ${rate.toFixed(2)}/hr, 30-minute auto break after 6 hours.`);
    this.timecardMenu = null;
  }

  emailTimecard() {
    const rows = this.selectedEntries()
      .map((e) => `${this.fmtShortDate(e.checkInAt)} | ${this.fmtDisplayTime(e.checkInAt)}-${this.fmtDisplayTime(e.checkOutAt)} | ${this.workedHours(e).toFixed(2)} hrs | ${this.entryAnomalies(e).join(', ') || 'OK'}`)
      .join('\n');
    const subject = `Timecard ${this.timePeriodLabel()} - ${this.staffName()}`;
    const body = [
      `Employee: ${this.staffName()}`,
      `Period: ${this.timePeriodLabel()}`,
      `Total hours: ${this.totalHours().toFixed(2)}`,
      '',
      rows || 'No timecard rows for this period.',
    ].join('\n');
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  approveTimecard() {
    const openEntry = this.entries().find((e) => !e.checkOutAt);
    if (openEntry) {
      this.toast.error('Clock out before approving this timecard.');
      return;
    }
    this.timecardApproved = true;
    this.toast.success('Timecard marked ready for manager approval.');
  }

  fmtDisplayTime(ts: any): string {
    const d = tsToDate(ts);
    if (!d) return '—';
    const out = this.showRoundedTime ? this.roundToQuarterHour(d) : d;
    return out.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false });
  }

  private roundToQuarterHour(d: Date): Date {
    const rounded = new Date(d);
    const minutes = rounded.getMinutes();
    const next = Math.round(minutes / 15) * 15;
    rounded.setMinutes(next, 0, 0);
    return rounded;
  }

  async clockInToShift(s: Shift) {
    this.shiftId = s.id;
    this.shiftSelection = this.toShiftOptionLabel(s);
    await this.checkIn();
  }

  openCallOut(s: Shift) {
    this.callOutTargetShift = s;
    this.callOutReason = '';
  }

  cancelCallOut() {
    this.callOutTargetShift = null;
    this.callOutReason = '';
  }

  async submitCallOut() {
    const shift = this.callOutTargetShift;
    if (!shift) return;
    this.callOutBusy = true;
    try {
      await this.shiftsCmd.callOutShift(shift.id, this.callOutReason.trim() || undefined);
      this.toast.success(`Called out of "${shift.title}". It's back on the marketplace.`);
      this.cancelCallOut();
    } catch (e: any) {
      this.toast.errorFrom(e, 'Call out failed.');
    } finally {
      this.callOutBusy = false;
    }
  }

  toShiftOptionLabel(s: Shift): string {
    const location = s.locationName || 'Unknown location';
    return `${this.fmtDate(s.startAt)} ${this.fmtTime(s.startAt)}-${this.fmtTime(s.endAt)} | ${s.title} | ${location}`;
  }

  onShiftSelectionChange(value: string) {
    this.shiftSelection = value || '';
    this.shiftId = this.shiftOptionToId[this.shiftSelection] || '';
  }

  private rebuildShiftOptions() {
    const nextOptionToId: Record<string, string> = {};
    const nextIdToOption: Record<string, string> = {};
    for (const s of this.mySchedule()) {
      const option = this.toShiftOptionLabel(s);
      nextOptionToId[option] = s.id;
      nextIdToOption[s.id] = option;
    }
    this.shiftOptionToId = nextOptionToId;
    this.shiftIdToOption = nextIdToOption;
    if (this.shiftId && this.shiftIdToOption[this.shiftId]) {
      this.shiftSelection = this.shiftIdToOption[this.shiftId];
    }
  }

  workedHours(e: TimeEntry): number {
    const inD = tsToDate(e.checkInAt);
    const outD = tsToDate(e.checkOutAt);
    if (!inD || !outD) return 0;
    const breakMs = Number(e.totalBreakMs || 0);
    const ms = Math.max(0, outD.getTime() - inD.getTime() - breakMs);
    return ms / 3600000;
  }

  private effectivePayRate(e: TimeEntry): number {
    const shiftRate = Number(this.shiftMap()[e.shiftId]?.payRate || 0);
    if (shiftRate > 0) return shiftRate;

    const orgDefaultRate = Number((this.orgSettings as any)?.defaultPayRate || 0);
    return orgDefaultRate > 0 ? orgDefaultRate : 0;
  }

  estimatedPay(e: TimeEntry): number {
    const rate = this.effectivePayRate(e);
    return this.workedHours(e) * rate;
  }

  shiftLabel(shiftId: string): string {
    const shift = this.shiftMap()[shiftId];
    if (!shift) return 'Assigned shift';
    const location = shift.locationName ? ` • ${shift.locationName}` : '';
    return `${shift.title || 'Assigned shift'}${location}`;
  }

  scheduledHours(e: TimeEntry): number {
    const shift = this.shiftMap()[e.shiftId];
    return shift ? shiftHours(shift) : this.workedHours(e);
  }

  laborLevel(e: TimeEntry): string {
    const shift = this.shiftMap()[e.shiftId];
    return shift?.locationName || 'HRAPO - 00000';
  }

  totalHours(): number {
    return this.entries().reduce((sum, e) => sum + this.workedHours(e), 0);
  }

  totalEarnings(): number {
    return this.entries().reduce((sum, e) => sum + this.estimatedPay(e), 0);
  }

  pendingFixCount(): number {
    return this.entries().filter((e) => e.exceptionStatus === 'pending').length;
  }

  anomalyCount(): number {
    return this.entries().filter((e) => this.entryAnomalies(e).length > 0).length;
  }

  // Identified by entry id rather than array position so results stay
  // correct when called against a sorted/paginated subset of entries().
  entryAnomalies(e: TimeEntry): string[] {
    const issues: string[] = [];
    const inD = tsToDate(e.checkInAt);
    const outD = tsToDate(e.checkOutAt);
    const breakMs = Number(e.totalBreakMs || 0);
    const worked = this.workedHours(e);

    if (!outD) issues.push('Open entry');
    if (inD && outD && outD.getTime() <= inD.getTime()) issues.push('Invalid time order');
    if (worked >= 6 && breakMs < 30 * 60 * 1000) issues.push('Missing break');

    const shift = this.shiftMap()[e.shiftId];
    if (shift) {
      const scheduled = shiftHours(shift);
      if (scheduled > 0 && Math.abs(worked - scheduled) >= 1) issues.push('Hours mismatch');
    }

    if (this.hasOverlap(e)) issues.push('Overlap');
    return issues;
  }

  private hasOverlap(curr: TimeEntry): boolean {
    const currIn = tsToDate(curr.checkInAt)?.getTime() || 0;
    const currOut = tsToDate(curr.checkOutAt)?.getTime() || 0;
    if (!currIn || !currOut) return false;

    return this.entries().some((other) => {
      if (other.id === curr.id) return false;
      const inMs = tsToDate(other.checkInAt)?.getTime() || 0;
      const outMs = tsToDate(other.checkOutAt)?.getTime() || 0;
      if (!inMs || !outMs) return false;
      return currIn < outMs && currOut > inMs;
    });
  }

  canUseGps(): boolean {
    return this.entitlements.has('gpsAttendance');
  }

  gpsRequired(): boolean {
    return this.orgSettings?.gpsAttendanceEnabled === true;
  }

  private resolveTargetShift(): Shift | null {
    const current = this.currentShift();
    if (current && (current.id === this.shiftId || !this.shiftId)) return current;
    return this.shiftMap()[this.shiftId] || this.mySchedule().find((s) => s.id === this.shiftId) || current;
  }

  /**
   * Best-guess site for the geofence preview map. Mirrors the backend's
   * locationId → locationName → any-active-site fallback in
   * verifyGpsAgainstOrg — purely a visual aid, the server remains the
   * source of truth for which site actually satisfies the geofence.
   */
  activeSiteForMap(): GeofenceSite | null {
    const rawSites = Array.isArray(this.orgSettings?.sites) ? this.orgSettings!.sites! : [];
    const activeSites = rawSites.filter((s) => s?.active !== false && Number.isFinite(Number(s?.latitude)) && Number.isFinite(Number(s?.longitude)));
    if (!activeSites.length) return null;

    const shift = this.resolveTargetShift();
    let candidates = activeSites;
    if (shift?.locationId) {
      const byId = activeSites.filter((s) => String(s.id || '').trim() === String(shift.locationId).trim());
      if (byId.length) candidates = byId;
    } else if (shift?.locationName) {
      const byName = activeSites.filter((s) => String(s.name || '').trim().toLowerCase() === String(shift.locationName).trim().toLowerCase());
      if (byName.length) candidates = byName;
    }

    const site = candidates[0] || activeSites[0];
    return {
      name: String(site.name || 'Site'),
      latitude: Number(site.latitude),
      longitude: Number(site.longitude),
      radiusM: Math.max(25, Number(site.radiusM || 150)),
    };
  }

  setPunchMethod(method: 'manual' | 'gps') {
    if (method === 'gps' && !this.canUseGps()) return;
    if (method === 'manual' && this.gpsRequired()) return;
    this.punchMethod = method;
  }

  private async loadOrgSettings(orgId: string) {
    try {
      const snap = await getDoc(doc(getFirestore(), 'orgs', orgId));
      this.orgSettings = snap.exists() ? (snap.data() as any) : null;
      if (this.gpsRequired()) {
        this.punchMethod = 'gps';
      }
    } catch {
      // Keep attendance available even if settings fetch fails.
    }
  }

  private async getGpsPayload() {
    if (!navigator.geolocation) {
      throw new Error('This device does not support geolocation.');
    }

    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyM: position.coords.accuracy,
    };
  }

  async checkIn() {
    if (!this.shiftId && this.shiftSelection) {
      this.shiftId = this.shiftOptionToId[this.shiftSelection] || '';
    }
    if (!this.shiftId) return;
    this.busy = true;
    try {
      const geo = this.punchMethod === 'gps' ? await this.getGpsPayload() : undefined;
      const res = await this.cmd.checkIn(this.shiftId, this.punchMethod, geo);
      this.entryId.set(res.entryId);
      this.toast.success(this.punchMethod === 'gps' ? 'GPS check-in verified.' : 'Checked in successfully.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Check-in failed.');
    } finally {
      this.busy = false;
    }
  }

  async checkOut() {
    if (!this.entryId()) return;
    this.busy = true;
    try {
      const geo = this.punchMethod === 'gps' ? await this.getGpsPayload() : undefined;
      await this.cmd.checkOut(this.entryId()!, this.punchMethod, { shiftId: this.shiftId, ...geo });
      this.toast.success(this.punchMethod === 'gps' ? 'GPS check-out verified.' : 'Checked out successfully.');
      this.onBreak.set(false);
    } catch (e: any) {
      this.toast.errorFrom(e, mapAttendancePolicyError(e, 'Check-out failed.'));
    } finally {
      this.busy = false;
    }
  }

  async breakOut() {
    if (!this.entryId()) return;
    this.busy = true;
    try {
      await this.cmd.breakOut(this.entryId()!);
      this.onBreak.set(true);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Break-out failed.');
    } finally {
      this.busy = false;
    }
  }

  async breakIn() {
    if (!this.entryId()) return;
    this.busy = true;
    try {
      await this.cmd.breakIn(this.entryId()!);
      this.onBreak.set(false);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Break-in failed.');
    } finally {
      this.busy = false;
    }
  }

  async requestFix(e: TimeEntry) {
    this.openFixRequest(e);
  }

  openFixRequest(e: TimeEntry) {
    this.fixRequestEntry = e;
    this.fixCategory = 'missed_punch';
    this.fixReason = this.buildReasonTemplate(this.fixCategory);
    const inD  = tsToDate(e.checkInAt);
    const outD = tsToDate(e.checkOutAt);
    this.fixProposedIn  = inD  ? this.toLocalInput(inD)  : '';
    this.fixProposedOut = outD ? this.toLocalInput(outD) : '';
  }

  onFixCategoryChange() {
    if (!this.fixReason.trim() || this.fixReason.trim().length < 8) {
      this.fixReason = this.buildReasonTemplate(this.fixCategory);
    }
  }

  fixHint(): string {
    return this.fixCategory === 'missed_punch'
      ? 'Tip: include approximate punch time and what happened.'
      : this.fixCategory === 'wrong_hours'
      ? 'Tip: explain expected schedule and why hours differ.'
      : this.fixCategory === 'missed_break'
      ? 'Tip: describe break timing and duration.'
      : this.fixCategory === 'site_mismatch'
      ? 'Tip: provide actual location/site during this shift.'
      : 'Tip: add enough details for admin review.';
  }

  isFixRequestValid(): boolean {
    return this.fixReason.trim().length >= 8;
  }

  cancelFixRequest() {
    this.fixRequestEntry = null;
    this.fixCategory = 'missed_punch';
    this.fixReason = '';
    this.fixProposedIn = '';
    this.fixProposedOut = '';
  }

  async submitFixRequest() {
    const entry = this.fixRequestEntry;
    if (!entry || !this.fixReason.trim()) return;
    const inMs  = this.fixProposedIn  ? new Date(this.fixProposedIn).getTime()  : 0;
    const outMs = this.fixProposedOut ? new Date(this.fixProposedOut).getTime() : 0;
    if (inMs > 0 && outMs > 0 && outMs <= inMs) {
      this.toast.error('Proposed check-out must be after proposed check-in.');
      return;
    }
    this.busy = true;
    try {
      await this.cmd.requestTimeCorrection({
        entryId: entry.id,
        reason: `[${this.fixCategory}] ${this.fixReason.trim()}`,
        correctedCheckInAtMs:  inMs  > 0 ? inMs  : undefined,
        correctedCheckOutAtMs: outMs > 0 ? outMs : undefined,
      });
      this.toast.success('Correction request sent to admin.');
      this.cancelFixRequest();
    } catch (err: any) {
      this.toast.errorFrom(err, 'Failed to request correction.');
    } finally {
      this.busy = false;
    }
  }

  private toLocalInput(d: Date): string {
    const offset = d.getTimezoneOffset();
    return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16);
  }

  decisionActor(e: TimeEntry): string {
    const raw = String(e.correctionLastDecision?.decidedBy || e.approvedBy || '').trim();
    if (!raw) return '—';
    return raw.length > 14 ? `${raw.slice(0, 6)}...${raw.slice(-4)}` : raw;
  }

  trackByEntry = (_: number, entry: TimeEntry) => entry.id;

  private buildReasonTemplate(category: string): string {
    if (category === 'missed_punch') return 'I missed my punch due to';
    if (category === 'wrong_hours') return 'My worked hours should be adjusted because';
    if (category === 'missed_break') return 'My break information is inaccurate because';
    if (category === 'site_mismatch') return 'My work site/location should be corrected because';
    return 'Please review this entry because';
  }

}
