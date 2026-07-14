import { AfterViewInit, Component, NgZone, OnDestroy, TemplateRef, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Timestamp } from 'firebase/firestore';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { UsersRepo, OrgUser } from '../../core/repos/users.repo';
import { SchedulerCommands } from '../../core/commands/scheduler.commands';
import { ShiftAdminCommands } from '../../core/commands/shift-admin.commands';
import { ModalService } from '../../shared/ui/modal/modal.service';
import { DrawerComponent } from '../../shared/ui/drawer/drawer.component';

import { Shift } from '../../shared/models/shift.model';
import { tsToDate } from '../../shared/utils/date.util';
import { ToastService } from '../../core/ui/toast.service';
import { mapAttendancePolicyError } from '../../shared/utils/attendance-policy-error.util';
import { doc, getDoc, getFirestore } from 'firebase/firestore';

import { FullCalendarModule } from '@fullcalendar/angular';
import interactionPlugin from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';

import { MatIconModule } from '@angular/material/icon';

interface OrgSite {
  id: string;
  name: string;
  active?: boolean;
}

@Component({
  standalone: true,
  imports: [CommonModule, FullCalendarModule, DrawerComponent, FormsModule, MatIconModule],
  template: `
    <div class="vs-page-pad sch-page">
      <!-- Header -->
      <div class="vs-page-header sch-hero">
        <div class="vs-page-title sch-hero-copy">
          <div class="sch-brand-line">
            <span class="sch-brand-mark">S</span>
            <span>InnovaShift</span>
          </div>
          <h1 class="vs-title sch-hero-title">All-in-One Workforce Calendar</h1>
          <p class="vs-page-subtitle sch-hero-subtitle">Scheduling, attendance, timesheets, communication, and insights in one place.</p>
        </div>
        <div class="vs-page-actions sch-hero-actions">
          <button class="vs-btn-ghost sch-hero-btn" (click)="printScheduler()">
            <mat-icon>print</mat-icon> Print Week
          </button>
          <button class="vs-btn-ghost sch-hero-btn" (click)="exportSchedulerCsv()">
            <mat-icon>download</mat-icon> Export CSV
          </button>
          <button class="vs-btn-primary sch-create-btn" (click)="openDrawerForNew()">
            <mat-icon>add</mat-icon> Create Shift
          </button>
        </div>
      </div>

      <div *ngIf="!orgId" class="ad-no-org vs-glass">
        <mat-icon>warning_amber</mat-icon> Missing org context.
      </div>

      <div *ngIf="orgId" class="sch-planning-grid">
        <div class="sch-plan-card vs-glass">
          <mat-icon class="sch-plan-icon">calendar_month</mat-icon>
          <div>
            <div class="sch-plan-label">Visible Shifts</div>
            <div class="sch-plan-value">{{ totalVisibleShifts() }}</div>
            <div class="sch-plan-sub">Current filters</div>
          </div>
        </div>
        <div class="sch-plan-card vs-glass" [class.sch-plan-card--warn]="unassignedVisibleShifts() > 0">
          <mat-icon class="sch-plan-icon">radar</mat-icon>
          <div>
            <div class="sch-plan-label">Open Coverage</div>
            <div class="sch-plan-value">{{ unassignedVisibleShifts() }}</div>
            <div class="sch-plan-sub">Unassigned shifts</div>
          </div>
        </div>
        <div class="sch-plan-card vs-glass" [class.sch-plan-card--danger]="urgentVisibleShifts() > 0">
          <mat-icon class="sch-plan-icon">emergency_home</mat-icon>
          <div>
            <div class="sch-plan-label">Next 24h Risk</div>
            <div class="sch-plan-value">{{ urgentVisibleShifts() }}</div>
            <div class="sch-plan-sub">Open or draft shifts</div>
          </div>
        </div>
        <div class="sch-plan-card vs-glass">
          <mat-icon class="sch-plan-icon">monitoring</mat-icon>
          <div>
            <div class="sch-plan-label">Planned Labor</div>
            <div class="sch-plan-value">{{ projectedHours() }}h</div>
            <div class="sch-plan-sub">{{ projectedLaborCost() | currency:moneyCurrency():'symbol':'1.0-0' }} projected</div>
          </div>
        </div>
      </div>

      <div *ngIf="orgId" class="vs-glass-strong sch-container">
        <div class="sch-toolbar">
          <div class="sch-filters">
            <select class="vs-select" [(ngModel)]="filterStatus" (ngModelChange)="refreshCalendarEvents()">
              <option value="all">All statuses</option>
              <option *ngFor="let s of statusOptions" [value]="s">{{ s }}</option>
            </select>
            <select class="vs-select" [(ngModel)]="filterSite" (ngModelChange)="refreshCalendarEvents()">
              <option value="all">All sites</option>
              <option *ngFor="let site of sites" [value]="site.id">{{ site.name }}</option>
            </select>
            <select class="vs-select" [(ngModel)]="filterAssigned" (ngModelChange)="refreshCalendarEvents()">
              <option value="all">All assignment</option>
              <option value="assigned">Assigned</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
          <div class="sch-toolbar-bottom">
            <div class="sch-legend">
              <span class="sch-legend-item" *ngFor="let item of statusLegend">
                <span class="sch-legend-dot" [class]="'sch-legend-dot sch-legend-dot--' + item.key"></span>
                {{ item.label }}
              </span>
            </div>
            <button class="vs-btn-ghost sch-batch-btn" type="button" (click)="publishFilteredOpenShifts()" [disabled]="publishingBatch || batchPublishCount() === 0">
              <mat-icon>campaign</mat-icon>
              {{ publishingBatch ? 'Publishing...' : 'Publish Filtered Open' }}
              <span *ngIf="batchPublishCount() > 0">({{ batchPublishCount() }})</span>
            </button>
          </div>
        </div>

        <div class="sch-calendar-shell">
          <div class="sch-calendar-topline">
            <div>
              <div class="sch-calendar-kicker">Smart Scheduling</div>
              <div class="sch-calendar-title">Weekly Workforce Plan</div>
            </div>
            <div class="sch-live-pill">
              <span></span>
              Live Calendar
            </div>
          </div>

          <full-calendar
            [options]="calendarOptions"
            class="vs-calendar">
          </full-calendar>
        </div>

        <div class="sch-footer-hint">
          <mat-icon style="font-size:16px;">info</mat-icon>
          Click a shift for actions. Drag range to create. Drag & drop to reschedule.
        </div>

        <!-- Shift Actions Modal -->
        <ng-template #shiftActionsTpl let-s="shift">
          <div *ngIf="s" class="sch-modal-content">
            <div class="vs-form-row vs-form-row--2">
              <button class="vs-btn-primary" (click)="openEditDrawer(s)" [disabled]="s.status === 'completed' || s.status === 'cancelled'"><mat-icon>edit</mat-icon> Edit</button>
              <button class="vs-btn-primary" (click)="publish(s,true)" *ngIf="s.status === 'draft' || s.status === 'open'">Publish to Marketplace</button>
              <button class="vs-btn-ghost" (click)="publish(s,false)" *ngIf="s.status === 'published'">Unpublish</button>
              <button class="vs-btn-primary" (click)="openStaffPicker(s)">Assign</button>
              <button class="vs-btn-ghost" (click)="unassign(s)" *ngIf="s.assignedUserId">Unassign</button>
              <button class="vs-btn-ghost" (click)="openShiftChat(s.id)"><mat-icon>chat</mat-icon> Open Chat</button>
            </div>

            <div class="sch-shift-details">
              <div class="sch-detail-item"><span>Title</span> {{ s.title }}</div>
              <div class="sch-detail-item"><span>Status</span> <span class="vs-badge vs-badge--neutral">{{ s.status | uppercase }}</span></div>
              <div class="sch-detail-item"><span>Location</span> {{ s.locationName }}</div>
              <div class="sch-detail-item"><span>Assigned</span> {{ s.assignedUserId ? userLabel(s.assignedUserId) : '—' }}</div>
            </div>
          </div>
        </ng-template>

        <!-- Staff Picker Modal -->
        <ng-template #staffPickerTpl>
          <div class="sch-modal-content">
            <div class="vs-input-wrap" style="margin-bottom:14px;">
              <input class="vs-input" [(ngModel)]="staffSearch" placeholder="Search staff (name/email/role)">
            </div>

            <div class="sch-staff-list">
              <div *ngFor="let u of filteredUsers(); let i = index" class="sch-staff-item">
                <div class="sch-staff-info">
                  <div class="sch-staff-name">{{ u.displayName || u.email || 'Staff member' }}</div>
                  <div class="sch-staff-role">{{ u.jobRole || '—' }}</div>
                </div>
                <button class="vs-btn-ghost sch-assign-btn" (click)="pickStaff(u.uid)">Select</button>
              </div>
              <div *ngIf="filteredUsers().length === 0" class="vs-muted" style="padding:20px;text-align:center;">No staff found.</div>
            </div>
          </div>
        </ng-template>
      </div>

      <app-drawer [open]="drawerOpen" [title]="drawerTitle" (close)="closeDrawer()">
        <div class="sch-drawer-body">
          <div class="sch-preset-row" *ngIf="!editingShiftId">
            <button class="vs-btn-ghost" type="button" (click)="applyWeekdayPreset()">
              <mat-icon>auto_fix_high</mat-icon>
              Standard Mon-Fri 8h
            </button>
          </div>

          <div class="vs-form-row">
            <div>
              <label class="vs-field-label">Title *</label>
              <input class="vs-input" [(ngModel)]="draft.title" placeholder="e.g. Morning Shift">
            </div>
          </div>
          <div class="vs-form-row">
            <div>
              <label class="vs-field-label">Location *</label>
              <select *ngIf="sites.length" class="vs-select" [(ngModel)]="draft.locationId" (ngModelChange)="onDraftSiteChange($event)">
                <option value="">Select a site</option>
                <option *ngFor="let site of sites" [value]="site.id">{{ site.name }}</option>
              </select>
              <input *ngIf="!sites.length" class="vs-input" [(ngModel)]="draft.locationName" placeholder="e.g. Main Clinic">
            </div>
          </div>

          <div class="vs-form-row vs-form-row--2">
            <div>
              <label class="vs-field-label">Start Time *</label>
              <input type="datetime-local" class="vs-input" [(ngModel)]="draft.startLocal">
            </div>
            <div>
              <label class="vs-field-label">End Time *</label>
              <input type="datetime-local" class="vs-input" [(ngModel)]="draft.endLocal">
            </div>
          </div>

          <div class="vs-form-row vs-form-row--2">
            <div>
              <label class="vs-field-label">Required Role</label>
              <select class="vs-select" [(ngModel)]="draft.requiredJobRole">
                <option value="">Any</option>
                <option>RN</option><option>CNA</option><option>LPN</option><option>Caregiver</option>
                <option>NP</option><option>MD</option><option>Manager</option><option>Admin</option><option>HR</option>
              </select>
            </div>
            <div>
              <label class="vs-field-label">Pay Rate ({{ moneyCurrency() }}/hr)</label>
              <input type="number" class="vs-input" [(ngModel)]="draft.payRate" placeholder="e.g. 45">
            </div>
          </div>

          <div class="vs-form-row">
            <div>
              <label class="vs-field-label">Notes</label>
              <textarea rows="3" class="vs-input" [(ngModel)]="draft.notes" placeholder="Shift instructions..."></textarea>
            </div>
          </div>

          <div class="vs-form-row vs-form-row--2" *ngIf="!editingShiftId">
            <div>
              <label class="vs-field-label">Assign to Employee (optional)</label>
              <select class="vs-select" [(ngModel)]="draft.assigneeUid">
                <option value="">Unassigned</option>
                <option *ngFor="let u of users()" [value]="u.uid">{{ userLabel(u.uid) }}</option>
              </select>
            </div>
            <div class="sch-inline-checks">
              <label class="sch-toggle-inline">
                <input type="checkbox" [(ngModel)]="draft.publishIfUnassigned">
                <span>Publish to marketplace if unassigned</span>
              </label>
              <label class="sch-toggle-inline">
                <input type="checkbox" [(ngModel)]="draft.repeatWeekdays">
                <span>Repeat weekdays</span>
              </label>
            </div>
          </div>

          <div class="vs-form-row" *ngIf="!editingShiftId && draft.repeatWeekdays">
            <div>
              <label class="vs-field-label">Number of weeks</label>
              <input type="number" min="1" max="12" class="vs-input" [(ngModel)]="draft.repeatWeeks" placeholder="1">
            </div>
          </div>

          <div class="sch-drawer-actions">
            <button class="vs-btn-ghost" (click)="closeDrawer()">Cancel</button>
            <button class="vs-btn-primary" (click)="saveDrawer()" [disabled]="!draft.title || !draft.locationName || !draft.startLocal || !draft.endLocal">
              <mat-icon>{{ editingShiftId ? 'save' : 'add' }}</mat-icon> {{ editingShiftId ? 'Save Changes' : 'Create Shift' }}
            </button>
          </div>
        </div>
      </app-drawer>
    </div>
  `,
  styles: [`
    .sch-page {
      --sch-bg: var(--app-bg);
      --sch-panel: var(--bg-surface);
      --sch-panel-strong: var(--bg-elevated);
      --sch-border: var(--border);
      --sch-border-strong: var(--border-strong);
      --sch-cyan: var(--accent);
      --sch-blue: var(--primary);
      --sch-blue-soft: rgba(29, 78, 216, 0.12);
      --sch-text: var(--text);
      --sch-muted: var(--text-muted);
      --sch-subtle: var(--text-subtle);
      min-height: calc(100vh - 64px);
      margin: -28px -24px;
      padding: 28px 24px;
      color: var(--sch-text);
      background: var(--app-bg);
    }

    .sch-page .vs-title,
    .sch-page .vs-page-subtitle,
    .sch-page .vs-panel-title,
    .sch-page .vs-panel-subtitle {
      color: inherit;
    }

    .ad-no-org { display:flex; align-items:center; gap:12px; padding:20px; color:var(--warning); font-weight:600; }

    .sch-hero {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 24px;
      min-height: 180px;
      padding: 26px 28px;
      margin-bottom: 18px;
      border: 1px solid var(--sch-border);
      border-radius: 24px;
      overflow: hidden;
      background:
        linear-gradient(120deg, rgba(3, 7, 18, 0.92), rgba(6, 21, 53, 0.90) 58%, rgba(3, 12, 33, 0.92)),
        linear-gradient(90deg, rgba(34, 211, 238, 0.08), rgba(37, 99, 235, 0.08));
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255,255,255,0.08);
      isolation: isolate;
    }

    .sch-hero::before {
      content: '';
      position: absolute;
      inset: auto -12% -56px 22%;
      height: 118px;
      border-top: 2px solid rgba(34, 211, 238, 0.72);
      border-radius: 50% 50% 0 0;
      filter: drop-shadow(0 0 22px rgba(34, 211, 238, 0.46));
      pointer-events: none;
      z-index: -1;
    }

    .sch-hero::after {
      content: '';
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(rgba(34, 211, 238, 0.08) 1px, transparent 1px),
        linear-gradient(90deg, rgba(37, 99, 235, 0.08) 1px, transparent 1px);
      background-size: 44px 44px;
      mask-image: linear-gradient(90deg, transparent, #000 20%, #000 76%, transparent);
      opacity: 0.36;
      pointer-events: none;
      z-index: -1;
    }

    .sch-hero-copy { min-width: 0; }
    .sch-brand-line {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: #f8fafc;
      font-size: 20px;
      font-weight: 900;
      margin-bottom: 10px;
    }
    .sch-brand-mark {
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      color: #00111d;
      font-weight: 1000;
      background: linear-gradient(135deg, #22d3ee, #2563eb);
      box-shadow: 0 0 28px rgba(34, 211, 238, 0.42);
      transform: skew(-10deg);
    }
    .sch-hero-title {
      max-width: 760px;
      margin: 0;
      font-size: clamp(34px, 5vw, 64px);
      line-height: 0.98;
      color: #f8fafc;
    }
    .sch-hero-title::first-line { color: #fff; }
    .sch-hero-subtitle {
      max-width: 620px;
      margin-top: 14px;
      color: rgba(226,232,240,0.90) !important;
      font-size: 15px;
      line-height: 1.5;
    }
    .sch-hero-actions {
      justify-self: end;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
      max-width: 440px;
    }
    .sch-hero-btn,
    .sch-create-btn {
      min-height: 42px;
      border-radius: 12px !important;
      box-shadow: none !important;
    }
    .sch-page .vs-btn-ghost {
      color: var(--text-muted);
      background: var(--bg-surface);
      border: 1px solid var(--border);
    }
    .sch-page .vs-btn-ghost:hover {
      color: var(--primary);
      border-color: var(--sch-border-strong);
      background: rgba(29,78,216,0.08);
    }
    .sch-create-btn {
      color: #f8fbff !important;
      background: linear-gradient(135deg, #06b6d4, #2563eb) !important;
      box-shadow: 0 12px 34px rgba(37, 99, 235, 0.30) !important;
    }

    .sch-container {
      padding: 18px;
      border-radius: 24px;
      overflow:hidden;
      background: var(--bg-surface);
      border: 1px solid var(--sch-border);
      box-shadow: var(--shadow);
    }
    .sch-toolbar { display:flex; flex-direction:column; gap:14px; margin-bottom:16px; }
    .sch-filters { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:10px; }
    .sch-toolbar-bottom { display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap; }
    .sch-legend { display:flex; gap:10px; flex-wrap:wrap; }
    .sch-legend-item { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--sch-muted); border:1px solid var(--border); border-radius:999px; padding:6px 10px; background:var(--bg-elevated); }
    .sch-legend-dot { width:9px; height:9px; border-radius:50%; display:inline-block; box-shadow:0 0 14px currentColor; }
    .sch-batch-btn { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; }
    .sch-planning-grid { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:12px; margin-bottom:16px; }
    .sch-plan-card {
      display: flex;
      align-items: center;
      gap: 14px;
      min-height: 92px;
      padding:16px;
      border-radius:16px !important;
      border:1px solid var(--border);
      background: var(--bg-surface);
      box-shadow: var(--shadow-sm);
    }
    .sch-plan-card--warn { border-color:rgba(245,158,11,0.44) !important; }
    .sch-plan-card--danger { border-color:rgba(239,68,68,0.48) !important; }
    .sch-plan-icon {
      width: 42px;
      height: 42px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--sch-cyan);
      border-radius: 14px;
      background: rgba(34, 211, 238, 0.10);
      border: 1px solid rgba(34, 211, 238, 0.22);
      box-shadow: 0 0 22px rgba(34, 211, 238, 0.18);
    }
    .sch-plan-label { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:var(--sch-subtle); }
    .sch-plan-value { margin-top:6px; color:var(--sch-text); font-size:30px; font-weight:900; line-height:1; }
    .sch-plan-sub { margin-top:6px; color:var(--sch-muted); font-size:12px; }
    .sch-legend-dot--draft { background:#64748b; }
    .sch-legend-dot--open { background:#0ea5e9; }
    .sch-legend-dot--published { background:#10b981; }
    .sch-legend-dot--assigned { background:#f59e0b; }
    .sch-legend-dot--in_progress { background:#8b5cf6; }
    .sch-legend-dot--completed { background:#22c55e; }
    .sch-legend-dot--cancelled { background:#ef4444; }

    .sch-calendar-shell {
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--bg-surface);
      box-shadow: var(--shadow-sm);
    }
    .sch-calendar-topline {
      display:flex;
      justify-content:space-between;
      gap:12px;
      align-items:center;
      padding:16px 18px;
      border-bottom:1px solid var(--border);
      background: var(--bg-elevated);
    }
    .sch-calendar-kicker {
      color: var(--sch-cyan);
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    .sch-calendar-title {
      margin-top: 4px;
      color: var(--sch-text);
      font-size: 18px;
      font-weight: 900;
    }
    .sch-live-pill {
      display:inline-flex;
      align-items:center;
      gap:8px;
      color:var(--sch-muted);
      font-size:12px;
      font-weight:800;
      border:1px solid rgba(34,211,238,0.24);
      border-radius:999px;
      padding:7px 11px;
      background:rgba(8,145,178,0.10);
    }
    .sch-live-pill span {
      width:8px;
      height:8px;
      border-radius:50%;
      background:#22c55e;
      box-shadow:0 0 16px rgba(34,197,94,0.70);
    }

    .sch-footer-hint { display:flex; align-items:center; gap:8px; margin-top:16px; color:var(--sch-subtle); font-size:13px; font-weight:500; }

    /* Modals & Drawer */
    .sch-modal-content { display:flex; flex-direction:column; gap:16px; }
    .sch-shift-details { background:var(--panel-2); border-radius:var(--radius); padding:16px; display:flex; flex-direction:column; gap:10px; }
    .sch-detail-item { display:flex; justify-content:space-between; font-size:14px; color:var(--text); }
    .sch-detail-item span:first-child { color:var(--text-muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:0.05em; }

    .sch-staff-list { display:flex; flex-direction:column; border:1px solid var(--border); border-radius:var(--radius); max-height:400px; overflow-y:auto; background:var(--panel); }
    .sch-staff-item { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid var(--border); }
    .sch-staff-item:last-child { border-bottom:none; }
    .sch-staff-name { font-weight:800; font-size:14px; color:var(--text); margin-bottom:4px; }
    .sch-staff-role { font-size:12px; color:var(--text-subtle); font-family:monospace; }
    .sch-assign-btn { padding:6px 12px !important; font-size:12px !important; }

    .sch-drawer-body { display:flex; flex-direction:column; gap:16px; padding:10px 4px; }
    .sch-preset-row { display:flex; justify-content:flex-start; }
    .sch-inline-checks { display:flex; flex-direction:column; gap:8px; justify-content:center; }
    .sch-toggle-inline { display:flex; gap:8px; align-items:center; color:var(--text); font-size:13px; font-weight:600; }
    .sch-drawer-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:10px; padding-top:16px; border-top:1px solid var(--border); }

    .sch-page .vs-select,
    .sch-page .vs-input {
      color: var(--text);
      background: var(--bg-surface);
      border-color: var(--border);
      box-shadow: none;
    }
    .sch-page .vs-select:focus,
    .sch-page .vs-input:focus {
      border-color: var(--sch-border-strong);
      box-shadow: 0 0 0 3px rgba(29,78,216,0.12);
    }
    .sch-page .vs-select option {
      color: var(--text);
      background: var(--bg-surface);
    }

    /* FullCalendar Command Center Theme */
    ::ng-deep .vs-calendar.fc {
      --fc-border-color: var(--border);
      --fc-page-bg-color: transparent;
      --fc-neutral-bg-color: var(--bg-elevated);
      --fc-neutral-text-color: var(--text-muted);
      --fc-today-bg-color: rgba(8,145,178,0.08);
      padding: 16px;
      color: var(--sch-text);
      background: transparent;
    }
    ::ng-deep .vs-calendar .fc-toolbar.fc-header-toolbar {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 12px;
      align-items: center;
      margin-bottom: 16px;
    }
    ::ng-deep .vs-calendar .fc-toolbar-title {
      color: var(--text);
      font-size: 21px;
      font-weight: 950;
      letter-spacing: 0;
    }
    ::ng-deep .vs-calendar .fc-toolbar-chunk:first-child {
      justify-self: start;
    }
    ::ng-deep .vs-calendar .fc-toolbar-chunk:last-child {
      justify-self: end;
    }
    ::ng-deep .vs-calendar .fc-scrollgrid {
      overflow: hidden;
      border: 1px solid var(--border) !important;
      border-radius: 16px;
      background: var(--bg-surface);
      box-shadow: none;
    }
    ::ng-deep .vs-calendar .fc-theme-standard td,
    ::ng-deep .vs-calendar .fc-theme-standard th {
      border-color: var(--border);
    }
    ::ng-deep .vs-calendar .fc-col-header {
      background: var(--bg-elevated);
    }
    ::ng-deep .vs-calendar .fc-col-header-cell {
      border-bottom-color: var(--border) !important;
    }
    ::ng-deep .vs-calendar .fc-col-header-cell-cushion {
      color: var(--sch-text);
      font-weight: 850;
      padding: 14px 4px;
      text-transform: uppercase;
      font-size: 12px;
      letter-spacing: 0.08em;
    }
    ::ng-deep .vs-calendar .fc-day-today .fc-col-header-cell-cushion,
    ::ng-deep .vs-calendar .fc-day-today .fc-timegrid-col-frame {
      color: var(--primary);
    }
    ::ng-deep .vs-calendar .fc-timegrid-axis,
    ::ng-deep .vs-calendar .fc-timegrid-slot-label {
      background: var(--bg-elevated);
    }
    ::ng-deep .vs-calendar .fc-timegrid-slot {
      height: 46px;
    }
    ::ng-deep .vs-calendar .fc-timegrid-slot-lane {
      background: var(--bg-surface);
    }
    ::ng-deep .vs-calendar .fc-timegrid-slot-lane:hover {
      background: rgba(8,145,178,0.04);
    }
    ::ng-deep .vs-calendar .fc-timegrid-slot-label-cushion {
      color: var(--sch-subtle);
      font-size: 12px;
      font-weight: 700;
    }
    ::ng-deep .vs-calendar .fc-timegrid-axis-cushion {
      color: var(--sch-subtle);
      font-size: 11px;
      text-transform: uppercase;
    }
    ::ng-deep .vs-calendar .fc-timegrid-now-indicator-line {
      border-color: var(--sch-cyan);
      box-shadow: 0 0 18px rgba(34, 211, 238, 0.58);
    }
    ::ng-deep .vs-calendar .fc-timegrid-now-indicator-arrow {
      border-color: var(--sch-cyan);
      border-top-color: transparent;
      border-bottom-color: transparent;
      filter: drop-shadow(0 0 8px rgba(34, 211, 238, 0.65));
    }
    ::ng-deep .vs-calendar .fc-highlight {
      background: rgba(34, 211, 238, 0.14);
      box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.26);
    }
    ::ng-deep .vs-calendar .fc-event.sch-event-card {
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 10px;
      box-shadow: 0 10px 24px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.13);
      overflow: hidden;
      color: #fff;
      padding: 0;
      min-height: 62px;
      backdrop-filter: blur(8px);
      transition: transform var(--t-fast), box-shadow var(--t-fast), filter var(--t-fast);
    }
    ::ng-deep .vs-calendar .fc-event.sch-event-card:hover {
      box-shadow: 0 18px 34px rgba(0,0,0,0.34), 0 0 28px rgba(34,211,238,0.16);
      transform: translateY(-1px);
      cursor: pointer;
      filter: saturate(1.08);
    }
    ::ng-deep .vs-calendar .fc-event.sch-event-card .fc-event-main {
      padding: 0;
      color: inherit;
      text-shadow: none;
    }
    ::ng-deep .vs-calendar .fc-event.sch-event-card .fc-event-time {
      display: none;
    }
    ::ng-deep .vs-calendar .sch-ev-card-inner {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px 9px;
      line-height: 1.2;
      min-width: 0;
    }
    ::ng-deep .vs-calendar .sch-ev-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      min-width: 0;
    }
    ::ng-deep .vs-calendar .sch-ev-title {
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      flex: 1 1 auto;
    }
    ::ng-deep .vs-calendar .sch-ev-avatar {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: rgba(255,255,255,0.24);
      border: 1px solid rgba(255,255,255,0.35);
      font-size: 8.5px;
      font-weight: 900;
      letter-spacing: 0;
    }
    ::ng-deep .vs-calendar .sch-ev-pill {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 1px 5px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
    }
    ::ng-deep .vs-calendar .sch-ev-dot {
      flex: 0 0 auto;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    ::ng-deep .vs-calendar .sch-ev-pill-time {
      flex: 0 0 auto;
      opacity: 0.85;
      font-size: 10px;
    }
    ::ng-deep .vs-calendar .sch-ev-pill-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    ::ng-deep .vs-calendar .sch-ev-meta {
      font-size: 10.5px;
      opacity: 0.92;
      font-weight: 750;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    ::ng-deep .vs-calendar .sch-ev-chips {
      display: flex;
      gap: 4px;
      flex-wrap: nowrap;
      overflow: hidden;
    }
    ::ng-deep .vs-calendar .sch-ev-chip {
      display: inline-block;
      max-width: 110px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 9px;
      font-weight: 850;
      padding: 2px 6px;
      border-radius: 999px;
      background: rgba(255,255,255,0.16);
      border: 1px solid rgba(255,255,255,0.24);
    }
    ::ng-deep .vs-calendar .sch-ev-chip--status { text-transform: capitalize; }

    /* Status color palette */
    ::ng-deep .vs-calendar .fc-event.sch-event--draft {
      background: linear-gradient(135deg, #64748b, #334155);
      border-color: rgba(148,163,184,0.45);
    }
    ::ng-deep .vs-calendar .fc-event.sch-event--open {
      background: linear-gradient(135deg, #00c8ff, #2563eb);
      border-color: rgba(56,189,248,0.45);
      box-shadow: 0 12px 28px rgba(37, 99, 235, 0.28), 0 0 18px rgba(34, 211, 238, 0.16);
    }
    ::ng-deep .vs-calendar .fc-event.sch-event--published {
      background: linear-gradient(135deg, #15d3a3, #0f766e);
      border-color: rgba(16,185,129,0.45);
    }
    ::ng-deep .vs-calendar .fc-event.sch-event--assigned,
    ::ng-deep .vs-calendar .fc-event.sch-event--claimed {
      background: linear-gradient(135deg, #f59e0b, #e85d04);
      border-color: rgba(251,191,36,0.50);
    }
    ::ng-deep .vs-calendar .fc-event.sch-event--in_progress {
      background: linear-gradient(135deg, #8b5cf6, #2563eb);
      border-color: rgba(167,139,250,0.45);
    }
    ::ng-deep .vs-calendar .fc-event.sch-event--completed {
      background: linear-gradient(135deg, #22c55e, #16a34a);
      border-color: rgba(74,222,128,0.45);
    }
    ::ng-deep .vs-calendar .fc-event.sch-event--expired,
    ::ng-deep .vs-calendar .fc-event.sch-event--cancelled,
    ::ng-deep .vs-calendar .fc-event.sch-event--no_show {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      border-color: rgba(248,113,113,0.52);
    }
    ::ng-deep .vs-calendar .fc-button-primary {
      min-height: 36px;
      border-radius: 10px !important;
      background: var(--bg-surface) !important;
      border: 1px solid var(--border) !important;
      color: var(--text-muted) !important;
      text-transform: capitalize;
      font-weight: 800;
      box-shadow: none !important;
      transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
    }
    ::ng-deep .vs-calendar .fc-button-primary:hover {
      background: rgba(29,78,216,0.08) !important;
      border-color: var(--sch-border-strong) !important;
      color: var(--primary) !important;
    }
    ::ng-deep .vs-calendar .fc-button-active,
    ::ng-deep .vs-calendar .fc-button-primary:not(:disabled).fc-button-active {
      background: rgba(29,78,216,0.12) !important;
      color: var(--primary) !important;
      border-color: var(--sch-border-strong) !important;
      box-shadow: 0 0 18px rgba(34, 211, 238, 0.12) !important;
    }
    @media (max-width: 860px) {
      .sch-page {
        margin: -16px -14px;
        padding: 16px 14px;
      }
      .sch-hero {
        grid-template-columns: 1fr;
        min-height: 0;
        padding: 22px 18px;
      }
      .sch-hero-actions {
        justify-self: stretch;
        justify-content: flex-start;
        max-width: none;
      }
      .sch-hero-btn,
      .sch-create-btn {
        flex: 1 1 160px;
      }
      .sch-filters { grid-template-columns: 1fr; }
      .sch-planning-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); }
      .sch-plan-card { align-items:flex-start; }
      ::ng-deep .vs-calendar .fc-toolbar.fc-header-toolbar {
        grid-template-columns: 1fr;
      }
      ::ng-deep .vs-calendar .fc-toolbar-chunk,
      ::ng-deep .vs-calendar .fc-toolbar-chunk:first-child,
      ::ng-deep .vs-calendar .fc-toolbar-chunk:last-child {
        justify-self: stretch;
        display: flex;
        justify-content: center;
      }
      ::ng-deep .vs-calendar .fc-toolbar-title {
        text-align: center;
      }
    }
    @media (max-width: 560px) {
      .sch-hero-title { font-size: 34px; }
      .sch-planning-grid { grid-template-columns:1fr; }
      .sch-calendar-topline {
        align-items:flex-start;
        flex-direction:column;
      }
      .sch-page .vs-btn-ghost,
      .sch-create-btn {
        width: 100%;
        justify-content: center;
      }
    }
  `]
})
export class AdminSchedulerPage implements OnDestroy, AfterViewInit {
  orgId: string | null = null;

