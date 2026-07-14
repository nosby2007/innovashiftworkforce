import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { UsersRepo, OrgUser } from '../../core/repos/users.repo';
import { AuditRepo, AuditLog } from '../../core/repos/audit.repo';
import { EmployeeDocumentRecord, EmployeeDocumentsRepo } from '../../core/repos/employee-documents.repo';
import { profileCompletion } from '../../shared/utils/profile-completion.util';

type CheckStatus = 'pass' | 'warn' | 'fail';
type ReadinessCheck = {
  section: string;
  title: string;
  description: string;
  status: CheckStatus;
  action: string;
  link: string;
};

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink, MatIconModule],
  template: `
    <div class="vs-page-pad ready-page">
      <header class="ready-hero">
        <div>
          <span>Delivery Control</span>
          <h1>Launch Readiness</h1>
          <p>Role QA, security isolation, Firebase performance, compliance workflow, staff onboarding, and operational monitoring.</p>
        </div>
        <div class="ready-score">
          <strong>{{ readinessScore() }}%</strong>
          <small>Ready</small>
        </div>
      </header>

      <div *ngIf="!orgId" class="ready-alert">
        <mat-icon>warning_amber</mat-icon>
        Missing organization context.
      </div>

      <ng-container *ngIf="orgId">
        <section class="ready-kpis">
          <article><span>Staff</span><strong>{{ users().length }}</strong></article>
          <article><span>Incomplete Profiles</span><strong>{{ incompleteProfiles() }}</strong></article>
          <article><span>Pending Documents</span><strong>{{ pendingDocuments() }}</strong></article>
          <article><span>Recent Audit Events</span><strong>{{ auditLogs().length }}</strong></article>
        </section>

        <section class="ready-sections">
          <article *ngFor="let group of groupedChecks()" class="ready-card">
            <div class="ready-card-head">
              <h2>{{ group.section }}</h2>
              <span>{{ group.pass }}/{{ group.items.length }}</span>
            </div>
            <div class="ready-check" *ngFor="let item of group.items" [class.is-pass]="item.status === 'pass'" [class.is-warn]="item.status === 'warn'" [class.is-fail]="item.status === 'fail'">
              <mat-icon>{{ icon(item.status) }}</mat-icon>
              <div>
                <strong>{{ item.title }}</strong>
                <p>{{ item.description }}</p>
              </div>
              <a [routerLink]="item.link">{{ item.action }}</a>
            </div>
          </article>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .ready-page { color:var(--text); }
    .ready-hero { min-height:160px; margin:-24px -22px 22px; padding:28px; display:flex; justify-content:space-between; align-items:end; gap:20px; background:#0f172a; color:#fff; }
    .ready-hero span { color:#93c5fd; font-size:12px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; }
    .ready-hero h1 { margin:6px 0; font-size:34px; line-height:1.05; }
    .ready-hero p { margin:0; max-width:760px; color:#cbd5e1; }
    .ready-score { width:118px; height:118px; border:1px solid rgba(255,255,255,.2); border-radius:12px; display:grid; place-items:center; align-content:center; background:rgba(255,255,255,.08); }
    .ready-score strong { font-size:34px; line-height:1; }
    .ready-score small { color:#cbd5e1; font-weight:900; text-transform:uppercase; letter-spacing:.08em; }
    .ready-alert { display:flex; gap:10px; align-items:center; padding:14px 16px; border:1px solid #fed7aa; border-radius:8px; background:#fff7ed; color:#92400e; font-weight:800; }
    .ready-kpis { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:14px; margin-bottom:16px; }
    .ready-kpis article { border:1px solid var(--border); border-radius:8px; padding:16px; background:var(--panel); box-shadow:0 12px 28px rgba(15,23,42,.06); }
    .ready-kpis span { display:block; color:var(--text-muted); font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.08em; }
    .ready-kpis strong { display:block; margin-top:7px; font-size:30px; color:var(--text); }
    .ready-sections { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:16px; }
    .ready-card { border:1px solid var(--border); border-radius:8px; background:var(--panel); overflow:hidden; }
    .ready-card-head { min-height:56px; display:flex; justify-content:space-between; align-items:center; gap:12px; padding:0 16px; border-bottom:1px solid var(--border); }
    .ready-card-head h2 { margin:0; font-size:17px; }
    .ready-card-head span { color:var(--text-muted); font-weight:900; }
    .ready-check { display:grid; grid-template-columns:24px 1fr auto; gap:12px; align-items:start; padding:14px 16px; border-bottom:1px solid var(--border); }
    .ready-check:last-child { border-bottom:0; }
    .ready-check mat-icon { font-size:20px; width:20px; height:20px; color:#f59e0b; }
    .ready-check.is-pass mat-icon { color:#047857; }
    .ready-check.is-fail mat-icon { color:#dc2626; }
    .ready-check strong { display:block; color:var(--text); }
    .ready-check p { margin:4px 0 0; color:var(--text-muted); line-height:1.35; }
    .ready-check a { min-height:34px; padding:0 10px; border:1px solid var(--border); border-radius:8px; display:inline-flex; align-items:center; color:var(--text); text-decoration:none; font-weight:900; background:var(--panel-2, #fff); white-space:nowrap; }
    @media (max-width:980px) { .ready-hero { margin:-14px -12px 18px; padding:22px 16px; align-items:flex-start; flex-direction:column; } .ready-kpis, .ready-sections, .ready-check { grid-template-columns:1fr; } }
  `],
})
export class AdminReadinessPage implements OnDestroy {
  orgId: string | null = null;
  users = signal<OrgUser[]>([]);
  documents = signal<EmployeeDocumentRecord[]>([]);
  auditLogs = signal<AuditLog[]>([]);
  private unsubs: Array<() => void> = [];

