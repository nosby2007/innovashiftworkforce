import { Component, NgZone, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { doc, getFirestore, onSnapshot } from 'firebase/firestore';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { EmployeeDocumentRecord, EmployeeDocumentsRepo } from '../../core/repos/employee-documents.repo';
import { profileCompletion } from '../../shared/utils/profile-completion.util';

type Step = {
  title: string;
  description: string;
  icon: string;
  done: boolean;
  link: string;
  action: string;
};

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink, MatIconModule],
  template: `
    <div class="onb-page">
      <header class="onb-hero">
        <div>
          <span>Staff Onboarding</span>
          <h1>Get Ready for Work</h1>
          <p>Finish the records your organization needs for scheduling, timekeeping, payroll, and compliance.</p>
        </div>
        <div class="onb-score">
          <strong>{{ progress() }}%</strong>
          <small>Complete</small>
        </div>
      </header>

      <div *ngIf="!orgId || !uid" class="onb-alert">
        <mat-icon>warning_amber</mat-icon>
        Missing organization or user context.
      </div>

      <ng-container *ngIf="orgId && uid">
        <section class="onb-summary">
          <article>
            <span>Profile</span>
            <strong>{{ profileCompletion().score }}%</strong>
            <small>{{ profileCompletion().missing.length ? profileCompletion().missing[0] + ' missing' : 'Ready' }}</small>
          </article>
          <article>
            <span>Documents</span>
            <strong>{{ verifiedDocuments() }}</strong>
            <small>{{ pendingDocuments() }} pending review</small>
          </article>
          <article>
            <span>Payroll</span>
            <strong>{{ payrollReady() ? 'Ready' : 'Review' }}</strong>
            <small>W-4, W-2, and payment basics</small>
          </article>
        </section>

        <section class="onb-steps">
          <a *ngFor="let step of steps()" [routerLink]="step.link" class="onb-step" [class.is-done]="step.done">
            <span class="onb-step-icon"><mat-icon>{{ step.icon }}</mat-icon></span>
            <div>
              <strong>{{ step.title }}</strong>
              <p>{{ step.description }}</p>
            </div>
            <em>{{ step.done ? 'Complete' : step.action }}</em>
          </a>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .onb-page { color:#1f2937; }
    .onb-hero { min-height:160px; margin:-24px -22px 22px; padding:28px; display:flex; justify-content:space-between; align-items:end; gap:20px; background:#07533f; color:#fff; }
    .onb-hero span { color:rgba(255,255,255,.74); font-size:12px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; }
    .onb-hero h1 { margin:6px 0; font-size:34px; line-height:1.05; }
    .onb-hero p { margin:0; max-width:720px; color:rgba(255,255,255,.82); }
    .onb-score { width:118px; height:118px; border:1px solid rgba(255,255,255,.25); border-radius:12px; display:grid; place-items:center; align-content:center; background:rgba(255,255,255,.1); }
    .onb-score strong { font-size:34px; line-height:1; }
    .onb-score small { color:rgba(255,255,255,.8); font-weight:900; text-transform:uppercase; letter-spacing:.08em; }
    .onb-alert { display:flex; gap:10px; align-items:center; padding:14px 16px; border:1px solid #fed7aa; border-radius:8px; background:#fff7ed; color:#92400e; font-weight:800; }
    .onb-summary { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:14px; margin-bottom:16px; }
    .onb-summary article { border:1px solid rgba(15,23,42,.12); border-radius:8px; background:rgba(255,255,255,.94); padding:16px; box-shadow:0 12px 28px rgba(15,23,42,.07); }
    .onb-summary span { display:block; color:#64748b; font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.08em; }
    .onb-summary strong { display:block; margin-top:7px; color:#0f172a; font-size:28px; }
    .onb-summary small { color:#64748b; }
    .onb-steps { display:grid; gap:10px; }
    .onb-step { display:grid; grid-template-columns:46px 1fr auto; gap:12px; align-items:center; min-height:82px; padding:14px; border:1px solid rgba(15,23,42,.12); border-radius:8px; background:rgba(255,255,255,.94); color:#1f2937; text-decoration:none; box-shadow:0 12px 28px rgba(15,23,42,.05); }
    .onb-step:hover { border-color:#047857; }
    .onb-step-icon { width:44px; height:44px; border-radius:10px; display:grid; place-items:center; background:#fff7ed; color:#92400e; }
    .onb-step.is-done .onb-step-icon { background:#ecfdf5; color:#047857; }
    .onb-step strong { display:block; color:#0f172a; }
    .onb-step p { margin:4px 0 0; color:#64748b; line-height:1.35; }
    .onb-step em { padding:6px 10px; border-radius:999px; background:#fff7ed; color:#92400e; font-style:normal; font-weight:900; font-size:12px; white-space:nowrap; }
    .onb-step.is-done em { background:#ecfdf5; color:#047857; }
    @media (max-width:900px) { .onb-hero { margin:-14px -12px 18px; padding:22px 16px; align-items:flex-start; flex-direction:column; } .onb-summary, .onb-step { grid-template-columns:1fr; } }
  `],
})
export class StaffOnboardingPage implements OnDestroy {
  orgId: string | null = null;
  uid: string | null = null;
  user = signal<any>(null);
  documents = signal<EmployeeDocumentRecord[]>([]);
  private unsubUser: (() => void) | null = null;
  private unsubDocs: (() => void) | null = null;