  users = signal<OrgUser[]>([]);
  private unsubUsers: (() => void) | null = null;

  items = signal<Shift[]>([]);
  sites: OrgSite[] = [];
  filterStatus = 'all';
  filterSite = 'all';
  filterAssigned: 'all' | 'assigned' | 'unassigned' = 'all';
  statusOptions = ['draft', 'open', 'published', 'assigned', 'claimed', 'in_progress', 'completed', 'cancelled', 'expired', 'no_show'];
  statusLegend = [
    { key: 'draft', label: 'Draft' },
    { key: 'open', label: 'Open' },
    { key: 'published', label: 'Published' },
    { key: 'assigned', label: 'Assigned/Claimed' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'completed', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled/Expired' },
  ];
  
  calendarOptions: any = {
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
    initialView: 'timeGridWeek',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay',
    },
    dayMaxEvents: true,
    nowIndicator: true,
    editable: true,
    selectable: true,
    expandRows: true,
    allDaySlot: false,
    slotMinTime: '06:00:00',
    slotMaxTime: '22:00:00',
    slotDuration: '00:30:00',
    slotLabelInterval: '01:00:00',
    slotEventOverlap: false,
    dayHeaderFormat: { weekday: 'short', month: 'short', day: 'numeric' },
    eventTimeFormat: { hour: 'numeric', minute: '2-digit', meridiem: 'short' },
    slotLabelFormat: { hour: 'numeric', minute: '2-digit', meridiem: 'short' },
    height: 'auto',
    events: [],
    eventClassNames: (arg: any) => this.eventClassNames(arg),
    eventContent: (arg: any) => this.eventContent(arg),
    eventClick: (arg: any) => this.zone.run(() => this.onEventClick(arg)),
    eventDrop: (arg: any) => this.zone.run(() => this.onEventDrop(arg)),
    select: (arg: any) => this.zone.run(() => this.onSelectRange(arg))
  };