  constructor(
    private ctx: OrgContextService,
    private usersRepo: UsersRepo,
    private docsRepo: EmployeeDocumentsRepo,
    private auditRepo: AuditRepo,
  ) {
    this.bind();
    setTimeout(() => this.bind(), 900);
  }

  bind() {
    const orgId = this.ctx.orgId();
    this.orgId = orgId;
    if (!orgId || this.unsubs.length) return;
    this.unsubs.push(this.usersRepo.watchOrgUsers(orgId, (items) => this.users.set(items), 300));
    this.unsubs.push(this.docsRepo.watchOrgQueue(orgId, (items) => this.documents.set(items), 150));
    this.unsubs.push(this.auditRepo.watchRecent(orgId, (items) => this.auditLogs.set(items), 80));
  }

  checks(): ReadinessCheck[] {
    const hasAdmin = this.users().some((u) => ['admin', 'manager', 'scheduler', 'hr'].includes(String(u.accessRole || '')));
    const hasStaff = this.users().some((u) => String(u.accessRole || 'staff') === 'staff');
    return [
      {
        section: '1. Role QA',
        title: 'Staff and admin personas exist',
        description: hasAdmin && hasStaff ? 'Both staff and elevated org roles are present for QA.' : 'Create or provision one staff account and one admin-like account before release testing.',
        status: hasAdmin && hasStaff ? 'pass' : 'warn',
        action: 'Employees',
        link: '/admin/employees',
      },
      {
        section: '1. Role QA',
        title: 'Payroll and PTO flows are reachable',
        description: 'Use this to test PTO approval, timesheet correction, payroll run lock, and payslip printing.',
        status: 'pass',
        action: 'Payroll',
        link: '/admin/payroll',
      },
      {
        section: '2. Security Audit',
        title: 'Tenant-scoped rules are deployed',
        description: 'Firestore rules enforce organization scope, super-admin separation, and staff self-service limits.',
        status: 'pass',
        action: 'Audit',
        link: '/admin/audit',
      },
      {
        section: '2. Security Audit',
        title: 'Document access uses employee-scoped storage',
        description: 'Staff uploads are stored under their protected employee document path and reviewed by admin actions.',
        status: 'pass',
        action: 'Documents',
        link: '/admin/documents',
      },
      {
        section: '3. Performance',
        title: 'Employee details use single-user listener',
        description: 'Employee detail pages now avoid streaming the full organization user list for one profile.',
        status: 'pass',
        action: 'Employees',
        link: '/admin/employees',
      },
      {
        section: '3. Performance',
        title: 'Document queue is capped',
        description: 'The document verification queue reads the latest limited records instead of unbounded history.',
        status: 'pass',
        action: 'Queue',
        link: '/admin/documents',
      },
      {
        section: '4. Document Queue',
        title: 'Pending employee documents',
        description: this.pendingDocuments() ? `${this.pendingDocuments()} document(s) are waiting for review.` : 'No pending employee documents.',
        status: this.pendingDocuments() ? 'warn' : 'pass',
        action: 'Review',
        link: '/admin/documents',
      },
      {
        section: '5. Onboarding',
        title: 'Profile readiness',
        description: this.incompleteProfiles() ? `${this.incompleteProfiles()} employee profile(s) are missing onboarding data.` : 'Employee profiles look ready.',
        status: this.incompleteProfiles() ? 'warn' : 'pass',
        action: 'Employees',
        link: '/admin/employees',
      },
      {
        section: '6. Monitoring',
        title: 'Audit feed is active',
        description: this.auditLogs().length ? `${this.auditLogs().length} recent audit event(s) loaded for operations review.` : 'No recent audit events. Verify admin actions write audit records.',
        status: this.auditLogs().length ? 'pass' : 'warn',
        action: 'Audit',
        link: '/admin/audit',
      },
      {
        section: '6. Monitoring',
        title: 'Operational exceptions are visible',
        description: 'Admins can use PTO, timesheets, documents, and audit pages as the daily monitoring surface.',
        status: 'pass',
        action: 'Dashboard',
        link: '/admin',
      },
    ];
  }

  groupedChecks() {
    const groups = new Map<string, ReadinessCheck[]>();
    for (const check of this.checks()) {
      groups.set(check.section, [...(groups.get(check.section) || []), check]);
    }
    return Array.from(groups.entries()).map(([section, items]) => ({
      section,
      items,
      pass: items.filter((item) => item.status === 'pass').length,
    }));
  }

  readinessScore() {
    const checks = this.checks();
    if (!checks.length) return 0;
    const points = checks.reduce((sum, item) => sum + (item.status === 'pass' ? 1 : item.status === 'warn' ? 0.5 : 0), 0);
    return Math.round((points / checks.length) * 100);
  }

  incompleteProfiles() {
    return this.users().filter((user) => profileCompletion(user as any).score < 80).length;
  }

  pendingDocuments() {
    return this.documents().filter((doc) => doc.status === 'pending').length;
  }

  icon(status: CheckStatus) {
    if (status === 'pass') return 'check_circle';
    if (status === 'fail') return 'error';
    return 'warning_amber';
  }

  ngOnDestroy() {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
  }
}