  constructor(private zone: NgZone, private ctx: OrgContextService, private docs: EmployeeDocumentsRepo) {
    this.bind();
    setTimeout(() => this.bind(), 900);
  }

  bind() {
    this.orgId = this.ctx.orgId();
    this.uid = this.ctx.uid();
    if (!this.orgId || !this.uid || this.unsubUser) return;
    this.unsubUser = onSnapshot(doc(getFirestore(), `orgs/${this.orgId}/users/${this.uid}`), (snap) => {
      this.zone.run(() => {
        this.user.set(snap.exists() ? { uid: snap.id, ...(snap.data() as any) } : null);
      });
    }, () => this.zone.run(() => { this.user.set(null); }));
    this.unsubDocs = this.docs.watchForUser(this.orgId, this.uid, (items) => this.documents.set(items));
  }

  profileCompletion() {
    return profileCompletion(this.user() || {});
  }

  payrollReady() {
    const u = this.user() || {};
    return !!u.taxWithholding?.certified && !!u.w2?.delivery && !!(u.payroll?.payType || u.payType);
  }

  verifiedDocuments() {
    return this.documents().filter((item) => item.status === 'verified').length;
  }

  pendingDocuments() {
    return this.documents().filter((item) => item.status === 'pending').length;
  }

  steps(): Step[] {
    const profile = this.profileCompletion();
    const hasIdentity = this.documents().some((item) => item.type === 'identity' && item.status === 'verified');
    const hasTaxDoc = this.documents().some((item) => ['w4', 'w2'].includes(item.type) && item.status !== 'rejected');
    return [
      { title: 'Complete your profile', description: 'Name, phone, address, emergency contact, department, and work location.', icon: 'account_circle', done: profile.score >= 80, link: '/app/profile', action: 'Update' },
      { title: 'Submit identity and licenses', description: 'Upload identity, clinical license, certification, or required compliance documents.', icon: 'badge', done: hasIdentity, link: '/app/documents', action: 'Upload' },
      { title: 'Prepare tax and payroll records', description: 'Confirm W-4/W-2 preferences, dependents, and payroll details.', icon: 'payments', done: this.payrollReady() || hasTaxDoc, link: '/app/profile', action: 'Review' },
      { title: 'Review your schedule', description: 'Confirm assigned shifts, availability, and marketplace opportunities.', icon: 'calendar_month', done: true, link: '/app/schedule', action: 'Open' },
      { title: 'Check PTO and accruals', description: 'Review available balances and submit time-off requests when needed.', icon: 'event_available', done: true, link: '/app/accruals', action: 'Open' },
      { title: 'Read notifications', description: 'Keep approvals, payroll messages, shift changes, and admin alerts current.', icon: 'notifications_active', done: true, link: '/app/notifications', action: 'Open' },
    ];
  }

  progress() {
    const steps = this.steps();
    return Math.round((steps.filter((step) => step.done).length / steps.length) * 100);
  }

  ngOnDestroy() {
    this.unsubUser?.();
    this.unsubDocs?.();
  }
}