  private unsub: (() => void) | null = null;
  publishingBatch = false;

  drawerOpen = false;
  drawerTitle = 'Create Shift';
  editingShiftId: string | null = null;
  draft: any = {
    title: 'Shift',
    locationId: '',
    locationName: 'Perry, GA',
    requiredJobRole: '',
    payRate: null,
    notes: '',
    startLocal: '',
    endLocal: '',
    assigneeUid: '',
    publishIfUnassigned: false,
    repeatWeekdays: false,
    repeatWeeks: 1,
  };
  staffSearch = '';
  staffPickForShiftId: string | null = null;

  @ViewChild('shiftActionsTpl', { static: true }) shiftActionsTpl!: TemplateRef<any>;
  @ViewChild('staffPickerTpl', { static: true }) staffPickerTpl!: TemplateRef<any>;

  constructor(
    private ctx: OrgContextService,
    private repo: ShiftsRepo,
    private cmd: SchedulerCommands,
    private adminCmd: ShiftAdminCommands,
    private usersRepo: UsersRepo,
    private modal: ModalService,
    private router: Router,
    private zone: NgZone,
    private toast: ToastService
  ) {
    const bind = () => {
      const orgId = this.ctx.orgId();
      this.orgId = orgId;
      if (!orgId) return;
      if (this.unsub) return;

      const start = Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const end = Timestamp.fromMillis(Date.now() + 14 * 24 * 60 * 60 * 1000);
      void this.loadSites(orgId);

      if (!this.unsubUsers) {
        this.unsubUsers = this.usersRepo.watchOrgUsers(orgId, (u) => this.users.set(u));
      }

      this.unsub = this.repo.watchOrgRange(orgId, start, end, (items) => {
        this.items.set(items);
        this.refreshCalendarEvents();
      });
    };

    bind();
    setTimeout(bind, 800);
    setTimeout(bind, 2200);
  }

