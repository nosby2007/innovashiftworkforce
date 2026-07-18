import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { doc, getDoc, getFirestore, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { UsersRepo, OrgUser } from '../../core/repos/users.repo';
import { ShiftsRepo } from '../../core/repos/shifts.repo';
import { TimeEntriesRepo } from '../../core/repos/time-entries.repo';
import { AccrualBalance, AccrualsRepo, TimeOffRequest } from '../../core/repos/accruals.repo';
import { AdminCommands } from '../../core/commands/admin.commands';
import { SchedulerCommands } from '../../core/commands/scheduler.commands';
import { ToastService } from '../../core/ui/toast.service';
import { EmployeeDocumentRecord, EmployeeDocumentsRepo } from '../../core/repos/employee-documents.repo';
import { Shift } from '../../shared/models/shift.model';
import { TimeEntry } from '../../shared/models/time-entry.model';
import { tsToDate, formatDateTime } from '../../shared/utils/date.util';
import { TableListController } from '../../shared/ui/table-list/table-list.controller';
import { TablePaginatorComponent } from '../../shared/ui/table-list/table-paginator.component';
import { BenefitLine } from '../../shared/utils/payroll.util';

interface TsRow {
  entry: TimeEntry;
  shiftTitle: string;
  checkIn: string;
  checkOut: string;
  hours: string;
}

type EmployeeProfileDraft = {
  displayName: string;
  email: string;
  phone: string;
  title: string;
  department: string;
  employeeNumber: string;
  locationName: string;
  hireDate: string;
  accessRole: string;
  jobRole: string;
  active: boolean;
  payRate: number;
  payType: string;
  managerName: string;
  managerEmail: string;
  w4FilingStatus: string;
  w4MultipleJobs: boolean;
  w4DependentAmount: number;
  w4ExtraWithholding: number;
  w2Delivery: string;
  w2ElectronicConsent: boolean;
  federalTaxPercent: number | null;
  stateTaxPercent: number | null;
  socialSecurityPercent: number | null;
  medicarePercent: number | null;
  retirement401kPercent: number;
  retirement401kMatchPercent: number | null;
  benefits: BenefitLine[];
};

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DatePipe, MatIconModule, TablePaginatorComponent],
  template: `
    <div class="vs-page-pad empd-page">

      <!-- Header -->
      <div class="vs-page-header no-print">
        <div class="vs-page-title">
          <h1 class="vs-title">Employee Details</h1>
          <p class="vs-page-subtitle" *ngIf="user() as u">{{ u.displayName || u.email || 'Employee record' }}</p>
        </div>
        <div class="vs-page-actions">
          <button class="vs-btn-ghost empd-back-btn" (click)="printPage()">
            <mat-icon>print</mat-icon> Print
          </button>
          <a routerLink="/admin/employees" class="vs-btn-ghost empd-back">
            <mat-icon>arrow_back</mat-icon> Back
          </a>
        </div>
      </div>

      <div *ngIf="!orgId || !userId" class="vs-glass empd-empty">
        <mat-icon>warning_amber</mat-icon>
        <div>Missing employee context.</div>
      </div>

      <ng-container *ngIf="orgId && userId">

        <!-- Row 1: Summary + Message -->
        <div class="vs-grid-2 empd-grid no-print">

          <section class="vs-glass-strong empd-panel">
            <div class="vs-panel-head">
              <div>
                <div class="vs-panel-title">Employee Summary</div>
                <div class="vs-panel-subtitle">Role, identity, quick admin actions</div>
              </div>
            </div>
            <div class="vs-panel-body" *ngIf="user() as u; else loadingUser">
              <div class="empd-summary">
                <div class="empd-avatar">{{ initials(u) }}</div>
                <div>
                  <div class="empd-name">{{ u.displayName || 'Unnamed employee' }}</div>
                  <div class="empd-meta">{{ u.email || 'Email not set' }}</div>
                </div>
              </div>
              <div class="empd-facts">
                <div class="empd-fact"><span>Access Role</span><strong>{{ u.accessRole || 'staff' }}</strong></div>
                <div class="empd-fact"><span>Job Role</span><strong>{{ u.jobRole || '—' }}</strong></div>
                <div class="empd-fact"><span>Status</span><strong>{{ u.active === false ? 'Inactive' : 'Active' }}</strong></div>
                <div class="empd-fact"><span>Assigned Shifts</span><strong>{{ shifts().length }}</strong></div>
              </div>
            </div>
            <ng-template #loadingUser>
              <div class="vs-panel-body">Loading employee…</div>
            </ng-template>
          </section>

          <section class="vs-glass-strong empd-panel">
            <div class="vs-panel-head">
              <div>
                <div class="vs-panel-title">Send Message</div>
                <div class="vs-panel-subtitle">In-app message directly to this employee</div>
              </div>
            </div>
            <div class="vs-panel-body">
              <div class="vs-form-row">
                <div>
                  <label class="vs-field-label">Title</label>
                  <input class="vs-input" [(ngModel)]="messageTitle" placeholder="Schedule update">
                </div>
              </div>
              <div class="vs-form-row">
                <div>
                  <label class="vs-field-label">Message</label>
                  <textarea class="vs-input empd-textarea" [(ngModel)]="messageBody" placeholder="Employee-specific instruction or update"></textarea>
                </div>
              </div>
              <div class="empd-actions">
                <button class="vs-btn-primary" (click)="sendMessageToEmployee()" [disabled]="messageBusy || !messageTitle.trim() || !messageBody.trim()">
                  <mat-icon>send</mat-icon>
                  {{ messageBusy ? 'Sending...' : 'Send Message' }}
                </button>
              </div>
            </div>
          </section>
        </div>

        <section class="vs-glass-strong empd-panel empd-section no-print" *ngIf="user()">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Admin Action Center</div>
              <div class="vs-panel-subtitle">Profile management, payroll details, tax forms, dependents, and time-off history</div>
            </div>
            <div class="empd-admin-actions">
              <button class="vs-btn-ghost empd-btn" type="button" (click)="toggleEmployeeActive()">
                <mat-icon>{{ profileDraft.active ? 'person_off' : 'person' }}</mat-icon>
                {{ profileDraft.active ? 'Deactivate' : 'Activate' }}
              </button>
              <button class="vs-btn-ghost empd-btn" type="button" *ngIf="isAdminOrHr()" (click)="openEmployeePto()">
                <mat-icon>event_available</mat-icon> PTO Center
              </button>
              <button class="vs-btn-ghost empd-btn" type="button" *ngIf="isAdminOrHr()" (click)="openEmployeePayslip()">
                <mat-icon>picture_as_pdf</mat-icon> Payslip
              </button>
              <button class="vs-btn-primary empd-btn" type="button" (click)="saveEmployeeProfile()" [disabled]="profileSaving">
                <mat-icon>{{ profileSaving ? 'hourglass_empty' : 'save' }}</mat-icon>
                {{ profileSaving ? 'Saving...' : 'Save Employee' }}
              </button>
            </div>
          </div>

          <div class="empd-admin-grid">
            <article class="empd-admin-card">
              <h3><mat-icon>badge</mat-icon> Profile Management</h3>
              <div class="empd-mini-grid">
                <label><span>Full name</span><input class="vs-input" [(ngModel)]="profileDraft.displayName"></label>
                <label><span>Email</span><input class="vs-input" [(ngModel)]="profileDraft.email"></label>
                <label><span>Phone</span><input class="vs-input" [(ngModel)]="profileDraft.phone"></label>
                <label><span>Employee #</span><input class="vs-input" [(ngModel)]="profileDraft.employeeNumber"></label>
                <label><span>Title</span><input class="vs-input" [(ngModel)]="profileDraft.title"></label>
                <label><span>Department</span><input class="vs-input" [(ngModel)]="profileDraft.department"></label>
                <label><span>Location</span><input class="vs-input" [(ngModel)]="profileDraft.locationName"></label>
                <label><span>Manager</span><input class="vs-input" [(ngModel)]="profileDraft.managerName"></label>
                <label><span>Hire date</span><input class="vs-input" type="date" [(ngModel)]="profileDraft.hireDate"></label>
              </div>
            </article>

            <article class="empd-admin-card" *ngIf="isAdminOrHr()">
              <h3><mat-icon>payments</mat-icon> Payroll Details</h3>
              <div class="empd-mini-grid">
                <label>
                  <span>Access role</span>
                  <select class="vs-select" [(ngModel)]="profileDraft.accessRole">
                    <option value="staff">Staff</option>
                    <option value="manager">Manager</option>
                    <option value="scheduler">Scheduler</option>
                    <option value="hr">HR</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <label><span>Job role</span><input class="vs-input" [(ngModel)]="profileDraft.jobRole"></label>
                <label>
                  <span>Pay type</span>
                  <select class="vs-select" [(ngModel)]="profileDraft.payType">
                    <option value="hourly">Hourly</option>
                    <option value="salary">Salary</option>
                    <option value="contract">Contract</option>
                  </select>
                </label>
                <label><span>Pay rate</span><input class="vs-input" type="number" [(ngModel)]="profileDraft.payRate"></label>
              </div>
              <div class="empd-payroll-facts">
                <div><span>Timesheet hours</span><strong>{{ totalHours() }}</strong></div>
                <ng-container *ngIf="isAdminOrHr()">
                  <div><span>PTO balance</span><strong>{{ accrualBalance().ptoBalance.toFixed(2) }}</strong></div>
                  <div><span>Sick balance</span><strong>{{ accrualBalance().sickBalance.toFixed(2) }}</strong></div>
                </ng-container>
              </div>
            </article>

            <article class="empd-admin-card" *ngIf="isAdminOrHr()">
              <h3><mat-icon>receipt_long</mat-icon> W-4 / W-2 / Dependents</h3>
              <div class="empd-mini-grid">
                <label>
                  <span>W-4 filing status</span>
                  <select class="vs-select" [(ngModel)]="profileDraft.w4FilingStatus">
                    <option value="single">Single</option>
                    <option value="married">Married filing jointly</option>
                    <option value="head_of_household">Head of household</option>
                    <option value="non_us">Non-US / manual</option>
                  </select>
                </label>
                <label><span>Dependent amount</span><input class="vs-input" type="number" [(ngModel)]="profileDraft.w4DependentAmount"></label>
                <label><span>Extra withholding</span><input class="vs-input" type="number" [(ngModel)]="profileDraft.w4ExtraWithholding"></label>
                <label>
                  <span>W-2 delivery</span>
                  <select class="vs-select" [(ngModel)]="profileDraft.w2Delivery">
                    <option value="electronic">Electronic</option>
                    <option value="mail">Mail</option>
                    <option value="both">Both</option>
                  </select>
                </label>
              </div>
              <label class="empd-check"><input type="checkbox" [(ngModel)]="profileDraft.w4MultipleJobs"> Multiple jobs or spouse works</label>
              <label class="empd-check"><input type="checkbox" [(ngModel)]="profileDraft.w2ElectronicConsent"> Electronic W-2 consent</label>
              <label class="empd-text-lines">
                <span>Dependents, one per line: name, relationship, birth year</span>
                <textarea class="vs-input" rows="4" [(ngModel)]="dependentsText" placeholder="Jane Doe, Child, 2018"></textarea>
              </label>
            </article>

            <article class="empd-admin-card" *ngIf="isAdminOrHr()">
              <h3><mat-icon>account_balance_wallet</mat-icon> Payroll Deductions & Benefits</h3>
              <div class="vs-muted" style="margin-bottom:10px;font-size:12px;">Leave a tax field blank to use the organization's default rate. These apply to this employee's payroll and payslip.</div>
              <div class="empd-mini-grid">
                <label><span>Federal Tax % (org default {{ orgDeductionDefaults.federalTaxPercent }})</span><input class="vs-input" type="number" min="0" step="0.1" [(ngModel)]="profileDraft.federalTaxPercent" placeholder="default"></label>
                <label><span>State Tax % (org default {{ orgDeductionDefaults.stateTaxPercent }})</span><input class="vs-input" type="number" min="0" step="0.1" [(ngModel)]="profileDraft.stateTaxPercent" placeholder="default"></label>
                <label><span>Social Security % (org default {{ orgDeductionDefaults.socialSecurityPercent }})</span><input class="vs-input" type="number" min="0" step="0.01" [(ngModel)]="profileDraft.socialSecurityPercent" placeholder="default"></label>
                <label><span>Medicare % (org default {{ orgDeductionDefaults.medicarePercent }})</span><input class="vs-input" type="number" min="0" step="0.01" [(ngModel)]="profileDraft.medicarePercent" placeholder="default"></label>
                <label><span>401(k) Employee %</span><input class="vs-input" type="number" min="0" step="0.1" [(ngModel)]="profileDraft.retirement401kPercent"></label>
                <label><span>401(k) Employer Match % (org default {{ orgDeductionDefaults.retirement401kMatchPercent }})</span><input class="vs-input" type="number" min="0" step="0.1" [(ngModel)]="profileDraft.retirement401kMatchPercent" placeholder="default"></label>
              </div>

              <div class="empd-benefit-head">
                <strong>Benefits</strong>
                <div class="empd-benefit-add" *ngIf="orgBenefitPlans().length > 0">
                  <select class="vs-select" [(ngModel)]="selectedBenefitPlanId">
                    <option value="">Add from plan…</option>
                    <option *ngFor="let plan of orgBenefitPlans()" [value]="plan.id">{{ plan.label }}</option>
                  </select>
                  <button class="vs-btn-ghost" type="button" [disabled]="!selectedBenefitPlanId" (click)="addBenefitFromPlan()">
                    <mat-icon>add</mat-icon> Add
                  </button>
                </div>
                <button class="vs-btn-ghost" type="button" (click)="addCustomBenefit()">
                  <mat-icon>add_circle_outline</mat-icon> Custom Benefit
                </button>
              </div>

              <div class="empd-benefit-empty" *ngIf="profileDraft.benefits.length === 0">No benefits attached to this employee.</div>

              <div class="empd-benefit-row" *ngFor="let b of profileDraft.benefits; index as i">
                <input class="vs-input" [(ngModel)]="b.label" placeholder="Benefit name">
                <input class="vs-input" type="number" min="0" step="0.01" [(ngModel)]="b.employeeAmount" placeholder="Employee $/paycheck">
                <input class="vs-input" type="number" min="0" step="0.01" [(ngModel)]="b.employerAmount" placeholder="Employer $/paycheck">
                <button class="vs-btn-ghost" type="button" (click)="removeEmployeeBenefit(i)">
                  <mat-icon>delete</mat-icon>
                </button>
              </div>
            </article>

            <article class="empd-admin-card" *ngIf="isAdminOrHr()">
              <h3><mat-icon>beach_access</mat-icon> Time-Off Requests</h3>
              <div class="empd-pto-list" *ngIf="timeOffRequests().length > 0; else noTimeOff">
                <div class="empd-pto-row" *ngFor="let req of timeOffRequests() | slice:0:6">
                  <div>
                    <strong>{{ req.requestType | uppercase }} · {{ req.hours }}h</strong>
                    <span>{{ req.startDate }} to {{ req.endDate }}</span>
                  </div>
                  <span class="vs-badge"
                        [class.vs-badge--warning]="req.status === 'pending'"
                        [class.vs-badge--success]="req.status === 'approved'"
                        [class.vs-badge--danger]="req.status === 'rejected'"
                        [class.vs-badge--neutral]="!['pending','approved','rejected'].includes(req.status)">
                    {{ req.status }}
                  </span>
                </div>
              </div>
              <ng-template #noTimeOff>
                <div class="empd-pto-empty">No time-off requests for this employee.</div>
              </ng-template>
            </article>

            <article class="empd-admin-card empd-doc-card" *ngIf="isAdminOrHr()">
              <h3><mat-icon>verified_user</mat-icon> Document Verification</h3>
              <div class="empd-doc-list" *ngIf="employeeDocuments().length > 0; else noEmployeeDocs">
                <div class="empd-doc-row" *ngFor="let item of employeeDocuments()">
                  <div class="empd-doc-main">
                    <strong>{{ item.title || docLabel(item.type) }}</strong>
                    <span>{{ docLabel(item.type) }} · {{ item.fileName }}</span>
                    <small *ngIf="item.reviewNote">{{ item.reviewNote }}</small>
                  </div>
                  <span class="vs-badge"
                        [class.vs-badge--warning]="item.status === 'pending'"
                        [class.vs-badge--success]="item.status === 'verified'"
                        [class.vs-badge--danger]="item.status === 'rejected'">
                    {{ docStatus(item.status) }}
                  </span>
                  <div class="empd-doc-actions">
                    <button type="button" class="vs-btn-ghost empd-btn" (click)="openEmployeeDocument(item)">
                      <mat-icon>open_in_new</mat-icon> Open
                    </button>
                    <button type="button" class="vs-btn-ghost empd-btn" (click)="reviewEmployeeDocument(item, 'rejected')" [disabled]="documentReviewBusy">
                      <mat-icon>close</mat-icon> Reject
                    </button>
                    <button type="button" class="vs-btn-primary empd-btn" (click)="reviewEmployeeDocument(item, 'verified')" [disabled]="documentReviewBusy">
                      <mat-icon>check</mat-icon> Verify
                    </button>
                  </div>
                </div>
              </div>
              <ng-template #noEmployeeDocs>
                <div class="empd-pto-empty">No documents submitted by this employee.</div>
              </ng-template>
            </article>
          </div>
        </section>

        <!-- Assigned Shifts -->
        <section class="vs-glass-strong empd-panel empd-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Assigned Shifts</div>
              <div class="vs-panel-subtitle">Manage this employee's shifts directly</div>
            </div>
          </div>
          <div class="vs-table-shell empd-table-shell">
            <table class="vs-table empd-table">
              <thead>
                <tr>
                  <th class="empd-th-sort" (click)="shiftsCtrl.toggleSort('title')">Title {{ shiftsCtrl.sortIndicator('title') }}</th>
                  <th class="empd-th-sort" (click)="shiftsCtrl.toggleSort('start')">Date {{ shiftsCtrl.sortIndicator('start') }}</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th class="empd-right no-print">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngIf="shiftsCtrl.pageRows().length === 0" class="vs-empty">
                  <td colspan="6">No shifts found for this employee.</td>
                </tr>
                <tr *ngFor="let shift of shiftsCtrl.pageRows()" class="vs-row">
                  <td><strong>{{ shift.title }}</strong></td>
                  <td>{{ toDate(shift.startAt) | date:'EEE MMM d, y' }}</td>
                  <td class="empd-mono">{{ toDate(shift.startAt) | date:'shortTime' }} – {{ toDate(shift.endAt) | date:'shortTime' }}</td>
                  <td><span class="vs-badge vs-badge--neutral">{{ shift.status }}</span></td>
                  <td>{{ shift.locationName || '—' }}</td>
                  <td class="empd-right no-print">
                    <div class="empd-row-actions">
                      <button class="vs-btn-ghost empd-btn" (click)="openShiftChat(shift.id)">
                        <mat-icon>chat</mat-icon> Chat
                      </button>
                      <button class="vs-btn-ghost empd-btn" (click)="unassignShift(shift)">
                        <mat-icon>person_remove</mat-icon> Unassign
                      </button>
                      <button class="vs-btn-ghost empd-btn empd-btn--danger" (click)="deleteShift(shift)">
                        <mat-icon>delete</mat-icon> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <app-table-paginator *ngIf="shifts().length > 0" [controller]="shiftsCtrl"></app-table-paginator>
        </section>

        <!-- ── Individual Timesheet ── -->
        <section class="vs-glass-strong empd-panel empd-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Individual Timesheet</div>
              <div class="vs-panel-subtitle">Time entries · corrections · print</div>
            </div>
            <div class="empd-ts-header-actions no-print">
              <button class="vs-btn-ghost empd-btn" (click)="printTimesheet()">
                <mat-icon>print</mat-icon> Print Timesheet
              </button>
            </div>
          </div>

          <!-- Timesheet filters -->
          <div class="empd-ts-filters no-print">
            <div class="vs-form-row empd-ts-filters-row">
              <div>
                <label class="vs-field-label">From</label>
                <input type="date" class="vs-input" [(ngModel)]="tsFrom" (ngModelChange)="rebindTimesheet()">
              </div>
              <div>
                <label class="vs-field-label">To</label>
                <input type="date" class="vs-input" [(ngModel)]="tsTo" (ngModelChange)="rebindTimesheet()">
              </div>
              <div class="empd-ts-summary-col" *ngIf="tsRows().length > 0">
                <div class="empd-ts-kpi">
                  <span>Total Hours</span><strong>{{ totalHours() }}</strong>
                </div>
                <div class="empd-ts-kpi empd-ts-kpi--warn" *ngIf="pendingCount() > 0">
                  <span>Pending Fix</span><strong>{{ pendingCount() }}</strong>
                </div>
              </div>
            </div>
          </div>

          <!-- Timesheet correction panel -->
          <div class="empd-fix-panel no-print" *ngIf="fixEntryId">
            <div class="empd-fix-title">
              <mat-icon>edit_calendar</mat-icon>
              Apply Correction
              <span class="empd-fix-entry">Selected correction</span>
            </div>
            <div class="vs-form-row empd-fix-form">
              <div>
                <label class="vs-field-label">Corrected Check-In</label>
                <input type="datetime-local" class="vs-input" [(ngModel)]="fixCheckIn">
              </div>
              <div>
                <label class="vs-field-label">Corrected Check-Out</label>
                <input type="datetime-local" class="vs-input" [(ngModel)]="fixCheckOut">
              </div>
            </div>
            <div class="empd-fix-actions">
              <button class="vs-btn-ghost" (click)="cancelFix()" [disabled]="fixBusy">Cancel</button>
              <button class="vs-btn-ghost" (click)="rejectFix()" [disabled]="fixBusy">Reject Request</button>
              <button class="vs-btn-primary" (click)="applyFix()" [disabled]="fixBusy">
                <mat-icon>check</mat-icon> {{ fixBusy ? 'Applying…' : 'Apply Fix' }}
              </button>
            </div>
          </div>

          <!-- Timesheet table -->
          <div class="vs-table-shell empd-table-shell empd-ts-table-shell">
            <table class="vs-table empd-ts-table">
              <thead>
                <tr>
                  <th>Shift</th>
                  <th class="empd-th-sort" (click)="tsRowsCtrl.toggleSort('checkIn')">Check In {{ tsRowsCtrl.sortIndicator('checkIn') }}</th>
                  <th class="empd-th-sort" (click)="tsRowsCtrl.toggleSort('checkOut')">Check Out {{ tsRowsCtrl.sortIndicator('checkOut') }}</th>
                  <th class="empd-th-sort" (click)="tsRowsCtrl.toggleSort('hours')">Hours {{ tsRowsCtrl.sortIndicator('hours') }}</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Resolved At</th>
                  <th class="empd-right no-print">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr class="vs-empty" *ngIf="tsRowsCtrl.pageRows().length === 0">
                  <td colspan="8">No time entries in this range. Select a date range above.</td>
                </tr>
                <tr *ngFor="let r of tsRowsCtrl.pageRows()" class="vs-row"
                    [class.empd-row--pending]="r.entry.exceptionStatus === 'pending'"
                    [class.empd-row--approved]="r.entry.exceptionStatus === 'approved'"
                    [class.empd-row--rejected]="r.entry.exceptionStatus === 'rejected'">
                  <td><strong>{{ r.shiftTitle }}</strong></td>
                  <td class="empd-mono">{{ r.checkIn }}</td>
                  <td class="empd-mono">{{ r.checkOut }}</td>
                  <td><strong>{{ r.hours }}</strong></td>
                  <td>
                    <span class="vs-badge"
                          [class.vs-badge--success]="r.entry.exceptionStatus === 'none'"
                          [class.vs-badge--warning]="r.entry.exceptionStatus === 'pending'"
                          [class.vs-badge--neutral]="r.entry.exceptionStatus === 'approved'"
                          [class.vs-badge--danger]="r.entry.exceptionStatus === 'rejected'">
                      {{ r.entry.exceptionStatus | titlecase }}
                    </span>
                  </td>
                  <td class="empd-reason">{{ r.entry.correctionReason || '—' }}</td>
                  <td>{{ fmt(r.entry.correctionLastDecision?.decidedAt || r.entry.approvedAt) }}</td>
                  <td class="empd-right no-print">
                    <button class="vs-btn-ghost empd-btn" (click)="startFix(r.entry)" [disabled]="fixBusy">
                      <mat-icon>edit</mat-icon> Fix
                    </button>
                  </td>
                </tr>
              </tbody>
              <tfoot *ngIf="tsRows().length > 0" class="empd-ts-foot">
                <tr>
                  <td><strong>Total</strong></td>
                  <td colspan="2"></td>
                  <td><strong>{{ totalHours() }} hrs</strong></td>
                  <td colspan="3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <app-table-paginator *ngIf="tsRows().length > 0" [controller]="tsRowsCtrl"></app-table-paginator>
        </section>

      </ng-container>
    </div>
  `,
  styles: [`
    .empd-page { width: 100%; }
    .empd-back { display:inline-flex; align-items:center; gap:6px; text-decoration:none; }
    .empd-back-btn { display:inline-flex; align-items:center; gap:6px; }
    .empd-grid { margin-bottom: 20px; }
    .empd-section { margin-bottom: 20px; }
    .empd-panel { border:1px solid var(--border); box-shadow: inset 0 1px 0 rgba(255,255,255,0.05); }
    .empd-empty { display:flex; gap:12px; align-items:center; padding:20px; }
    .empd-summary { display:flex; gap:14px; align-items:center; margin-bottom:18px; }
    .empd-avatar {
      width:52px; height:52px; border-radius:16px; display:flex; align-items:center; justify-content:center;
      background: linear-gradient(135deg, var(--primary), var(--accent)); color:#fff; font-weight:900; font-size:18px;
    }
    .empd-name { font-size:18px; font-weight:900; color:var(--text); }
    .empd-meta { font-size:13px; color:var(--text-muted); }
    .empd-facts { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px; }
    .empd-fact { padding:12px 14px; border:1px solid var(--border); border-radius:14px; background:var(--panel); }
    .empd-fact span { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--text-subtle); margin-bottom:6px; }
    .empd-fact strong { color:var(--text); font-size:14px; }
    .empd-textarea { min-height:110px; resize:vertical; }
    .empd-actions { display:flex; justify-content:flex-end; }
    .empd-admin-actions { display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
    .empd-admin-grid { padding:18px 20px; display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:16px; }
    .empd-admin-card { border:1px solid var(--border); border-radius:14px; background:var(--panel); padding:16px; display:flex; flex-direction:column; gap:12px; }
    .empd-admin-card h3 { margin:0; display:flex; align-items:center; gap:8px; color:var(--text); font-size:15px; }
    .empd-admin-card h3 mat-icon { color:var(--primary); font-size:18px !important; width:18px; height:18px; }
    .empd-mini-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px; }
    .empd-mini-grid label span, .empd-text-lines span { display:block; margin-bottom:6px; color:var(--text-muted); font-size:12px; font-weight:800; }
    .empd-payroll-facts { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; }
    .empd-payroll-facts div { border:1px solid var(--border); border-radius:12px; padding:10px; background:rgba(255,255,255,0.03); }
    .empd-payroll-facts span { display:block; color:var(--text-subtle); font-size:11px; font-weight:800; text-transform:uppercase; margin-bottom:4px; }
    .empd-payroll-facts strong { color:var(--text); }
    .empd-check { display:flex; align-items:center; gap:8px; color:var(--text-muted); font-size:13px; }
    .empd-benefit-head { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin:16px 0 10px; }
    .empd-benefit-add { display:flex; gap:8px; align-items:center; }
    .empd-benefit-add .vs-select { min-width:160px; }
    .empd-benefit-empty { border:1px dashed var(--border); border-radius:12px; padding:14px; color:var(--text-muted); font-size:13px; }
    .empd-benefit-row { display:grid; grid-template-columns:2fr 1fr 1fr auto; gap:8px; align-items:center; margin-bottom:8px; }
    .empd-text-lines textarea { min-height:96px; resize:vertical; }
    .empd-pto-list { display:grid; gap:8px; }
    .empd-pto-row { display:flex; align-items:center; justify-content:space-between; gap:10px; border:1px solid var(--border); border-radius:12px; padding:10px; background:rgba(255,255,255,0.03); }
    .empd-pto-row strong { display:block; color:var(--text); }
    .empd-pto-row span:not(.vs-badge) { display:block; color:var(--text-muted); font-size:12px; margin-top:3px; }
    .empd-pto-empty { border:1px dashed var(--border); border-radius:12px; padding:14px; color:var(--text-muted); }
    .empd-doc-card { grid-column:1 / -1; }
    .empd-doc-list { display:grid; gap:10px; }
    .empd-doc-row { display:grid; grid-template-columns:1fr auto auto; gap:12px; align-items:center; border:1px solid var(--border); border-radius:12px; padding:12px; background:rgba(255,255,255,0.03); }
    .empd-doc-main strong, .empd-doc-main span, .empd-doc-main small { display:block; }
    .empd-doc-main strong { color:var(--text); }
    .empd-doc-main span { color:var(--text-muted); font-size:12px; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .empd-doc-main small { color:var(--warning); font-weight:800; margin-top:5px; }
    .empd-doc-actions { display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }

    .empd-table-shell { border:1px solid var(--border); border-radius:var(--radius); background:linear-gradient(180deg, rgba(15,23,42,0.54), rgba(2,6,23,0.34)); overflow:auto; }
    .empd-table { width:100%; min-width:860px; }
    .empd-table th { background: rgba(15,23,42,0.44); }
    .empd-table tbody tr:nth-child(even):not(.vs-empty) td { background: rgba(148,163,184,0.05); }
    .empd-right { text-align:right; white-space:nowrap; }
    .empd-th-sort { cursor:pointer; user-select:none; }
    .empd-th-sort:hover { color: var(--primary, #07533f); }
    .empd-row-actions { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }
    .empd-btn { display:inline-flex; align-items:center; gap:6px; padding:6px 10px !important; font-size:12px !important; }
    .empd-btn--danger { color:#fecaca !important; border-color:rgba(239,68,68,0.35) !important; }
    .empd-mono { font-family:monospace; font-size:12px; }

    /* Timesheet section */
    .empd-ts-header-actions { display:flex; gap:8px; }
    .empd-ts-filters { padding: 16px 20px 0; }
    .empd-ts-filters-row { display:grid; grid-template-columns: 1fr 1fr auto; gap:14px; align-items:flex-end; }
    @media (max-width: 700px) { .empd-ts-filters-row { grid-template-columns: 1fr; } }
    .empd-ts-summary-col { display:flex; gap:12px; align-items:center; padding-bottom:2px; }
    .empd-ts-kpi { padding:8px 14px; border:1px solid var(--border); border-radius:var(--radius-md); font-size:13px; }
    .empd-ts-kpi span { display:block; font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:var(--text-subtle); margin-bottom:2px; }
    .empd-ts-kpi strong { color:var(--text); font-size:16px; font-weight:900; }
    .empd-ts-kpi--warn { border-color:rgba(250,204,21,0.4); }
    .empd-ts-kpi--warn strong { color:#fde68a; }

    .empd-fix-panel {
      margin:16px 20px; padding:16px;
      border:1px solid rgba(96,165,250,0.35); border-radius:var(--radius-md);
      background:rgba(96,165,250,0.08);
    }
    .empd-fix-title { display:flex; align-items:center; gap:8px; font-weight:700; color:var(--text-muted); font-size:13px; margin-bottom:14px; }
    .empd-fix-title mat-icon { font-size:16px !important; width:16px; height:16px; color:#60a5fa; }
    .empd-fix-entry { font-family:monospace; font-size:11px; color:var(--text-subtle); margin-left:4px; }
    .empd-fix-form { display:grid; grid-template-columns: 1fr 1fr; gap:14px; }
    @media (max-width: 600px) { .empd-fix-form { grid-template-columns: 1fr; } }
    .empd-fix-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:10px; }

    .empd-ts-table-shell { border:none; border-top:1px solid var(--border); }
    .empd-ts-table { width:100%; min-width:860px; }
    .empd-ts-table th { background: rgba(15,23,42,0.44); }
    .empd-ts-table tbody tr:nth-child(even):not(.vs-empty) td { background: rgba(148,163,184,0.05); }
    .empd-ts-foot td { border-top:2px solid var(--border); padding:10px 14px; font-size:13px; }
    .empd-reason { font-size:12px; color:var(--text-muted); max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

    .empd-row--pending td { background: rgba(250,204,21,0.05) !important; }
    .empd-row--approved td { background: rgba(34,197,94,0.05) !important; }
    .empd-row--rejected td { background: rgba(239,68,68,0.05) !important; }

    @media (max-width: 900px) { .empd-facts, .empd-admin-grid, .empd-mini-grid, .empd-payroll-facts, .empd-doc-row { grid-template-columns: 1fr; } .empd-doc-actions { justify-content:flex-start; } }

    /* Print */
    @media print {
      .no-print { display: none !important; }
      .empd-table-shell, .empd-ts-table-shell { background: transparent !important; border: 1px solid #ccc !important; overflow: visible !important; }
      .empd-table, .empd-ts-table { min-width: auto !important; color: #000 !important; }
      .empd-table th, .empd-table td,
      .empd-ts-table th, .empd-ts-table td { color:#000 !important; background:transparent !important; border-color:#ccc !important; }
      .vs-badge { background:transparent !important; color:#000 !important; border:1px solid #999 !important; }
      .vs-glass-strong { background: transparent !important; box-shadow: none !important; border: 1px solid #ccc !important; }
      .vs-panel-head { padding: 8px 14px !important; }
    }
  `],
})
export class AdminEmployeeDetailsPage implements OnDestroy {
  orgId: string | null = null;
  userId = '';
  user = signal<OrgUser | null>(null);
  shifts = signal<Shift[]>([]);
  shiftsCtrl = new TableListController<Shift>(this.shifts, {
    pageSize: 10,
    sortAccessor: (s, key) => {
      if (key === 'title') return String(s.title || '').toLowerCase();
      if (key === 'start') return s.startAt?.toMillis ? s.startAt.toMillis() : Number(s.startAt || 0);
      return null;
    },
  });
  messageTitle = '';
  messageBody = '';
  messageBusy = false;
  profileSaving = false;
  profileDraft: EmployeeProfileDraft = this.emptyProfileDraft();
  dependentsText = '';
  orgBenefitPlans = signal<BenefitLine[]>([]);
  orgDeductionDefaults = { federalTaxPercent: 10, stateTaxPercent: 4, socialSecurityPercent: 6.2, medicarePercent: 1.45, retirement401kMatchPercent: 0 };
  selectedBenefitPlanId = '';
  timeOffRequests = signal<TimeOffRequest[]>([]);
  employeeDocuments = signal<EmployeeDocumentRecord[]>([]);
  documentReviewBusy = false;
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