  ngAfterViewInit() {}

  onEventClick(arg: any) {
    const shiftFromProps: Shift | null = (arg?.event?.extendedProps?.shift as Shift) || null;
    const shiftIdFromProps = String(arg?.event?.extendedProps?.shiftId || '').trim();
    const shiftIdFromEvent = String(arg?.event?.id || '').trim();
    const resolvedId = shiftIdFromProps || shiftIdFromEvent;
    const byId = resolvedId ? (this.items().find((x) => x.id === resolvedId) || null) : null;
    const s: Shift | null = byId || shiftFromProps;
    if (!s) return;
    this.modal.open('Shift Actions', this.shiftActionsTpl, { shift: s });
  }

  async publish(s: Shift, yes: boolean) {
    try {
      await this.cmd.publishShift(s.id, yes);
      this.modal.close();
      this.toast.success(yes ? 'Shift published.' : 'Shift unpublished.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Publish failed.');
    }
  }

  openStaffPicker(s: Shift) {
    this.staffPickForShiftId = s.id;
    this.staffSearch = '';
    this.modal.open('Assign Staff', this.staffPickerTpl);
  }

  filteredUsers() {
    const q = (this.staffSearch || '').toLowerCase().trim();
    if (!q) return this.users().slice(0, 200);
    return this.users().filter(u => {
      const a = (u.displayName || '').toLowerCase();
      const b = (u.email || '').toLowerCase();
      const c = (u.jobRole || '').toLowerCase();
      return a.includes(q) || b.includes(q) || c.includes(q) || u.uid.includes(q);
    }).slice(0, 200);
  }

  async pickStaff(uid: string) {
    if (!this.staffPickForShiftId) return;
    try {
      await this.cmd.assignShift(this.staffPickForShiftId, uid);
      this.modal.close();
      this.toast.success('Staff assigned successfully.');
    } catch (e: any) {
      this.toast.errorFrom(e, mapAttendancePolicyError(e, 'Assign failed.'));
    }
  }

  async unassign(s: Shift) {
    try {
      await this.cmd.unassignShift(s.id);
      this.modal.close();
      this.toast.success('Staff unassigned.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unassign failed.');
    }
  }

  async openShiftChat(shiftId: string) {
    this.modal.close();
    await this.router.navigate(['/app/shift-chat'], { queryParams: { shiftId } });
  }

  async onEventDrop(info: any) {
    const s: Shift = info?.event?.extendedProps as any;
    if (!s) return;
    const start = info?.event?.start?.getTime?.();
    const end = info?.event?.end?.getTime?.();
    if (!start || !end) return;

    try {
      await this.adminCmd.rescheduleShift(s.id, start, end);
      this.toast.success('Shift rescheduled.');
    } catch (e: any) {
      if (typeof info.revert === 'function') info.revert();
      this.toast.errorFrom(e, mapAttendancePolicyError(e, 'Reschedule failed.'));
    }
  }