  // Timesheet
  tsFrom = '';
  tsTo = '';
  tsRows = signal<TsRow[]>([]);
  tsRowsCtrl = new TableListController<TsRow>(this.tsRows, {
    pageSize: 15,
    sortAccessor: (r, key) => {
      if (key === 'checkIn') return tsToDate(r.entry.checkInAt)?.getTime() ?? 0;
      if (key === 'checkOut') return tsToDate(r.entry.checkOutAt)?.getTime() ?? 0;
      if (key === 'hours') return parseFloat(r.hours) || 0;
      return null;
    },
  });
  shiftMap: Record<string, Shift> = {};
  fixEntryId: string | null = null;
  fixCheckIn = '';
  fixCheckOut = '';
  fixBusy = false;

  private unsubUsers: (() => void) | null = null;
  private unsubShifts: (() => void) | null = null;
  private unsubEntries: (() => void) | null = null;
  private unsubTimeOff: (() => void) | null = null;
  private unsubAccrual: (() => void) | null = null;
  private unsubDocs: (() => void) | null = null;
  private routeSub: any;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private ctx: OrgContextService,
    private usersRepo: UsersRepo,
    private shiftsRepo: ShiftsRepo,
    private timeRepo: TimeEntriesRepo,
    private accruals: AccrualsRepo,
    private docsRepo: EmployeeDocumentsRepo,
    private adminCmd: AdminCommands,
    private schedulerCmd: SchedulerCommands,
    private toast: ToastService,
  ) {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    this.tsFrom = monday.toISOString().slice(0, 10);
    this.tsTo   = sunday.toISOString().slice(0, 10);

    this.orgId = this.ctx.orgId();
    this.routeSub = this.route.paramMap.subscribe((params) => {
      this.userId = String(params.get('uid') || '').trim();
      this.bindData();
    });
    void this.loadOrgPayrollSettings();
  }

  private async loadOrgPayrollSettings() {
    if (!this.orgId) return;
    try {
      const snap = await getDoc(doc(getFirestore(), 'orgs', this.orgId));
      const data: any = snap.exists() ? snap.data() : {};
      this.orgDeductionDefaults = {
        federalTaxPercent: Number(data.defaultFederalTaxPercent ?? 10),
        stateTaxPercent: Number(data.defaultStateTaxPercent ?? 4),
        socialSecurityPercent: Number(data.defaultSocialSecurityPercent ?? 6.2),
        medicarePercent: Number(data.defaultMedicarePercent ?? 1.45),
        retirement401kMatchPercent: Number(data.default401kMatchPercent ?? 0),
      };
      this.orgBenefitPlans.set(Array.isArray(data.benefitPlans) ? data.benefitPlans : []);
    } catch { /* non-critical */ }
  }

  addBenefitFromPlan() {
    const plan = this.orgBenefitPlans().find((p) => p.id === this.selectedBenefitPlanId);
    if (!plan) return;
    this.profileDraft.benefits = [
      ...this.profileDraft.benefits,
      { id: this.createLocalId('benefit'), label: plan.label, employeeAmount: plan.employeeAmount, employerAmount: plan.employerAmount },
    ];
    this.selectedBenefitPlanId = '';
  }

  addCustomBenefit() {
    this.profileDraft.benefits = [
      ...this.profileDraft.benefits,
      { id: this.createLocalId('benefit'), label: '', employeeAmount: 0, employerAmount: 0 },
    ];
  }

  removeEmployeeBenefit(index: number) {
    this.profileDraft.benefits = this.profileDraft.benefits.filter((_, i) => i !== index);
  }

  private createLocalId(prefix: string) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  ngOnDestroy() {
    this.unsubUsers?.();
    this.unsubShifts?.();
    this.unsubEntries?.();
    this.unsubTimeOff?.();
    this.unsubAccrual?.();
    this.unsubDocs?.();
    if (this.routeSub?.unsubscribe) this.routeSub.unsubscribe();
  }

  initials(user: OrgUser) {
    const name = user.displayName || user.email || 'Employee';
    const parts = name.split(/[\s@.]+/).filter(Boolean);
    return parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : name.slice(0, 2).toUpperCase();
  }

  toDate(value: any): Date {
    return tsToDate(value) || new Date();
  }

  fmt(ts: any): string { return ts ? formatDateTime(ts) : '—'; }

  totalHours(): string {
    const total = this.tsRows().reduce((sum, r) => sum + Number(r.hours), 0);
    return total.toFixed(2);
  }

  pendingCount(): number {
    return this.tsRows().filter((r) => r.entry.exceptionStatus === 'pending').length;
  }

  rebindTimesheet() {
    this.unsubEntries?.();
    this.unsubEntries = null;
    const orgId = this.orgId;
    const uid   = this.userId;
    if (!orgId || !uid || !this.tsFrom || !this.tsTo) return;

    const startAt = Timestamp.fromDate(new Date(this.tsFrom + 'T00:00:00'));
    const endAt   = Timestamp.fromDate(new Date(this.tsTo   + 'T23:59:59'));

    this.unsubEntries = this.timeRepo.watchEntriesRange(orgId, uid, startAt, endAt, async (entries) => {
      const shiftIds = Array.from(new Set(entries.map((e) => e.shiftId).filter(Boolean)));
      if (shiftIds.length) {
        const newMap = await this.shiftsRepo.getManyByIds(orgId, shiftIds);
        this.shiftMap = { ...this.shiftMap, ...newMap };
      }
      this.tsRows.set(entries.map((e) => this.buildRow(e)));
    });
  }

  private buildRow(e: TimeEntry): TsRow {
    const shift = this.shiftMap[e.shiftId];
    const inD  = tsToDate(e.checkInAt);
    const outD = tsToDate(e.checkOutAt);
    const breakMs = Number(e.totalBreakMs || 0);
    const ms = (inD && outD) ? Math.max(0, outD.getTime() - inD.getTime() - breakMs) : 0;
    return {
      entry: e,
      shiftTitle: shift?.title || 'Assigned shift',
      checkIn:  inD  ? this.fmt(e.checkInAt)  : '—',
      checkOut: outD ? this.fmt(e.checkOutAt) : '—',
      hours: (ms / 3600000).toFixed(2),
    };
  }

  startFix(entry: TimeEntry) {
    this.fixEntryId = entry.id;
    const inD  = tsToDate(entry.checkInAt);
    const outD = tsToDate(entry.checkOutAt);
    this.fixCheckIn  = inD  ? this.toLocalDatetimeInput(inD)  : '';
    this.fixCheckOut = outD ? this.toLocalDatetimeInput(outD) : '';
  }

  cancelFix() {
    this.fixEntryId = null;
    this.fixCheckIn = '';
    this.fixCheckOut = '';
  }

  async applyFix() {
    if (!this.fixEntryId) return;
    this.fixBusy = true;
    try {
      const inMs  = this.fixCheckIn  ? new Date(this.fixCheckIn).getTime()  : 0;
      const outMs = this.fixCheckOut ? new Date(this.fixCheckOut).getTime() : 0;
      if (inMs > 0 && outMs > 0 && outMs <= inMs) {
        this.toast.error('Corrected check-out must be after corrected check-in.');
        return;
      }
      await this.adminCmd.applyTimeCorrection({
        entryId: this.fixEntryId,
        correctedCheckInAtMs:  inMs  > 0 ? inMs  : undefined,
        correctedCheckOutAtMs: outMs > 0 ? outMs : undefined,
      });
      this.toast.success('Correction applied.');
      this.cancelFix();
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to apply correction.');
    } finally {
      this.fixBusy = false;
    }
  }

  async rejectFix() {
    if (!this.fixEntryId) return;
    const ok = window.confirm('Reject this correction request?');
    if (!ok) return;
    const reason = String(window.prompt('Optional rejection reason:') || '').trim();
    this.fixBusy = true;
    try {
      await this.adminCmd.decideTimeCorrection(this.fixEntryId, 'rejected', { decisionReason: reason || undefined });
      this.toast.success('Request rejected.');
      this.cancelFix();
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to reject.');
    } finally {
      this.fixBusy = false;
    }
  }

  private toLocalDatetimeInput(d: Date): string {
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  }

  async sendMessageToEmployee() {
    if (!this.userId) return;
    this.messageBusy = true;
    try {
      await this.adminCmd.sendMessage({
        title: this.messageTitle.trim(),
        body: this.messageBody.trim(),
        targetType: 'single',
        userIds: [this.userId],
        inApp: true,
      });
      this.toast.success('Message sent to employee.');
      this.messageTitle = '';
      this.messageBody = '';
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to send message.');
    } finally {
      this.messageBusy = false;
    }
  }

  async unassignShift(shift: Shift) {
    const ok = window.confirm(`Unassign shift "${shift.title}" from this employee?`);
    if (!ok) return;
    try {
      await this.schedulerCmd.unassignShift(shift.id);
      this.toast.success('Shift unassigned.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to unassign shift.');
    }
  }

  async deleteShift(shift: Shift) {
    const ok = window.confirm(`Delete shift "${shift.title}"? This action cannot be undone.`);
    if (!ok) return;
    try {
      await this.schedulerCmd.deleteShift(shift.id);
      this.toast.success('Shift deleted.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to delete shift.');
    }
  }

  async openShiftChat(shiftId: string) {
    await this.router.navigate(['/app/shift-chat'], { queryParams: { shiftId } });
  }

  async openEmployeeDocument(item: EmployeeDocumentRecord) {
    try {
      window.open(await this.docsRepo.getDocumentUrl(item), '_blank', 'noopener');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to open employee document.');
    }
  }

  async reviewEmployeeDocument(item: EmployeeDocumentRecord, decision: 'verified' | 'rejected') {
    if (!this.orgId || this.documentReviewBusy) return;
    let reviewNote = '';
    if (decision === 'rejected') {
      reviewNote = String(window.prompt('What should the employee correct?') || '').trim();
      if (!reviewNote) return;
    }
    this.documentReviewBusy = true;
    try {
      await this.adminCmd.reviewEmployeeDocument({
        orgId: this.orgId,
        documentId: item.id,
        decision,
        reviewNote: reviewNote || undefined,
      });
      this.toast.success(decision === 'verified' ? 'Document verified.' : 'Document rejected.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to review document.');
    } finally {
      this.documentReviewBusy = false;
    }
  }

  docLabel(type: any) {
    return this.docsRepo.labelFor(type);
  }

  docStatus(status: string) {
    if (status === 'verified') return 'Verified';
    if (status === 'rejected') return 'Needs update';
    return 'Pending';
  }

  printPage() { window.print(); }

  printTimesheet() {
    const orgId = this.orgId;
    const uid   = this.userId;
    if (!orgId || !uid) return;
    const url = `/admin/timesheets/print?uid=${uid}&from=${this.tsFrom}&to=${this.tsTo}`;
    window.open(url, '_blank');
  }

  async saveEmployeeProfile() {
    if (!this.orgId || !this.userId) return;
    this.profileSaving = true;
    try {
      const dependents = this.parseDependentsText();
      const payload = {
        displayName: this.profileDraft.displayName.trim(),
        email: this.profileDraft.email.trim(),
        phone: this.profileDraft.phone.trim(),
        accessRole: this.profileDraft.accessRole || 'staff',
        jobRole: this.profileDraft.jobRole.trim() || 'Staff',
        active: this.profileDraft.active !== false,
        payRate: this.num(this.profileDraft.payRate),
        payType: this.profileDraft.payType || 'hourly',
        employeeNumber: this.profileDraft.employeeNumber.trim(),
        title: this.profileDraft.title.trim(),
        department: this.profileDraft.department.trim(),
        locationName: this.profileDraft.locationName.trim(),
        managerName: this.profileDraft.managerName.trim(),
        managerEmail: this.profileDraft.managerEmail.trim(),
        hireDate: this.profileDraft.hireDate.trim(),
        profile: {
          employeeNumber: this.profileDraft.employeeNumber.trim(),
          title: this.profileDraft.title.trim(),
          department: this.profileDraft.department.trim(),
          locationName: this.profileDraft.locationName.trim(),
          phone: this.profileDraft.phone.trim(),
          managerName: this.profileDraft.managerName.trim(),
          managerEmail: this.profileDraft.managerEmail.trim(),
        },
        payroll: {
          payType: this.profileDraft.payType || 'hourly',
          payRate: this.num(this.profileDraft.payRate),
          deductions: {
            federalTaxPercent: this.profileDraft.federalTaxPercent != null ? this.num(this.profileDraft.federalTaxPercent) : null,
            stateTaxPercent: this.profileDraft.stateTaxPercent != null ? this.num(this.profileDraft.stateTaxPercent) : null,
            socialSecurityPercent: this.profileDraft.socialSecurityPercent != null ? this.num(this.profileDraft.socialSecurityPercent) : null,
            medicarePercent: this.profileDraft.medicarePercent != null ? this.num(this.profileDraft.medicarePercent) : null,
            retirement401kPercent: this.num(this.profileDraft.retirement401kPercent),
            retirement401kMatchPercent: this.profileDraft.retirement401kMatchPercent != null ? this.num(this.profileDraft.retirement401kMatchPercent) : null,
            benefits: this.profileDraft.benefits
              .map((b) => ({ id: b.id, label: b.label.trim(), employeeAmount: this.num(b.employeeAmount), employerAmount: this.num(b.employerAmount) }))
              .filter((b) => b.label),
          },
          updatedAt: serverTimestamp(),
        },
        taxWithholding: {
          filingStatus: this.profileDraft.w4FilingStatus || 'single',
          multipleJobs: this.profileDraft.w4MultipleJobs === true,
          dependentAmount: this.num(this.profileDraft.w4DependentAmount),
          extraWithholding: this.num(this.profileDraft.w4ExtraWithholding),
          updatedAt: serverTimestamp(),
        },
        w2: {
          delivery: this.profileDraft.w2Delivery || 'electronic',
          electronicConsent: this.profileDraft.w2ElectronicConsent !== false,
          email: this.profileDraft.email.trim(),
          updatedAt: serverTimestamp(),
        },
        dependents,
        updatedAt: serverTimestamp(),
        profileUpdatedAt: serverTimestamp(),
      };

      await setDoc(doc(getFirestore(), `orgs/${this.orgId}/users/${this.userId}`), payload, { merge: true });
      this.toast.success('Employee profile saved.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to save employee profile.');
    } finally {
      this.profileSaving = false;
    }
  }

  async toggleEmployeeActive() {
    this.profileDraft.active = !this.profileDraft.active;
    await this.saveEmployeeProfile();
  }

  openEmployeePayslip() {
    if (!this.userId) return;
    void this.router.navigate(['/admin/payroll/payslip'], {
      queryParams: { uid: this.userId, from: this.tsFrom, to: this.tsTo },
    });
  }

  openEmployeePto() {
    void this.router.navigate(['/admin/pto'], { queryParams: { uid: this.userId } });
  }

  private syncProfileDraft(user: OrgUser | null) {
    if (!user) {
      this.profileDraft = this.emptyProfileDraft();
      this.dependentsText = '';
      return;
    }
    const data: any = user;
    const profile = data.profile || {};
    const payroll = data.payroll || {};
    const tax = data.taxWithholding || {};
    const w2 = data.w2 || {};
    const deductions = payroll.deductions || {};
    this.profileDraft = {
      displayName: String(data.displayName || ''),
      email: String(data.email || ''),
      phone: String(profile.phone || data.phone || ''),
      title: String(profile.title || data.title || ''),
      department: String(profile.department || data.department || ''),
      employeeNumber: String(profile.employeeNumber || data.employeeNumber || ''),
      locationName: String(profile.locationName || data.locationName || ''),
      hireDate: String(data.hireDate || ''),
      accessRole: String(data.accessRole || 'staff'),
      jobRole: String(data.jobRole || 'Staff'),
      active: data.active !== false,
      payRate: this.num(payroll.payRate ?? data.payRate ?? 0),
      payType: String(payroll.payType || data.payType || 'hourly'),
      managerName: String(profile.managerName || data.managerName || ''),
      managerEmail: String(profile.managerEmail || data.managerEmail || ''),
      w4FilingStatus: String(tax.filingStatus || 'single'),
      w4MultipleJobs: tax.multipleJobs === true,
      w4DependentAmount: this.num(tax.dependentAmount || 0),
      w4ExtraWithholding: this.num(tax.extraWithholding || 0),
      w2Delivery: String(w2.delivery || 'electronic'),
      w2ElectronicConsent: w2.electronicConsent !== false,
      federalTaxPercent: deductions.federalTaxPercent != null ? this.num(deductions.federalTaxPercent) : null,
      stateTaxPercent: deductions.stateTaxPercent != null ? this.num(deductions.stateTaxPercent) : null,
      socialSecurityPercent: deductions.socialSecurityPercent != null ? this.num(deductions.socialSecurityPercent) : null,
      medicarePercent: deductions.medicarePercent != null ? this.num(deductions.medicarePercent) : null,
      retirement401kPercent: this.num(deductions.retirement401kPercent || 0),
      retirement401kMatchPercent: deductions.retirement401kMatchPercent != null ? this.num(deductions.retirement401kMatchPercent) : null,
      benefits: Array.isArray(deductions.benefits) ? deductions.benefits.map((b: any) => ({ id: String(b.id || this.createLocalId('benefit')), label: String(b.label || ''), employeeAmount: this.num(b.employeeAmount || 0), employerAmount: this.num(b.employerAmount || 0) })) : [],
    };
    this.dependentsText = Array.isArray(data.dependents)
      ? data.dependents
          .map((dep: any) => [dep.name, dep.relationship, dep.birthYear].filter(Boolean).join(', '))
          .join('\n')
      : '';
  }

  private emptyProfileDraft(): EmployeeProfileDraft {
    return {
      displayName: '',
      email: '',
      phone: '',
      title: '',
      department: '',
      employeeNumber: '',
      locationName: '',
      hireDate: '',
      accessRole: 'staff',
      jobRole: 'Staff',
      active: true,
      payRate: 0,
      payType: 'hourly',
      managerName: '',
      managerEmail: '',
      w4FilingStatus: 'single',
      w4MultipleJobs: false,
      w4DependentAmount: 0,
      w4ExtraWithholding: 0,
      w2Delivery: 'electronic',
      w2ElectronicConsent: true,
      federalTaxPercent: null,
      stateTaxPercent: null,
      socialSecurityPercent: null,
      medicarePercent: null,
      retirement401kPercent: 0,
      retirement401kMatchPercent: null,
      benefits: [],
    };
  }

  private parseDependentsText() {
    return this.dependentsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name = '', relationship = '', birthYear = ''] = line.split(',').map((part) => part.trim());
        return {
          name,
          relationship,
          birthYear: birthYear ? Number(birthYear) : null,
          taxEligible: true,
        };
      })
      .filter((dep) => dep.name || dep.relationship);
  }

  private num(value: any): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  private bindData() {
    this.unsubUsers?.();
    this.unsubShifts?.();
    this.unsubEntries?.();
    this.unsubTimeOff?.();
    this.unsubAccrual?.();
    this.unsubDocs?.();
    this.user.set(null);
    this.shifts.set([]);
    this.tsRows.set([]);
    this.timeOffRequests.set([]);
    this.employeeDocuments.set([]);
    this.accrualBalance.set(this.accruals.emptyBalance(this.orgId || '', this.userId || ''));

    if (!this.orgId || !this.userId) return;

    this.unsubUsers = this.usersRepo.watchOrgUser(this.orgId, this.userId, (item) => {
      this.user.set(item || null);
      this.syncProfileDraft(this.user());
    });

    this.unsubShifts = this.shiftsRepo.watchAssignedShifts(this.orgId, this.userId, (items) => {
      this.shifts.set(items
        .filter((shift) => shift.assignedUserId === this.userId)
        .sort((a, b) => this.toDate(a.startAt).getTime() - this.toDate(b.startAt).getTime()));
    });

    this.rebindTimesheet();
    if (this.isAdminOrHr()) {
      this.unsubTimeOff = this.accruals.watchRequests(this.orgId, this.userId, (items) => {
        this.timeOffRequests.set(items);
      }, 20);
      this.unsubAccrual = this.accruals.watchBalance(this.orgId, this.userId, (balance) => {
        this.accrualBalance.set(balance);
      });
      this.unsubDocs = this.docsRepo.watchForUser(this.orgId, this.userId, (items) => {
        this.employeeDocuments.set(items);
      });
    }
  }

  // Payroll, PTO requests, and employee documents are admin/hr-only —
  // gates both the Firestore watchers above and the template cards below.
  isAdminOrHr(): boolean {
    const role = this.ctx.accessRole();
    return role === 'admin' || role === 'hr';
  }
}