  onSelectRange(sel: any) {
    const startMs = sel?.start?.getTime?.();
    const endMs = sel?.end?.getTime?.();
    if (!startMs || !endMs) return;

    const toLocalInput = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    this.drawerOpen = true;
    this.draft = {
      title: '',
      locationId: '',
      locationName: '',
      requiredJobRole: '',
      payRate: null,
      notes: '',
      startLocal: toLocalInput(new Date(startMs)),
      endLocal: toLocalInput(new Date(endMs)),
    };

    if (typeof sel?.view?.calendar?.unselect === 'function') sel.view.calendar.unselect();
  }

  openDrawerForNew() {
    this.drawerTitle = 'Create Shift';
    this.editingShiftId = null;
    this.drawerOpen = true;
    this.draft = {
      title: '',
      locationId: '',
      locationName: '',
      requiredJobRole: '',
      payRate: null,
      notes: '',
      startLocal: '',
      endLocal: '',
      assigneeUid: '',
      publishIfUnassigned: false,
      repeatWeekdays: false,
      repeatWeeks: 1,
    };
  }

  private toLocalInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  openEditDrawer(s: Shift) {
    this.modal.close();
    const start = tsToDate(s.startAt);
    const end = tsToDate(s.endAt);
    this.drawerTitle = 'Edit Shift';
    this.editingShiftId = s.id;
    this.drawerOpen = true;
    this.draft = {
      title: s.title || '',
      locationId: s.locationId || '',
      locationName: s.locationName || '',
      requiredJobRole: s.requiredJobRole || '',
      payRate: s.payRate ?? null,
      notes: s.notes || '',
      startLocal: start ? this.toLocalInput(start) : '',
      endLocal: end ? this.toLocalInput(end) : '',
      assigneeUid: s.assignedUserId || '',
      publishIfUnassigned: false,
      repeatWeekdays: false,
      repeatWeeks: 1,
    };
  }

  closeDrawer() { this.drawerOpen = false; this.editingShiftId = null; }

  async saveDrawer() {
    if (this.editingShiftId) {
      await this.updateFromDrawer(this.editingShiftId);
    } else {
      await this.createFromDrawer();
    }
  }

  async updateFromDrawer(shiftId: string) {
    try {
      const startAtMs = this.draft.startLocal ? new Date(this.draft.startLocal).getTime() : 0;
      const endAtMs = this.draft.endLocal ? new Date(this.draft.endLocal).getTime() : 0;

      if (!startAtMs || !endAtMs) {
        this.toast.error('Please provide valid Start and End times. [E_VALIDATION_TIME_RANGE]');
        return;
      }
      if (endAtMs <= startAtMs) {
        this.toast.error('End time cannot be before start time. [E_VALIDATION_TIME_ORDER]');
        return;
      }

      await this.adminCmd.updateShift(shiftId, {
        title: String(this.draft.title || 'Shift').trim(),
        locationId: String(this.draft.locationId || '').trim() || null,
        locationName: String(this.draft.locationName || '').trim(),
        startAtMs,
        endAtMs,
        requiredJobRole: (String(this.draft.requiredJobRole || '').trim() || null),
        payRate: this.draft.payRate != null ? Number(this.draft.payRate) : null,
        notes: (String(this.draft.notes || '').trim() || null),
      });

      this.closeDrawer();
      this.toast.success('Shift updated successfully.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Update shift failed.');
    }
  }

  async createFromDrawer() {
    try {
      const startAtMs = this.draft.startLocal ? new Date(this.draft.startLocal).getTime() : 0;
      const endAtMs = this.draft.endLocal ? new Date(this.draft.endLocal).getTime() : 0;

      if (!startAtMs || !endAtMs) {
        this.toast.error('Please provide valid Start and End times. [E_VALIDATION_TIME_RANGE]');
        return;
      }

      if (endAtMs <= startAtMs) {
        this.toast.error('End time cannot be before start time. [E_VALIDATION_TIME_ORDER]');
        return;
      }

      const slots = this.buildShiftSlots(
        startAtMs,
        endAtMs,
        !!this.draft.repeatWeekdays,
        Number(this.draft.repeatWeeks || 1)
      );

      const assigneeUid = String(this.draft.assigneeUid || '').trim();
      const publishIfUnassigned = !!this.draft.publishIfUnassigned;

      for (const slot of slots) {
        const created: any = await this.adminCmd.createShift({
          title: String(this.draft.title || 'Shift').trim(),
          locationId: String(this.draft.locationId || '').trim() || null,
          locationName: String(this.draft.locationName || 'Perry, GA').trim(),
          startAtMs: slot.startAtMs,
          endAtMs: slot.endAtMs,
          requiredJobRole: (String(this.draft.requiredJobRole || '').trim() || null),
          payRate: this.draft.payRate != null ? Number(this.draft.payRate) : null,
          notes: (String(this.draft.notes || '').trim() || null),
        });

        const shiftId = String(created?.shiftId || '').trim();
        if (!shiftId) continue;

        if (assigneeUid) {
          await this.cmd.assignShift(shiftId, assigneeUid);
        } else if (publishIfUnassigned) {
          await this.cmd.publishShift(shiftId, true);
        }
      }

      this.drawerOpen = false;
      this.toast.success(slots.length > 1 ? `${slots.length} shifts created successfully.` : 'Shift created successfully.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Create shift failed.');
    }
  }

  userLabel(uid: string) {
    const u = this.users().find((item) => item.uid === uid);
    if (!u) return uid;
    return u.displayName || u.email || u.uid;
  }

  applyWeekdayPreset() {
    const now = new Date();
    const nextMonday = new Date(now);
    const currentDay = nextMonday.getDay();
    const delta = currentDay === 0 ? 1 : currentDay === 1 ? 0 : 8 - currentDay;
    nextMonday.setDate(nextMonday.getDate() + delta);
    nextMonday.setHours(8, 0, 0, 0);

    const end = new Date(nextMonday);
    end.setHours(16, 0, 0, 0);

    const toLocalInput = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    this.draft.startLocal = toLocalInput(nextMonday);
    this.draft.endLocal = toLocalInput(end);
    this.draft.repeatWeekdays = true;
    this.draft.repeatWeeks = 1;
    if (!this.draft.title) this.draft.title = 'Standard Shift';
    if (!this.draft.requiredJobRole) this.draft.requiredJobRole = 'Caregiver';
  }

  private buildShiftSlots(startAtMs: number, endAtMs: number, repeatWeekdays: boolean, repeatWeeks: number) {
    if (!repeatWeekdays) return [{ startAtMs, endAtMs }];

    const durationMs = endAtMs - startAtMs;
    const safeWeeks = Math.min(12, Math.max(1, Number.isFinite(repeatWeeks) ? repeatWeeks : 1));
    const startDate = new Date(startAtMs);
    const totalDays = safeWeeks * 7;
    const slots: Array<{ startAtMs: number; endAtMs: number }> = [];

    for (let offset = 0; offset < totalDays; offset++) {
      const day = new Date(startDate);
      day.setDate(startDate.getDate() + offset);
      const dow = day.getDay();
      if (dow === 0 || dow === 6) continue;

      day.setHours(startDate.getHours(), startDate.getMinutes(), 0, 0);
      const sMs = day.getTime();
      slots.push({ startAtMs: sMs, endAtMs: sMs + durationMs });
    }

    return slots.length ? slots : [{ startAtMs, endAtMs }];
  }

  ngOnDestroy() {
    if (this.unsub) this.unsub();
    if (this.unsubUsers) this.unsubUsers();
    this.unsub = null;
    this.unsubUsers = null;
  }

  onDraftSiteChange(siteId: string) {
    this.draft.locationId = siteId;
    const site = this.sites.find((item) => item.id === siteId);
    this.draft.locationName = site?.name || '';
  }

  private async loadSites(orgId: string) {
    try {
      const snap = await getDoc(doc(getFirestore(), 'orgs', orgId));
      const rawSites = Array.isArray((snap.data() as any)?.sites) ? (snap.data() as any).sites : [];
      this.sites = rawSites.filter((site: OrgSite) => site?.active !== false && site?.id && site?.name);
      this.refreshCalendarEvents();
      if (this.sites.length === 1 && !this.draft.locationId) {
        this.draft.locationId = this.sites[0].id;
        this.draft.locationName = this.sites[0].name;
      }
    } catch {
      this.sites = [];
    }
  }

  private normalizeStatus(status: string | undefined): string {
    return String(status || '').trim().toLowerCase();
  }

  eventClassNames(arg: any): string[] {
    const shift: Shift | undefined = arg?.event?.extendedProps?.shift;
    const status = this.normalizeStatus(shift?.status);
    return ['sch-event-card', `sch-event--${status || 'draft'}`];
  }

  private initials(label: string): string {
    const parts = label.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  eventContent(arg: any) {
    const shift: Shift | undefined = arg?.event?.extendedProps?.shift;
    const statusRaw = this.normalizeStatus(shift?.status);
    const status = statusRaw ? statusRaw.replace('_', ' ') : 'draft';
    const location = this.escapeHtml(String(shift?.locationName || '').trim());
    const assigneeLabel = shift?.assignedUserId ? this.userLabel(shift.assignedUserId) : '';
    const assignee = this.escapeHtml(assigneeLabel);
    const title = this.escapeHtml(String(arg.event.title || 'Shift'));
    const timeText = this.escapeHtml(String(arg.timeText || ''));
    const safeStatus = this.escapeHtml(status);

    if (arg?.view?.type === 'dayGridMonth') {
      return {
        html: `
          <div class="sch-ev-pill">
            <span class="sch-ev-dot"></span>
            <span class="sch-ev-pill-time">${timeText}</span>
            <span class="sch-ev-pill-title">${title}</span>
          </div>
        `,
      };
    }

    const assigneeBadge = assigneeLabel
      ? `<span class="sch-ev-avatar" title="${assignee}">${this.escapeHtml(this.initials(assigneeLabel))}</span>`
      : '';

    return {
      html: `
        <div class="sch-ev-card-inner">
          <div class="sch-ev-head">
            <div class="sch-ev-title">${title}</div>
            ${assigneeBadge}
          </div>
          <div class="sch-ev-meta">${timeText}</div>
          <div class="sch-ev-chips">
            <span class="sch-ev-chip sch-ev-chip--status">${safeStatus}</span>
            ${location ? `<span class="sch-ev-chip">${location}</span>` : ''}
          </div>
        </div>
      `,
    };
  }

  refreshCalendarEvents() {
    const filtered = this.filteredItems();

    this.calendarOptions = {
      ...this.calendarOptions,
      events: filtered.map((s) => ({
        id: s.id,
        title: `${s.title}`,
        start: tsToDate(s.startAt) ?? undefined,
        end: tsToDate(s.endAt) ?? undefined,
        extendedProps: {
          shiftId: s.id,
          shift: s,
        },
      })),
    };
  }

  private filteredItems(): Shift[] {
    return this.items().filter((s) => {
      const status = this.normalizeStatus(s.status);
      if (this.filterStatus !== 'all' && status !== this.filterStatus) return false;

      if (this.filterAssigned === 'assigned' && !s.assignedUserId) return false;
      if (this.filterAssigned === 'unassigned' && !!s.assignedUserId) return false;

      if (this.filterSite !== 'all') {
        const sameSiteId = String(s.locationId || '').trim() === this.filterSite;
        const siteName = this.sites.find((x) => x.id === this.filterSite)?.name || '';
        const sameSiteName = siteName && String(s.locationName || '').trim().toLowerCase() === String(siteName).trim().toLowerCase();
        if (!sameSiteId && !sameSiteName) return false;
      }

      return true;
    });
  }

  totalVisibleShifts(): number {
    return this.filteredItems().length;
  }

  unassignedVisibleShifts(): number {
    return this.filteredItems().filter((s) => {
      const status = this.normalizeStatus(s.status);
      return !s.assignedUserId && !['cancelled', 'completed', 'expired', 'no_show'].includes(status);
    }).length;
  }

  urgentVisibleShifts(): number {
    const now = Date.now();
    const deadline = now + 24 * 60 * 60 * 1000;
    return this.filteredItems().filter((s) => {
      const start = tsToDate(s.startAt)?.getTime() || 0;
      const status = this.normalizeStatus(s.status);
      return start >= now && start <= deadline && !s.assignedUserId && ['draft', 'open', 'published'].includes(status);
    }).length;
  }

  projectedHours(): number {
    const hours = this.filteredItems().reduce((sum, s) => {
      const start = tsToDate(s.startAt)?.getTime() || 0;
      const end = tsToDate(s.endAt)?.getTime() || 0;
      if (!start || !end || end <= start) return sum;
      return sum + ((end - start) / 3_600_000);
    }, 0);
    return Math.round(hours * 10) / 10;
  }

  projectedLaborCost(): number {
    return Math.round(this.filteredItems().reduce((sum, s) => {
      const start = tsToDate(s.startAt)?.getTime() || 0;
      const end = tsToDate(s.endAt)?.getTime() || 0;
      const rate = Number(s.payRate || 0);
      if (!start || !end || end <= start || rate <= 0) return sum;
      return sum + ((end - start) / 3_600_000) * rate;
    }, 0));
  }

  moneyCurrency() {
    return this.ctx.currencyCode() || 'USD';
  }

  batchPublishCount(): number {
    return this.filteredItems().filter((s) => !s.assignedUserId && ['draft', 'open'].includes(this.normalizeStatus(s.status))).length;
  }

  async publishFilteredOpenShifts() {
    const targets = this.filteredItems().filter((s) => !s.assignedUserId && ['draft', 'open'].includes(this.normalizeStatus(s.status)));
    if (!targets.length || this.publishingBatch) return;

    this.publishingBatch = true;
    try {
      for (const shift of targets) {
        await this.cmd.publishShift(shift.id, true);
      }
      this.toast.success(targets.length === 1 ? 'Shift published.' : `${targets.length} shifts published.`);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Batch publish failed.');
    } finally {
      this.publishingBatch = false;
    }
  }

  printScheduler() {
    window.print();
  }

  exportSchedulerCsv() {
    const rows = this.filteredItems().map((s) => {
      const start = tsToDate(s.startAt);
      const end = tsToDate(s.endAt);
      return {
        id: s.id,
        title: s.title || 'Shift',
        status: s.status || '',
        site: s.locationName || '',
        assignedUserId: s.assignedUserId || '',
        requiredJobRole: s.requiredJobRole || '',
        startAt: start ? start.toISOString() : '',
        endAt: end ? end.toISOString() : '',
      };
    });

    const header = ['id', 'title', 'status', 'site', 'assignedUserId', 'requiredJobRole', 'startAt', 'endAt'];
    const csv = [
      header.join(','),
      ...rows.map((r) => header.map((k) => this.csvCell((r as any)[k])).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scheduler-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private csvCell(value: string): string {
    const text = String(value || '');
    return `"${text.replace(/"/g, '""')}"`;
  }

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
