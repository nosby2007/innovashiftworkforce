import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { OrgDirectoryRepo, OrgDirectoryItem } from '../../core/repos/org-directory.repo';
import { SuperAdminService } from './super-admin.service';
import { ToastService } from '../../core/ui/toast.service';
import { TableListController } from '../../shared/ui/table-list/table-list.controller';
import { TablePaginatorComponent } from '../../shared/ui/table-list/table-paginator.component';
import {
  CURRENCY_OPTIONS,
  PAY_FREQUENCY_OPTIONS,
  TAX_PROFILE_OPTIONS,
  PayFrequency,
  TaxProfileId,
  defaultCurrencyForTaxProfile,
} from '../../core/tenancy/org-finance.model';
import { computeBillingSummary } from '../../shared/utils/billing-summary.util';

const ACCESS_ROLES = ['staff', 'manager', 'scheduler', 'admin', 'hr'] as const;
const JOB_ROLES = ['RN', 'CNA', 'LPN', 'Caregiver', 'NP', 'MD', 'Manager', 'Admin', 'HR', 'Other'];
const PLANS = ['free', 'starter', 'pro', 'enterprise'] as const;
const PLAN_STATUSES = ['active', 'trialing', 'past_due', 'canceled'] as const;
// Mirrors the public pricing page (features/public/pricing/pricing.page.ts).
// Stripe checkout isn't wired to that page yet (org.plan is set manually by
// super-admins today), so these list prices are the best available source
// for a revenue estimate — not a live Stripe amount. Enterprise has no fixed
// price, so it's tracked separately rather than folded into MRR as $0.
const PLAN_MONTHLY_PRICE_USD: Record<(typeof PLANS)[number], number | null> = {
  free: 0,
  starter: 49,
  pro: 149,
  enterprise: null,
};
const INDUSTRIES = [
  'Healthcare', 'Hospitality', 'Retail', 'Manufacturing',
  'Transportation', 'Education', 'Finance', 'Technology', 'Other',
];

const COUNTRIES = [
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'CM', label: 'Cameroon' },
  { code: 'NG', label: 'Nigeria' },
  { code: 'GH', label: 'Ghana' },
  { code: 'KE', label: 'Kenya' },
  { code: 'ZA', label: 'South Africa' },
  { code: 'AE', label: 'United Arab Emirates' },
  { code: 'SN', label: 'Senegal' },
  { code: 'CI', label: 'Ivory Coast' },
  { code: 'OTHER', label: 'Other' },
];

type OrgDraft = {
  name: string;
  industry: string;
  timezone: string;
  contactEmail: string;
  plan: typeof PLANS[number];
  planStatus: typeof PLAN_STATUSES[number];
  countryCode: string;
  currencyCode: string;
  payFrequency: PayFrequency;
  taxProfile: TaxProfileId;
  payrollTaxNotes: string;
  maxEmployees: number;
  defaultPayRate: number;
  active: boolean;
};

const DEFAULT_ORG_DRAFT: OrgDraft = {
  name: '',
  industry: 'Healthcare',
  timezone: 'America/New_York',
  contactEmail: '',
  plan: 'free',
  planStatus: 'active',
  countryCode: 'US',
  currencyCode: 'USD',
  payFrequency: 'biweekly',
  taxProfile: 'us_federal_state',
  payrollTaxNotes: '',
  maxEmployees: 25,
  defaultPayRate: 40,
  active: true,
};

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, TablePaginatorComponent],
  template: `
    <div class="vs-page-pad">
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">Super Admin Console</h1>
          <p class="vs-page-subtitle">Organization control, user provisioning, security, troubleshooting, and audit</p>
        </div>
        <div class="vs-page-actions">
          <span class="vs-badge vs-badge--warning" *ngIf="orgLoadError()">
            <mat-icon style="font-size:13px;">sync_problem</mat-icon>
            Using saved org list
          </span>
          <span class="vs-badge vs-badge--neutral" *ngIf="orgLoading()">
            <mat-icon style="font-size:13px;" class="sa-spin">refresh</mat-icon>
            Loading orgs
          </span>
          <span class="vs-badge vs-badge--danger">
            <mat-icon style="font-size:13px;">shield</mat-icon>
            Platform Owner
          </span>
        </div>
      </div>

      <div class="sa-tabs">
        <button class="sa-tab" [class.sa-tab--active]="activeTab() === 'overview'" (click)="activeTab.set('overview')">
          <mat-icon>dashboard</mat-icon> Overview
        </button>
        <button class="sa-tab" [class.sa-tab--active]="activeTab() === 'organization'" (click)="activeTab.set('organization')">
          <mat-icon>business</mat-icon> Organization
        </button>
        <button class="sa-tab" [class.sa-tab--active]="activeTab() === 'user'" (click)="activeTab.set('user')">
          <mat-icon>group</mat-icon> User
        </button>
        <button class="sa-tab" [class.sa-tab--active]="activeTab() === 'security'" (click)="activeTab.set('security')">
          <mat-icon>security</mat-icon> Security
        </button>
        <button class="sa-tab" [class.sa-tab--active]="activeTab() === 'governance'" (click)="activeTab.set('governance')">
          <mat-icon>policy</mat-icon> Governance
        </button>
        <button class="sa-tab" [class.sa-tab--active]="activeTab() === 'troubleshooting'" (click)="activeTab.set('troubleshooting')">
          <mat-icon>report_problem</mat-icon> Troubleshooting
        </button>
        <button class="sa-tab" [class.sa-tab--active]="activeTab() === 'audit'" (click)="activeTab.set('audit')">
          <mat-icon>history</mat-icon> Audit
        </button>
      </div>

      <div *ngIf="activeTab() === 'overview'">
        <div class="vs-grid-3 sa-kpis">
          <div class="vs-stat-card vs-stat--primary">
            <div class="vs-stat-label">Total Organizations</div>
            <div class="vs-stat-value">{{ orgs().length }}</div>
            <mat-icon class="vs-stat-icon">business</mat-icon>
          </div>
          <div class="vs-stat-card vs-stat--success">
            <div class="vs-stat-label">Active Tenants</div>
            <div class="vs-stat-value">{{ activeOrgs() }}</div>
            <mat-icon class="vs-stat-icon">check_circle</mat-icon>
          </div>
          <div class="vs-stat-card vs-stat--warning">
            <div class="vs-stat-label">At-Risk Orgs</div>
            <div class="vs-stat-value">{{ atRiskOrgs() }}</div>
            <mat-icon class="vs-stat-icon">warning</mat-icon>
          </div>
        </div>

        <section class="sa-health-strip">
          <article>
            <mat-icon>health_and_safety</mat-icon>
            <span>Platform Health</span>
            <strong>{{ platformHealthScore() }}%</strong>
            <small>Weighted by active, paid, and governed tenants</small>
          </article>
          <article>
            <mat-icon>payments</mat-icon>
            <span>Billing Governance</span>
            <strong>{{ billingReadyOrgs() }}/{{ orgs().length }}</strong>
            <small>tenants on paid active plans</small>
          </article>
          <article>
            <mat-icon>public</mat-icon>
            <span>Country Coverage</span>
            <strong>{{ countryCount() }}</strong>
            <small>jurisdiction and currency profiles configured</small>
          </article>
        </section>

        <div class="vs-grid-2">
          <section class="vs-glass-strong sa-section">
            <div class="vs-panel-head">
              <div class="vs-panel-title">Security Posture</div>
              <mat-icon class="sa-icon">security</mat-icon>
            </div>
            <div class="vs-panel-body">
              <div class="sa-health-item" *ngFor="let item of securityChecks()">
                <span class="vs-dot" [class.vs-dot--green]="item.ok" [class.vs-dot--red]="!item.ok"></span>
                <div class="sa-health-info">
                  <div style="font-weight:700;">{{ item.title }}</div>
                  <div style="font-size:12px;color:var(--text-muted);">{{ item.detail }}</div>
                </div>
              </div>
            </div>
          </section>

          <section class="vs-glass-strong sa-section">
            <div class="vs-panel-head">
              <div class="vs-panel-title">Platform Control</div>
              <mat-icon class="sa-icon">bolt</mat-icon>
            </div>
            <div class="vs-panel-body" style="display:flex;flex-direction:column;gap:10px;">
              <button class="vs-btn-ghost" (click)="activeTab.set('organization')">
                <mat-icon>add_business</mat-icon> Create or Edit Organization
              </button>
              <button class="vs-btn-ghost" (click)="activeTab.set('user')">
                <mat-icon>person_add</mat-icon> Provision or Adjust User
              </button>
              <button class="vs-btn-ghost" (click)="activeTab.set('security')">
                <mat-icon>security</mat-icon> Review Security Alerts
              </button>
              <button class="vs-btn-ghost" (click)="activeTab.set('governance')">
                <mat-icon>policy</mat-icon> Open Governance Center
              </button>
              <button class="vs-btn-ghost" (click)="activeTab.set('troubleshooting')">
                <mat-icon>report_problem</mat-icon> Open Troubleshooting Feed
              </button>
            </div>
          </section>
        </div>

        <section class="vs-glass-strong sa-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Revenue by Plan (MRR)</div>
              <div class="vs-panel-subtitle">Estimated from list pricing × active paying orgs — not a live Stripe amount (self-serve checkout isn't wired up yet, plans are set manually)</div>
            </div>
            <mat-icon class="sa-icon">payments</mat-icon>
          </div>
          <div class="vs-panel-body">
            <div class="sa-mrr-total">
              <span class="vs-stat-label">Estimated Monthly Recurring Revenue</span>
              <strong>{{ billingSummary().totalMrrUsd | currency:'USD':'symbol':'1.0-0' }}</strong>
            </div>
            <table class="sa-mrr-table">
              <thead>
                <tr><th>Plan</th><th>Active orgs</th><th>Price / mo</th><th>Subtotal</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of billingSummary().rows">
                  <td>{{ row.plan | titlecase }}</td>
                  <td>{{ row.activeCount }}</td>
                  <td>{{ row.priceUsd == null ? 'Custom' : (row.priceUsd | currency:'USD':'symbol':'1.0-0') + '/mo' }}</td>
                  <td>{{ row.plan === 'enterprise' ? '—' : (row.mrrUsd | currency:'USD':'symbol':'1.0-0') }}</td>
                </tr>
              </tbody>
            </table>
            <div class="sa-mrr-notes">
              <span *ngIf="billingSummary().enterpriseActiveCount > 0">{{ billingSummary().enterpriseActiveCount }} active enterprise account(s) on custom pricing — contact billing records for actual amount, not included above.</span>
              <span *ngIf="billingSummary().trialingCount > 0">{{ billingSummary().trialingCount }} org(s) currently trialing — not yet counted as revenue.</span>
            </div>
          </div>
        </section>
      </div>

      <div *ngIf="activeTab() === 'organization'">
        <section class="vs-glass-strong sa-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Create Organization</div>
              <div class="vs-panel-subtitle">Provision a new tenant on the platform</div>
            </div>
            <mat-icon class="sa-icon">add_business</mat-icon>
          </div>
          <div class="vs-panel-body">
            <div class="vs-form-row vs-form-row--3">
              <div>
                <label class="vs-field-label" for="sa-org-id">Org ID (slug) *</label>
                <input id="sa-org-id" class="vs-input" [(ngModel)]="newOrgId" placeholder="ACME_001">
              </div>
              <div>
                <label class="vs-field-label" for="sa-org-name">Organization Name *</label>
                <input id="sa-org-name" class="vs-input" [(ngModel)]="newOrgName" placeholder="Acme Healthcare Inc.">
              </div>
              <div>
                <label class="vs-field-label" for="sa-plan">Initial Plan</label>
                <select id="sa-plan" class="vs-select" [(ngModel)]="newOrgPlan">
                  <option *ngFor="let p of plans" [value]="p">{{ p | titlecase }}</option>
                </select>
              </div>
            </div>

            <div class="vs-form-row vs-form-row--3">
              <div>
                <label class="vs-field-label" for="sa-bootstrap-email">First Admin Email (optional)</label>
                <input id="sa-bootstrap-email" class="vs-input" [(ngModel)]="bootstrapAdminEmail" placeholder="admin@acme.com">
              </div>
              <div>
                <label class="vs-field-label" for="sa-bootstrap-name">First Admin Name</label>
                <input id="sa-bootstrap-name" class="vs-input" [(ngModel)]="bootstrapAdminDisplayName" placeholder="Org Admin">
              </div>
              <div>
                <label class="vs-field-label" for="sa-bootstrap-job">First Admin Job Role</label>
                <select id="sa-bootstrap-job" class="vs-select" [(ngModel)]="bootstrapAdminJobRole">
                  <option *ngFor="let j of jobRoles" [value]="j">{{ j }}</option>
                </select>
              </div>
            </div>

            <div class="vs-form-row vs-form-row--3">
              <div>
                <label class="vs-field-label" for="sa-new-country">Country / Jurisdiction</label>
                <select id="sa-new-country" class="vs-select" [(ngModel)]="newOrgCountryCode">
                  <option *ngFor="let c of countries" [value]="c.code">{{ c.label }}</option>
                </select>
              </div>
              <div>
                <label class="vs-field-label" for="sa-new-currency">Currency</label>
                <select id="sa-new-currency" class="vs-select" [(ngModel)]="newOrgCurrencyCode">
                  <option *ngFor="let c of currencies" [value]="c.code">{{ c.label }}</option>
                </select>
              </div>
              <div>
                <label class="vs-field-label" for="sa-new-pay-frequency">Payment Cycle</label>
                <select id="sa-new-pay-frequency" class="vs-select" [(ngModel)]="newOrgPayFrequency">
                  <option *ngFor="let f of payFrequencies" [value]="f.value">{{ f.label }}</option>
                </select>
              </div>
            </div>

            <div class="vs-form-row vs-form-row--2">
              <div>
                <label class="vs-field-label" for="sa-new-tax">Tax Profile</label>
                <select id="sa-new-tax" class="vs-select" [(ngModel)]="newOrgTaxProfile" (ngModelChange)="onNewOrgTaxProfileChange($event)">
                  <option *ngFor="let t of taxProfiles" [value]="t.value">{{ t.label }}</option>
                </select>
                <div class="sa-help">{{ taxProfileDescription(newOrgTaxProfile) }}</div>
              </div>
              <div>
                <label class="vs-field-label" for="sa-new-tax-notes">Tax Notes</label>
                <input id="sa-new-tax-notes" class="vs-input" [(ngModel)]="newOrgPayrollTaxNotes" placeholder="Local accountant, statutory notes, external payroll provider">
              </div>
            </div>

            <div class="sa-form-actions">
              <div *ngIf="orgMsg()" class="sa-msg sa-msg--ok"><mat-icon>check_circle</mat-icon> {{ orgMsg() }}</div>
              <div *ngIf="orgInviteLink()" class="sa-link-box">
                <div class="sa-link-box__title">Bootstrap admin password setup link</div>
                <div class="sa-link-box__row">
                  <input class="vs-input" [value]="orgInviteLink()!" readonly>
                  <button class="vs-btn-ghost" type="button" (click)="copyOrgInviteLink()">Copy</button>
                </div>
              </div>
              <button class="vs-btn-primary sa-btn" (click)="createOrg()" [disabled]="busyOrg() || !newOrgId || !newOrgName">
                <mat-icon>add</mat-icon> Create Organization
              </button>
            </div>
          </div>
        </section>

        <section class="vs-glass-strong sa-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Organization Directory</div>
              <div class="vs-panel-subtitle">Search, select, and manage organizations</div>
            </div>
            <div class="sa-head-actions">
              <input class="vs-input sa-search" [(ngModel)]="orgSearch" placeholder="Search orgs, plans, industries">
              <span class="vs-badge vs-badge--neutral">{{ filteredOrgs().length }} orgs</span>
            </div>
          </div>

          <div *ngIf="filteredOrgs().length === 0" class="sa-empty">
            <mat-icon>business</mat-icon>
            No organizations found.
          </div>

          <div *ngIf="filteredOrgs().length > 0" class="sa-org-grid">
            <button *ngFor="let o of filteredOrgs()" class="sa-org-card" [class.sa-org-card--selected]="selectedOrgId() === o.orgId" (click)="selectOrg(o.orgId)">
              <div class="sa-org-card__top">
                <div>
                  <div class="sa-org-name">{{ o.name }}</div>
                  <div class="sa-org-meta">{{ o.orgId }}</div>
                </div>
                <span class="vs-dot" [class.vs-dot--green]="o.active !== false" [class.vs-dot--red]="o.active === false"></span>
              </div>
              <div class="sa-org-card__chips">
                <span class="vs-badge {{ planBadge(o.plan) }}">{{ (o.plan || 'free') | titlecase }}</span>
                <span class="vs-badge vs-badge--neutral">{{ (o.planStatus || 'active') | titlecase }}</span>
                <span class="vs-badge vs-badge--neutral">{{ o.industry || 'Unknown' }}</span>
              </div>
            </button>
          </div>

          <div class="sa-org-editor" *ngIf="selectedOrgId()">
            <div class="vs-panel-head" style="padding-inline:0;">
              <div>
                <div class="vs-panel-title">Organization Settings</div>
                <div class="vs-panel-subtitle">Edit plan, billing status, and operational limits</div>
              </div>
              <div class="sa-head-actions">
                <button class="vs-btn-ghost" type="button" (click)="toggleOrgActive(false)" [disabled]="orgDraft.active === false">Freeze</button>
                <button class="vs-btn-ghost" type="button" (click)="toggleOrgActive(true)" [disabled]="orgDraft.active !== false">Activate</button>
              </div>
            </div>

            <div class="vs-form-row vs-form-row--3">
              <div>
                <label class="vs-field-label">Organization Name</label>
                <input class="vs-input" [(ngModel)]="orgDraft.name">
              </div>
              <div>
                <label class="vs-field-label">Industry</label>
                <select class="vs-select" [(ngModel)]="orgDraft.industry">
                  <option *ngFor="let i of industries" [value]="i">{{ i }}</option>
                </select>
              </div>
              <div>
                <label class="vs-field-label">Timezone</label>
                <input class="vs-input" [(ngModel)]="orgDraft.timezone">
              </div>
            </div>

            <div class="vs-form-row vs-form-row--3">
              <div>
                <label class="vs-field-label">Contact Email</label>
                <input class="vs-input" type="email" [(ngModel)]="orgDraft.contactEmail">
              </div>
              <div>
                <label class="vs-field-label">Plan</label>
                <select class="vs-select" [(ngModel)]="orgDraft.plan">
                  <option *ngFor="let p of plans" [value]="p">{{ p | titlecase }}</option>
                </select>
              </div>
              <div>
                <label class="vs-field-label">Plan Status</label>
                <select class="vs-select" [(ngModel)]="orgDraft.planStatus">
                  <option *ngFor="let s of planStatuses" [value]="s">{{ s | titlecase }}</option>
                </select>
              </div>
            </div>

            <div class="vs-form-row vs-form-row--3">
              <div>
                <label class="vs-field-label">Country / Jurisdiction</label>
                <select class="vs-select" [(ngModel)]="orgDraft.countryCode">
                  <option *ngFor="let c of countries" [value]="c.code">{{ c.label }}</option>
                </select>
              </div>
              <div>
                <label class="vs-field-label">Currency</label>
                <select class="vs-select" [(ngModel)]="orgDraft.currencyCode">
                  <option *ngFor="let c of currencies" [value]="c.code">{{ c.label }}</option>
                </select>
              </div>
              <div>
                <label class="vs-field-label">Payment Cycle</label>
                <select class="vs-select" [(ngModel)]="orgDraft.payFrequency">
                  <option *ngFor="let f of payFrequencies" [value]="f.value">{{ f.label }}</option>
                </select>
              </div>
            </div>

            <div class="vs-form-row vs-form-row--2">
              <div>
                <label class="vs-field-label">Tax Profile</label>
                <select class="vs-select" [(ngModel)]="orgDraft.taxProfile" (ngModelChange)="onOrgDraftTaxProfileChange($event)">
                  <option *ngFor="let t of taxProfiles" [value]="t.value">{{ t.label }}</option>
                </select>
                <div class="sa-help">{{ taxProfileDescription(orgDraft.taxProfile) }}</div>
              </div>
              <div>
                <label class="vs-field-label">Payroll Tax Notes</label>
                <input class="vs-input" [(ngModel)]="orgDraft.payrollTaxNotes" placeholder="Local statutory notes or external provider">
              </div>
            </div>

            <div class="vs-form-row vs-form-row--3">
              <div>
                <label class="vs-field-label">Max Employees</label>
                <input class="vs-input" type="number" [(ngModel)]="orgDraft.maxEmployees">
              </div>
              <div>
                <label class="vs-field-label">Default Pay Rate ({{ orgDraft.currencyCode }}/hr)</label>
                <input class="vs-input" type="number" [(ngModel)]="orgDraft.defaultPayRate">
              </div>
              <div>
                <label class="vs-field-label">Status</label>
                <input class="vs-input" [value]="orgDraft.active === false ? 'Inactive' : 'Active'" disabled>
              </div>
            </div>

            <div class="sa-form-actions">
              <div *ngIf="orgMsg()" class="sa-msg sa-msg--ok"><mat-icon>check_circle</mat-icon> {{ orgMsg() }}</div>
              <button class="vs-btn-primary sa-btn" type="button" (click)="saveSelectedOrg()" [disabled]="busyOrg() || !selectedOrgId()">
                <mat-icon>save</mat-icon> Save Organization
              </button>
            </div>
          </div>
        </section>

        <section class="vs-glass-strong sa-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Organization Directory</div>
              <div class="vs-panel-subtitle">All tenants on the platform</div>
            </div>
          </div>

          <div *ngIf="orgs().length === 0" class="sa-empty">
            <mat-icon>business</mat-icon>
            No organizations yet. Create one above.
          </div>

          <div *ngIf="orgs().length > 0">
            <div class="sa-table-toolbar">
              <input
                class="vs-input sa-table-search"
                type="search"
                placeholder="Search org ID, name, plan, or industry…"
                [value]="orgsTableCtrl.filterText()"
                (input)="orgsTableCtrl.setFilter($any($event.target).value)">
            </div>
            <div class="vs-table-shell">
              <table class="vs-table">
                <thead>
                  <tr>
                    <th class="sa-th-sort" (click)="orgsTableCtrl.toggleSort('orgId')">Org ID {{ orgsTableCtrl.sortIndicator('orgId') }}</th>
                    <th class="sa-th-sort" (click)="orgsTableCtrl.toggleSort('name')">Name {{ orgsTableCtrl.sortIndicator('name') }}</th>
                    <th class="sa-th-sort" (click)="orgsTableCtrl.toggleSort('plan')">Plan {{ orgsTableCtrl.sortIndicator('plan') }}</th>
                    <th>Status</th>
                    <th class="sa-th-sort" (click)="orgsTableCtrl.toggleSort('industry')">Industry {{ orgsTableCtrl.sortIndicator('industry') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngIf="orgsTableCtrl.pageRows().length === 0" class="vs-empty">
                    <td colspan="5">No organizations match your search.</td>
                  </tr>
                  <tr *ngFor="let o of orgsTableCtrl.pageRows()" class="vs-row" (click)="selectOrg(o.orgId)" style="cursor:pointer;">
                    <td><span class="vs-strong sa-orgid">{{ o.orgId }}</span></td>
                    <td>{{ o.name }}</td>
                    <td><span class="vs-badge {{ planBadge(o.plan) }}">{{ (o.plan || 'free') | titlecase }}</span></td>
                    <td>
                      <span class="vs-dot" [class.vs-dot--green]="o.active !== false" [class.vs-dot--red]="o.active === false"></span>
                      {{ (o.active !== false) ? 'Active' : 'Inactive' }}
                    </td>
                    <td>{{ o.industry || 'Unknown' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <app-table-paginator [controller]="orgsTableCtrl"></app-table-paginator>
          </div>
        </section>
      </div>

      <div *ngIf="activeTab() === 'user'">
        <section class="vs-glass-strong sa-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">User Provisioning</div>
              <div class="vs-panel-subtitle">Look up a user and assign org, access role, job role, or platform role</div>
            </div>
            <mat-icon class="sa-icon">manage_accounts</mat-icon>
          </div>
          <div class="vs-panel-body">
            <div class="vs-form-row vs-form-row--2">
              <div>
                <label class="vs-field-label" for="sa-email">Email Address *</label>
                <input id="sa-email" class="vs-input" type="email" [(ngModel)]="lookupEmail" placeholder="user@example.com">
              </div>
              <div style="display:flex;align-items:flex-end;">
                <button class="vs-btn-ghost sa-lookup-btn" (click)="lookup()" [disabled]="busyLookup() || !lookupEmail">
                  <mat-icon>search</mat-icon>
                  {{ busyLookup() ? 'Looking up…' : 'Look Up User' }}
                </button>
              </div>
            </div>

            <div *ngIf="lookupResult()" class="sa-user-result vs-glass">
              <ng-container *ngIf="lookupResult()!.found !== false; else userMissing">
                <div class="sa-user-avatar">{{ initials(lookupResult()!) }}</div>
                <div class="sa-user-info">
                  <div class="sa-user-name">{{ lookupResult()!.displayName || '(no display name)' }}</div>
                  <div class="sa-user-email">{{ lookupResult()!.email }}</div>
                  <div class="sa-user-uid">Account located</div>
                  <div class="sa-user-uid">Current organization: {{ lookupOrgLabel(lookupResult()!.orgId) }} · Role: {{ lookupResult()!.accessRole || 'none' }} · Job: {{ lookupResult()!.jobRole || 'none' }}</div>
                </div>
              </ng-container>
              <ng-template #userMissing>
                <div class="sa-user-avatar"><mat-icon>person_off</mat-icon></div>
                <div class="sa-user-info">
                  <div class="sa-user-name">No account found</div>
                  <div class="sa-user-email">{{ lookupResult()!.email }}</div>
                  <div class="sa-user-uid">Ask this person to create an account first, then return here to assign the organization and role.</div>
                </div>
              </ng-template>
            </div>

            <div *ngIf="lookupResult() && lookupResult()!.found !== false" class="sa-provision">
              <div class="vs-form-row vs-form-row--3">
                <div>
                  <label class="vs-field-label" for="sa-prov-org">Target Organization Code *</label>
                  <input id="sa-prov-org" class="vs-input" [(ngModel)]="provOrgId" placeholder="ACME_001">
                </div>
                <div>
                  <label class="vs-field-label" for="sa-prov-role">Access Role</label>
                  <select id="sa-prov-role" class="vs-select" [(ngModel)]="provAccessRole">
                    <option *ngFor="let r of accessRoles" [value]="r">{{ r }}</option>
                  </select>
                </div>
                <div>
                  <label class="vs-field-label" for="sa-prov-job">Job Role</label>
                  <select id="sa-prov-job" class="vs-select" [(ngModel)]="provJobRole">
                    <option *ngFor="let j of jobRoles" [value]="j">{{ j }}</option>
                  </select>
                </div>
              </div>

              <label class="sa-super-toggle">
                <input type="checkbox" [(ngModel)]="makeSuperAdmin">
                <span>Grant <strong>platformRole = superAdmin</strong> (use with extreme caution)</span>
              </label>

              <div *ngIf="lookupResult()?.orgId" class="sa-org-actions">
                <div class="vs-form-row vs-form-row--2">
                  <div>
                    <label class="vs-field-label">Transfer to Organization Code</label>
                    <input class="vs-input" [(ngModel)]="membershipTargetOrgId" placeholder="ACME_002">
                  </div>
                  <div>
                    <label class="vs-field-label">Reason / Note</label>
                    <input class="vs-input" [(ngModel)]="membershipReason" placeholder="Left org / moved to another site">
                  </div>
                </div>
                <div class="sa-org-actions__buttons">
                  <button class="vs-btn-ghost" type="button" (click)="revokeSelectedUser()" [disabled]="membershipBusy()">
                    <mat-icon>block</mat-icon> Revoke from Current Org
                  </button>
                  <button class="vs-btn-primary sa-btn" type="button" (click)="transferSelectedUser()" [disabled]="membershipBusy() || !membershipTargetOrgId.trim()">
                    <mat-icon>swap_horiz</mat-icon> Transfer to Another Org
                  </button>
                </div>
                <div *ngIf="membershipMsg()" class="sa-msg sa-msg--ok"><mat-icon>check_circle</mat-icon> {{ membershipMsg() }}</div>
              </div>

              <div class="sa-form-actions">
                <div *ngIf="provMsg()" class="sa-msg sa-msg--ok"><mat-icon>check_circle</mat-icon> {{ provMsg() }}</div>
                <button class="vs-btn-primary sa-btn" (click)="provision()" [disabled]="busyProv() || !provOrgId">
                  <mat-icon>how_to_reg</mat-icon>
                  Provision User
                </button>
              </div>
            </div>

            <div class="sa-transfer-queue" *ngIf="transferRequests().length > 0 || busyTransferRequests()">
              <div class="vs-panel-head" style="padding-inline:0;">
                <div>
                  <div class="vs-panel-title">Pending Transfer Requests</div>
                  <div class="vs-panel-subtitle">Org-admin requests waiting for platform approval</div>
                </div>
                <button class="vs-btn-ghost" type="button" (click)="loadTransferRequests()" [disabled]="busyTransferRequests()">
                  <mat-icon [class.sa-spin]="busyTransferRequests()">refresh</mat-icon> Refresh
                </button>
              </div>

              <div *ngIf="transferRequestMsg()" class="sa-msg sa-msg--ok"><mat-icon>check_circle</mat-icon> {{ transferRequestMsg() }}</div>

              <div *ngIf="transferRequests().length === 0 && !busyTransferRequests()" class="sa-empty">
                <mat-icon>swap_horiz</mat-icon>
                No pending transfer requests.
              </div>

              <div *ngFor="let req of transferRequests()" class="sa-transfer-request">
                <div>
                  <div class="sa-org-name">{{ req.userDisplayName || req.userEmail || 'Employee' }}</div>
                  <div class="sa-org-meta">{{ req.userEmail || 'Email not set' }} · {{ lookupOrgLabel(req.fromOrgId) }} → {{ lookupOrgLabel(req.toOrgId) }}</div>
                  <div class="sa-org-meta">Requested by {{ req.requestedByEmail || 'Organization admin' }} · {{ fmtDate(req.createdAt) }}</div>
                  <div class="sa-triage-note" *ngIf="req.reason" style="margin:8px 0 0;">{{ req.reason }}</div>
                </div>
                <div class="sa-org-actions__buttons">
                  <button class="vs-btn-ghost" type="button" (click)="rejectTransferRequest(req)" [disabled]="busyTransferRequests()">
                    <mat-icon>close</mat-icon> Reject
                  </button>
                  <button class="vs-btn-primary sa-btn" type="button" (click)="approveTransferRequest(req)" [disabled]="busyTransferRequests()">
                    <mat-icon>check</mat-icon> Approve
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div *ngIf="activeTab() === 'security'">
        <div class="vs-grid-2">
          <section class="vs-glass-strong sa-section">
            <div class="vs-panel-head">
              <div class="vs-panel-title">Security Controls</div>
              <mat-icon class="sa-icon">security</mat-icon>
            </div>
            <div class="vs-panel-body">
              <div class="sa-health-item" *ngFor="let item of securityChecks()">
                <span class="vs-dot" [class.vs-dot--green]="item.ok" [class.vs-dot--red]="!item.ok"></span>
                <div class="sa-health-info">
                  <div style="font-weight:700;">{{ item.title }}</div>
                  <div style="font-size:12px;color:var(--text-muted);">{{ item.detail }}</div>
                </div>
              </div>
            </div>
          </section>

          <section class="vs-glass-strong sa-section">
            <div class="vs-panel-head">
              <div class="vs-panel-title">Risk Queue</div>
              <mat-icon class="sa-icon">report_problem</mat-icon>
            </div>
            <div class="vs-panel-body">
              <div *ngIf="riskOrgs().length === 0" class="sa-empty">
                <mat-icon>check_circle</mat-icon>
                No obvious platform risk detected from the current org feed.
              </div>
              <div *ngFor="let o of riskOrgs()" class="sa-risk-item" (click)="selectOrg(o.orgId)">
                <div>
                  <div class="sa-org-name">{{ o.name }}</div>
                  <div class="sa-org-meta">{{ o.orgId }} · {{ o.planStatus || 'active' }} · {{ o.industry || 'Unknown' }}</div>
                </div>
                <span class="vs-badge vs-badge--warning">Review</span>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div *ngIf="activeTab() === 'governance'">
        <section class="vs-glass-strong sa-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Tenant Health Board</div>
              <div class="vs-panel-subtitle">Operational readiness across billing, plan status, and finance setup</div>
            </div>
            <button class="vs-btn-ghost" (click)="exportPlatformSnapshot()">
              <mat-icon>download</mat-icon> Export Snapshot
            </button>
          </div>
          <div class="vs-table-shell">
            <table class="vs-table">
              <thead>
                <tr>
                  <th class="sa-th-sort" (click)="governanceOrgsCtrl.toggleSort('name')">Organization {{ governanceOrgsCtrl.sortIndicator('name') }}</th>
                  <th class="sa-th-sort" (click)="governanceOrgsCtrl.toggleSort('health')">Health {{ governanceOrgsCtrl.sortIndicator('health') }}</th>
                  <th class="sa-th-sort" (click)="governanceOrgsCtrl.toggleSort('plan')">Plan {{ governanceOrgsCtrl.sortIndicator('plan') }}</th>
                  <th>Finance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr class="vs-empty" *ngIf="orgs().length === 0">
                  <td colspan="5">No organizations available for health review.</td>
                </tr>
                <tr *ngFor="let org of governanceOrgsCtrl.pageRows()" class="vs-row">
                  <td>
                    <strong>{{ org.name || org.orgId }}</strong>
                    <div class="vs-muted">{{ org.orgId }}</div>
                  </td>
                  <td>
                    <span class="vs-badge" [ngClass]="tenantHealthBadge(org)">
                      {{ tenantHealthScore(org) }}%
                    </span>
                  </td>
                  <td>
                    <span class="vs-badge" [ngClass]="planBadge(org.plan)">{{ org.plan || 'free' }}</span>
                    <span class="vs-badge" [class.vs-badge--success]="(org.planStatus || 'active') === 'active'" [class.vs-badge--warning]="(org.planStatus || 'active') !== 'active'">{{ org.planStatus || 'active' }}</span>
                  </td>
                  <td>{{ financeSummary(org) }}</td>
                  <td>
                    <button class="vs-btn-ghost" (click)="selectOrg(org.orgId); activeTab.set('organization')">
                      <mat-icon>tune</mat-icon> Manage
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <app-table-paginator *ngIf="orgs().length > 0" [controller]="governanceOrgsCtrl"></app-table-paginator>
        </section>

        <div class="vs-grid-2">
          <section class="vs-glass-strong sa-section">
            <div class="vs-panel-head">
              <div>
                <div class="vs-panel-title">Tenant Lifecycle Control</div>
                <div class="vs-panel-subtitle">Freeze, reactivate, upgrade, downgrade, or package evidence for the selected tenant</div>
              </div>
              <mat-icon class="sa-icon">policy</mat-icon>
            </div>
            <div class="vs-panel-body">
              <div class="sa-selected-tenant" *ngIf="selectedOrg() as selected; else noGovernanceOrg">
                <div>
                  <div class="sa-org-name">{{ selected.name || selected.orgId }}</div>
                  <div class="sa-org-meta">{{ selected.orgId }} · {{ selected.plan || 'free' }} · {{ selected.planStatus || 'active' }}</div>
                </div>
                <span class="vs-badge" [class.vs-badge--success]="selected.active !== false" [class.vs-badge--danger]="selected.active === false">
                  {{ selected.active === false ? 'Frozen' : 'Active' }}
                </span>
              </div>
              <ng-template #noGovernanceOrg>
                <div class="sa-empty"><mat-icon>business</mat-icon>Select an organization to govern.</div>
              </ng-template>

              <div class="sa-action-grid">
                <button class="vs-btn-ghost" type="button" (click)="setSelectedOrgStatus('trialing')" [disabled]="!selectedOrgId() || busyOrg()">
                  <mat-icon>schedule</mat-icon> Mark Trialing
                </button>
                <button class="vs-btn-ghost" type="button" (click)="setSelectedOrgStatus('past_due')" [disabled]="!selectedOrgId() || busyOrg()">
                  <mat-icon>credit_card_off</mat-icon> Mark Past Due
                </button>
                <button class="vs-btn-ghost" type="button" (click)="setSelectedOrgStatus('active')" [disabled]="!selectedOrgId() || busyOrg()">
                  <mat-icon>verified</mat-icon> Mark Active
                </button>
                <button class="vs-btn-ghost" type="button" (click)="setSelectedOrgPlan('enterprise')" [disabled]="!selectedOrgId() || busyOrg()">
                  <mat-icon>workspace_premium</mat-icon> Upgrade Enterprise
                </button>
                <button class="vs-btn-ghost" type="button" (click)="toggleOrgActive(false)" [disabled]="!selectedOrgId() || busyOrg()">
                  <mat-icon>lock</mat-icon> Freeze Tenant
                </button>
                <button class="vs-btn-ghost" type="button" (click)="toggleOrgActive(true)" [disabled]="!selectedOrgId() || busyOrg()">
                  <mat-icon>lock_open</mat-icon> Reactivate Tenant
                </button>
                <button class="vs-btn-primary sa-btn" type="button" (click)="copySelectedOrgGovernancePack()" [disabled]="!selectedOrgId()">
                  <mat-icon>content_copy</mat-icon> Copy Support Pack
                </button>
                <button class="vs-btn-secondary" type="button" (click)="exportPlatformSnapshot()">
                  <mat-icon>download</mat-icon> Export Platform Snapshot
                </button>
              </div>
            </div>
          </section>

          <section class="vs-glass-strong sa-section">
            <div class="vs-panel-head">
              <div>
                <div class="vs-panel-title">Governance Board</div>
                <div class="vs-panel-subtitle">Operating checks for SaaS readiness</div>
              </div>
              <mat-icon class="sa-icon">fact_check</mat-icon>
            </div>
            <div class="vs-panel-body">
              <div class="sa-governance-row" *ngFor="let item of governanceChecks()">
                <span class="vs-dot" [class.vs-dot--green]="item.ok" [class.vs-dot--red]="!item.ok"></span>
                <div>
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.detail }}</span>
                </div>
              </div>
            </div>
          </section>
        </div>

        <section class="vs-glass-strong sa-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Plan Mix & Risk Actions</div>
              <div class="vs-panel-subtitle">Commercial and operational visibility across tenants</div>
            </div>
          </div>
          <div class="sa-plan-mix">
            <div class="sa-plan-tile" *ngFor="let plan of plans">
              <span>{{ plan | titlecase }}</span>
              <strong>{{ planCount(plan) }}</strong>
            </div>
            <div class="sa-plan-tile sa-plan-tile--risk">
              <span>Needs Review</span>
              <strong>{{ riskOrgs().length }}</strong>
            </div>
          </div>
        </section>
      </div>

      <div *ngIf="activeTab() === 'troubleshooting'">
        <div class="vs-grid-2">
          <section class="vs-glass-strong sa-section">
            <div class="vs-panel-head">
              <div class="vs-panel-title">Troubleshooting Feed</div>
              <mat-icon class="sa-icon">support_agent</mat-icon>
            </div>
            <div class="vs-panel-body">
              <div class="vs-form-row vs-form-row--2">
                <div>
                  <label class="vs-field-label">Search logs</label>
                  <input class="vs-input" [ngModel]="auditSearch()" (ngModelChange)="auditSearch.set($event)" placeholder="shift, invite, claim, permission...">
                </div>
                <div style="display:flex;align-items:flex-end;gap:8px;">
                  <button class="vs-btn-ghost" type="button" (click)="loadAuditLogs()" [disabled]="busyAudit()">
                    <mat-icon [class.sa-spin]="busyAudit()">refresh</mat-icon> Refresh
                  </button>
                </div>
              </div>

              <div class="sa-triage-note">
                Use this view to isolate failed invites, permission denials, billing events, and tenant-level anomalies before escalating.
              </div>

              <div *ngFor="let log of filteredAuditLogs() | slice:0:12" class="sa-triage-item">
                <div class="sa-triage-item__head">
                  <span class="vs-badge vs-badge--neutral">{{ log.action }}</span>
                  <span class="sa-triage-time">{{ fmtDate(log.createdAt) }}</span>
                </div>
                <div class="sa-triage-item__body">{{ lookupOrgLabel(log.orgId) }} · {{ auditActor(log) }} · {{ log.details | json }}</div>
              </div>
            </div>
          </section>

          <section class="vs-glass-strong sa-section">
            <div class="vs-panel-head">
              <div class="vs-panel-title">Runbook</div>
              <mat-icon class="sa-icon">menu_book</mat-icon>
            </div>
            <div class="vs-panel-body" style="display:flex;flex-direction:column;gap:10px;">
              <div class="sa-runbook-card">
                <strong>Invite failed</strong>
                <span>Check orgId claim, access role, and whether the email already exists in another tenant.</span>
              </div>
              <div class="sa-runbook-card">
                <strong>Shift claim denied</strong>
                <span>Verify the staff job role matches the shift requirements and the org plan is active.</span>
              </div>
              <div class="sa-runbook-card">
                <strong>Billing issue</strong>
                <span>Review planStatus, Stripe portal state, and whether the org should be frozen until resolved.</span>
              </div>
              <div class="sa-runbook-card">
                <strong>Security incident</strong>
                <span>Freeze the org, deactivate the compromised user, then inspect the audit feed and claims.</span>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div *ngIf="activeTab() === 'audit'">
        <section class="vs-glass-strong sa-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Audit Log</div>
              <div class="vs-panel-subtitle">Global event history across all organizations</div>
            </div>
            <button class="vs-btn-secondary" (click)="loadAuditLogs()" [disabled]="busyAudit()">
              <mat-icon [class.sa-spin]="busyAudit()">refresh</mat-icon> Refresh Logs
            </button>
          </div>

          <div *ngIf="auditLogs().length === 0" class="sa-empty">
            <mat-icon>history</mat-icon>
            {{ busyAudit() ? 'Loading logs...' : 'No audit logs found.' }}
          </div>

          <div *ngIf="auditLogs().length > 0" class="vs-table-shell">
            <table class="vs-table">
              <thead>
                <tr>
                  <th class="sa-th-sort" (click)="auditCtrl.toggleSort('time')">Time {{ auditCtrl.sortIndicator('time') }}</th>
                  <th>Org</th>
                  <th class="sa-th-sort" (click)="auditCtrl.toggleSort('action')">Action {{ auditCtrl.sortIndicator('action') }}</th>
                  <th>Actor</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngIf="auditCtrl.pageRows().length === 0" class="vs-empty">
                  <td colspan="5">No audit logs match your search.</td>
                </tr>
                <tr *ngFor="let log of auditCtrl.pageRows()" class="vs-row sa-log-row">
                  <td class="vs-muted" style="white-space:nowrap;">{{ fmtDate(log.createdAt) }}</td>
                  <td><span class="vs-strong sa-orgid">{{ lookupOrgLabel(log.orgId) }}</span></td>
                  <td><span class="vs-badge vs-badge--neutral">{{ log.action }}</span></td>
                  <td class="vs-muted">{{ auditActor(log) }}</td>
                  <td class="sa-log-details">{{ log.details | json }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <app-table-paginator *ngIf="auditLogs().length > 0" [controller]="auditCtrl"></app-table-paginator>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .sa-kpis { margin-bottom: 20px; }
    .sa-section { margin-bottom: 20px; overflow: hidden; }
    .sa-health-strip {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      margin: 0 0 20px;
    }
    .sa-health-strip article {
      min-height: 118px;
      border: 1px solid rgba(15,23,42,0.12);
      border-radius: 8px;
      background: rgba(255,255,255,0.94);
      box-shadow: 0 12px 30px rgba(15,23,42,0.07);
      padding: 16px;
      display: grid;
      align-content: start;
      gap: 6px;
    }
    .sa-health-strip mat-icon { color: #047857; }
    .sa-health-strip span { color: #64748b; font-size: 11px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
    .sa-health-strip strong { color: #0f172a; font-size: 30px; line-height: 1; }
    .sa-health-strip small { color: #475569; line-height: 1.35; }
    .sa-mrr-total { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; }
    .sa-mrr-total .vs-stat-label { color: var(--text-subtle); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; }
    .sa-mrr-total strong { font-size: 32px; font-weight: 900; color: var(--text); }
    .sa-mrr-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .sa-mrr-table th { text-align: left; color: var(--text-subtle); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; padding: 8px 10px; border-bottom: 1px solid var(--border); }
    .sa-mrr-table td { padding: 10px; border-bottom: 1px solid var(--border); color: var(--text); }
    .sa-mrr-notes { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; color: var(--text-muted); font-size: 12px; }
    .sa-icon { color: var(--text-subtle); }
    .sa-head-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .sa-search { min-width: 260px; }

    .sa-form-actions { display: flex; align-items: center; gap: 12px; margin-top: 4px; flex-wrap: wrap; }
    .sa-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px !important; }
    .sa-lookup-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px !important; font-size: 13px !important; width: 100%; }
    .sa-help { font-size: 12px; color: var(--text-muted); margin-top: 4px; }

    .sa-link-box { min-width: 320px; padding: 12px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--panel); }
    .sa-link-box__title { font-size: 12px; font-weight: 700; color: var(--text-muted); margin-bottom: 8px; }
    .sa-link-box__row { display: flex; gap: 8px; align-items: center; }
    .sa-link-box__row .vs-input { flex: 1; }

    .sa-org-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin-top: 10px; margin-bottom: 16px; }
    .sa-org-card { text-align: left; border: 1px solid var(--border); background: var(--panel); border-radius: var(--radius-md); padding: 14px; cursor: pointer; transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease; }
    .sa-org-card:hover { transform: translateY(-2px); border-color: var(--border-strong); box-shadow: var(--shadow); }
    .sa-org-card--selected { border-color: rgba(99,102,241,0.6); box-shadow: 0 0 0 1px rgba(99,102,241,0.20) inset; }
    .sa-org-card__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .sa-org-name { font-weight: 800; color: var(--text); }
    .sa-org-meta { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
    .sa-org-card__chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
    .sa-org-editor { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }

    .sa-risk-item { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 14px; border-radius: var(--radius-sm); background: rgba(255,255,255,0.03); border: 1px solid var(--border); margin-bottom: 8px; cursor: pointer; }
    .sa-risk-item:hover { border-color: var(--border-strong); }

    .sa-selected-tenant { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:14px; border:1px solid var(--border); background:rgba(255,255,255,0.04); border-radius:var(--radius-sm); margin-bottom:12px; }
    .sa-action-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; }
    .sa-action-grid button { justify-content:center; display:inline-flex; align-items:center; gap:8px; }
    .sa-governance-row { display:flex; align-items:flex-start; gap:12px; padding:12px 0; border-bottom:1px solid var(--border); }
    .sa-governance-row:last-child { border-bottom:0; }
    .sa-governance-row div { display:grid; gap:3px; }
    .sa-governance-row strong { color:var(--text); }
    .sa-governance-row span:not(.vs-dot) { color:var(--text-muted); font-size:12px; }
    .sa-plan-mix { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:12px; padding:16px; }
    .sa-plan-tile { border:1px solid var(--border); background:rgba(255,255,255,0.03); border-radius:var(--radius-sm); padding:14px; display:grid; gap:6px; }
    .sa-plan-tile span { color:var(--text-muted); font-size:12px; font-weight:800; text-transform:uppercase; }
    .sa-plan-tile strong { color:var(--text); font-size:28px; line-height:1; }
    .sa-plan-tile--risk { border-color:rgba(245,158,11,0.45); background:rgba(245,158,11,0.08); }

    .sa-triage-note { padding: 12px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: rgba(255,255,255,0.03); color: var(--text-muted); font-size: 13px; margin-bottom: 10px; }
    .sa-triage-item { padding: 12px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: rgba(255,255,255,0.03); margin-bottom: 8px; }
    .sa-triage-item__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
    .sa-triage-time { font-size: 12px; color: var(--text-muted); }
    .sa-triage-item__body { font-size: 12px; color: var(--text-muted); font-family: monospace; word-break: break-word; }
    .sa-runbook-card { padding: 12px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: rgba(255,255,255,0.03); display: flex; flex-direction: column; gap: 4px; }
    .sa-runbook-card strong { color: var(--text); }
    .sa-runbook-card span { color: var(--text-muted); font-size: 13px; }

    .sa-msg { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; }
    .sa-msg mat-icon { font-size: 16px !important; }
    .sa-msg--ok { background: rgba(34,197,94,0.12); color: #86efac; border: 1px solid rgba(34,197,94,0.25); }
    .sa-msg--err { background: rgba(239,68,68,0.12); color: #fca5a5; border: 1px solid rgba(239,68,68,0.25); }

    .sa-empty { display: flex; align-items: center; gap: 10px; padding: 20px 24px; color: var(--text-muted); }
    .sa-orgid { font-family: monospace; font-size: 13px; }
    .sa-th-sort { cursor: pointer; user-select: none; }
    .sa-th-sort:hover { color: var(--primary, #07533f); }
    .sa-table-toolbar { padding: 12px 16px 0; }
    .sa-table-search { width: 100%; max-width: 320px; }

    .sa-user-result { display: flex; align-items: center; gap: 14px; padding: 16px 18px; margin-bottom: 16px; border-radius: var(--radius-md) !important; }
    .sa-user-avatar { width: 44px; height: 44px; border-radius: 14px; background: linear-gradient(135deg, var(--primary), var(--accent)); display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 900; color: #fff; flex-shrink: 0; }
    .sa-user-name { font-size: 15px; font-weight: 800; color: var(--text); }
    .sa-user-email { font-size: 13px; color: var(--text-muted); }
    .sa-user-uid { font-size: 11px; color: var(--text-subtle); font-family: monospace; }

    .sa-provision { border-top: 1px solid var(--border); padding-top: 16px; }
    .sa-transfer-queue { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 12px; }
    .sa-transfer-request { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 14px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: rgba(255,255,255,0.03); }
    .sa-org-actions { margin: 12px 0 4px; padding: 14px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: rgba(255,255,255,0.03); display: flex; flex-direction: column; gap: 10px; }
    .sa-org-actions__buttons { display: flex; gap: 10px; flex-wrap: wrap; }
    .sa-super-toggle { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-muted); cursor: pointer; margin-bottom: 12px; }
    .sa-super-toggle input { cursor: pointer; }
    .sa-super-toggle strong { color: var(--danger); }

    .sa-tabs { display: flex; gap: 4px; margin-bottom: 24px; padding: 4px; background: rgba(255,255,255,0.03); border-radius: var(--radius-md); border: 1px solid var(--border); width: fit-content; }
    .sa-tab { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border: none; background: transparent; color: var(--text-muted); font-size: 14px; font-weight: 600; cursor: pointer; border-radius: var(--radius-sm); transition: all 0.2s; }
    .sa-tab:hover { color: var(--text); background: rgba(255,255,255,0.05); }
    .sa-tab--active { color: #fff; background: var(--primary) !important; box-shadow: var(--shadow-sm); }
    .sa-tab mat-icon { font-size: 18px !important; width: 18px; height: 18px; }

    .sa-health-item { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: var(--radius-sm); background: rgba(255,255,255,0.02); margin-bottom: 8px; }
    .sa-health-info { flex: 1; }

    .sa-log-row { font-size: 13px; }
    .sa-log-details { font-family: monospace; font-size: 11px; color: var(--text-subtle); max-width: 300px; overflow: hidden; text-overflow: ellipsis; }

    @media (max-width: 900px) {
      .sa-action-grid { grid-template-columns:1fr; }
      .sa-tabs { width:100%; overflow-x:auto; }
      .sa-tab { white-space:nowrap; }
      .sa-health-strip { grid-template-columns:1fr; }
    }

    @keyframes sa-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .sa-spin { animation: sa-spin 1s linear infinite; }
  `]
})
export class SuperAdminDashboardPage implements OnInit, OnDestroy {
  orgs = signal<OrgDirectoryItem[]>([]);
  orgsTableCtrl = new TableListController<OrgDirectoryItem>(this.orgs, {
    pageSize: 25,
    filterPredicate: (o, q) => `${o.orgId} ${o.name} ${o.plan || ''} ${o.industry || ''}`.toLowerCase().includes(q),
    sortAccessor: (o, key) => {
      if (key === 'orgId') return o.orgId.toLowerCase();
      if (key === 'name') return String(o.name || '').toLowerCase();
      if (key === 'plan') return String(o.plan || '').toLowerCase();
      if (key === 'industry') return String(o.industry || '').toLowerCase();
      return null;
    },
  });
  governanceOrgsCtrl = new TableListController<OrgDirectoryItem>(this.orgs, {
    pageSize: 25,
    sortAccessor: (o, key) => {
      if (key === 'name') return String(o.name || o.orgId || '').toLowerCase();
      if (key === 'health') return this.tenantHealthScore(o);
      if (key === 'plan') return String(o.plan || '').toLowerCase();
      return null;
    },
  });
  private unsub: (() => void) | null = null;
  orgLoading = signal(false);
  orgLoadError = signal(false);

  activeTab = signal<'overview' | 'organization' | 'user' | 'security' | 'governance' | 'troubleshooting' | 'audit'>('overview');
  selectedOrgId = signal<string | null>(null);
  orgSearch = '';
  auditSearch = signal('');
  orgDraft: OrgDraft = { ...DEFAULT_ORG_DRAFT };

  newOrgId = '';
  newOrgName = '';
  newOrgPlan: typeof PLANS[number] = 'free';
  newOrgCountryCode = 'US';
  newOrgCurrencyCode = 'USD';
  newOrgPayFrequency: PayFrequency = 'biweekly';
  newOrgTaxProfile: TaxProfileId = 'us_federal_state';
  newOrgPayrollTaxNotes = '';
  busyOrg = signal(false);
  orgMsg = signal<string | null>(null);
  orgInviteLink = signal<string | null>(null);
  bootstrapAdminEmail = '';
  bootstrapAdminDisplayName = '';
  bootstrapAdminJobRole = 'Manager';

  lookupEmail = '';
  busyLookup = signal(false);
  lookupResult = signal<any | null>(null);
  membershipTargetOrgId = '';
  membershipReason = '';
  membershipBusy = signal(false);
  membershipMsg = signal<string | null>(null);
  transferRequests = signal<any[]>([]);
  busyTransferRequests = signal(false);
  transferRequestMsg = signal<string | null>(null);

  provOrgId = '';
  provAccessRole: typeof ACCESS_ROLES[number] = 'staff';
  provJobRole = 'RN';
  makeSuperAdmin = false;
  busyProv = signal(false);
  provMsg = signal<string | null>(null);

  auditLogs = signal<any[]>([]);
  busyAudit = signal(false);

  plans = PLANS;
  accessRoles = ACCESS_ROLES;
  jobRoles = JOB_ROLES;
  industries = INDUSTRIES;
  planStatuses = PLAN_STATUSES;
  countries = COUNTRIES;
  currencies = CURRENCY_OPTIONS;
  payFrequencies = PAY_FREQUENCY_OPTIONS;
  taxProfiles = TAX_PROFILE_OPTIONS;

  filteredOrgs = computed(() => {
    const q = this.orgSearch.trim().toLowerCase();
    if (!q) return this.orgs();
    return this.orgs().filter((o) =>
      [o.orgId, o.name, o.plan, o.planStatus, (o as any).industry, (o as any).contactEmail]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  });

  filteredAuditLogs = computed(() => {
    const q = this.auditSearch().trim().toLowerCase();
    if (!q) return this.auditLogs();
    return this.auditLogs().filter((log) => JSON.stringify(log).toLowerCase().includes(q));
  });

  auditCtrl = new TableListController<any>(this.filteredAuditLogs, {
    pageSize: 25,
    sortAccessor: (log, key) => {
      if (key === 'time') return log.createdAt?.toMillis ? log.createdAt.toMillis() : Number(log.createdAt || 0);
      if (key === 'action') return String(log.action || '').toLowerCase();
      return null;
    },
  });

  selectedOrg = computed(() => this.orgs().find((o) => o.orgId === this.selectedOrgId()) || null);

  activeOrgs = () => this.orgs().filter((o) => o.active !== false).length;
  freeOrgs = () => this.orgs().filter((o) => !o.plan || o.plan === 'free').length;
  atRiskOrgs = () => this.orgs().filter((o) => o.active !== false && ((o.planStatus || 'active') !== 'active' || !o.plan || o.plan === 'free'));
  riskOrgs = () => this.orgs().filter((o) => o.active !== false && ((o.planStatus || 'active') !== 'active' || !o.plan || o.plan === 'free'));
  planCount = (plan: string) => this.orgs().filter((o) => (o.plan || 'free') === plan).length;

  billingReadyOrgs() {
    return this.orgs().filter((o) =>
      o.active !== false &&
      (o.planStatus || 'active') === 'active' &&
      !!o.plan &&
      o.plan !== 'free'
    ).length;
  }

  countryCount() {
    return new Set(this.orgs().map((o: any) => String(o.countryCode || '').trim()).filter(Boolean)).size;
  }

  billingSummary = computed(() => computeBillingSummary(this.orgs(), PLAN_MONTHLY_PRICE_USD));

  platformHealthScore() {
    const orgs = this.orgs();
    if (!orgs.length) return 0;
    const avg = orgs.reduce((sum, org) => sum + this.tenantHealthScore(org), 0) / orgs.length;
    return Math.round(avg);
  }

  tenantHealthScore(org: OrgDirectoryItem) {
    let score = 100;
    const data: any = org;
    if (org.active === false) score -= 35;
    if ((org.planStatus || 'active') !== 'active') score -= 25;
    if (!org.plan || org.plan === 'free') score -= 20;
    if (!data.currencyCode) score -= 7;
    if (!data.payFrequency) score -= 7;
    if (!data.taxProfile) score -= 6;
    return Math.max(0, Math.min(100, score));
  }

  tenantHealthBadge(org: OrgDirectoryItem) {
    const score = this.tenantHealthScore(org);
    if (score >= 85) return 'vs-badge--success';
    if (score >= 60) return 'vs-badge--warning';
    return 'vs-badge--danger';
  }

  financeSummary(org: OrgDirectoryItem) {
    const data: any = org;
    return [
      data.currencyCode || 'No currency',
      data.payFrequency || 'No cycle',
      data.taxProfile || 'No tax profile',
    ].join(' / ');
  }

  planBadge(plan?: string) {
    const m: Record<string, string> = {
      free: 'vs-badge--neutral', starter: 'vs-badge--primary',
      pro: 'vs-badge--success', enterprise: 'vs-badge--warning',
    };
    return m[plan ?? 'free'] ?? 'vs-badge--neutral';
  }

  taxProfileDescription(profile: string) {
    return this.taxProfiles.find((item) => item.value === profile)?.description ?? 'Manual tax profile.';
  }

  onNewOrgTaxProfileChange(profile: string) {
    if (!this.newOrgCurrencyCode || this.newOrgCurrencyCode === 'USD') {
      this.newOrgCurrencyCode = defaultCurrencyForTaxProfile(profile);
    }
  }

  onOrgDraftTaxProfileChange(profile: string) {
    if (!this.orgDraft.currencyCode || this.orgDraft.currencyCode === 'USD') {
      this.orgDraft.currencyCode = defaultCurrencyForTaxProfile(profile);
    }
  }

  lookupOrgLabel(orgId?: string | null): string {
    const id = String(orgId || '').trim();
    if (!id) return 'None';
    const org = this.orgs().find((item) => item.orgId === id);
    return org?.name ? `${org.name} (${id})` : id;
  }

  auditActor(log: any): string {
    return log?.actorName || log?.actorEmail || 'System or admin';
  }

  initials(u: any): string {
    const name = u.displayName || u.email || 'User';
    const parts = String(name).split(/[\s@.]+/);
    return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : String(name).slice(0, 2).toUpperCase();
  }

  fmtDate(value: any): string {
    const date = this.toDate(value);
    if (!date) return 'Not recorded';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  private toDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'string') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value?.toDate === 'function') {
      const date = value.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    }
    const seconds = Number(value.seconds ?? value._seconds);
    if (Number.isFinite(seconds)) {
      const date = new Date(seconds * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  constructor(private repo: OrgDirectoryRepo, private sa: SuperAdminService, private toast: ToastService) {
    this.reloadOrgs();
    this.loadAuditLogs();
    this.loadTransferRequests();
  }

  ngOnInit() {
    void this.ensureSelectedOrg();
  }

  reloadOrgs() {
    this.unsub?.();
    this.orgLoading.set(true);
    this.orgLoadError.set(false);
    this.unsub = this.repo.watchOrgs((items) => {
      if (items.length > 0 || this.orgs().length === 0) this.orgs.set(items);
      this.orgLoading.set(false);
      void this.ensureSelectedOrg();
    }, 500, () => {
      this.orgLoading.set(false);
      this.orgLoadError.set(true);
    });
  }

  async loadAuditLogs() {
    this.busyAudit.set(true);
    try {
      this.auditLogs.set(await this.sa.getAuditLogs(100));
    } catch (e: any) {
      console.error('Audit load failed', e);
      this.toast.errorFrom(e, 'Audit load failed.');
    } finally {
      this.busyAudit.set(false);
    }
  }

  async loadTransferRequests() {
    this.busyTransferRequests.set(true);
    try {
      this.transferRequests.set(await this.sa.getUserTransferRequests(50, 'pending'));
    } catch (e: any) {
      this.toast.errorFrom(e, 'Transfer request load failed.');
    } finally {
      this.busyTransferRequests.set(false);
    }
  }

  async createOrg() {
    this.orgMsg.set(null);
    this.orgInviteLink.set(null);
    this.busyOrg.set(true);
    try {
      const res: any = await this.sa.createOrg({
        orgId: this.newOrgId.trim(),
        name: this.newOrgName.trim(),
        plan: this.newOrgPlan,
        countryCode: this.newOrgCountryCode,
        currencyCode: this.newOrgCurrencyCode,
        payFrequency: this.newOrgPayFrequency,
        taxProfile: this.newOrgTaxProfile,
        payrollTaxNotes: this.newOrgPayrollTaxNotes.trim() || undefined,
        bootstrapAdminEmail: this.bootstrapAdminEmail.trim() || undefined,
        bootstrapAdminDisplayName: this.bootstrapAdminDisplayName.trim() || undefined,
        bootstrapAdminJobRole: this.bootstrapAdminJobRole,
      });

      if (res?.bootstrapAdminUid) {
        this.orgMsg.set(`Organization "${this.newOrgName}" created with first admin (${this.bootstrapAdminEmail || res.bootstrapAdminUid}).`);
        this.orgInviteLink.set(res.bootstrapAdminPasswordResetLink || null);
      } else {
        this.orgMsg.set(`Organization "${this.newOrgName}" created with plan: ${this.newOrgPlan}.`);
      }

      this.newOrgId = '';
      this.newOrgName = '';
      this.newOrgPlan = 'free';
      this.newOrgCountryCode = 'US';
      this.newOrgCurrencyCode = 'USD';
      this.newOrgPayFrequency = 'biweekly';
      this.newOrgTaxProfile = 'us_federal_state';
      this.newOrgPayrollTaxNotes = '';
      this.bootstrapAdminEmail = '';
      this.bootstrapAdminDisplayName = '';
      this.bootstrapAdminJobRole = 'Manager';
      this.activeTab.set('organization');
      this.reloadOrgs();
      setTimeout(() => this.orgMsg.set(null), 5000);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Create org failed.');
    } finally {
      this.busyOrg.set(false);
    }
  }

  async copyOrgInviteLink() {
    const link = this.orgInviteLink();
    if (!link) return;
    await navigator.clipboard.writeText(link);
    this.toast.success('Bootstrap admin link copied.');
  }

  async selectOrg(orgId: string) {
    this.selectedOrgId.set(orgId);
    await this.loadSelectedOrg(orgId);
  }

  async ensureSelectedOrg() {
    const first = this.orgs()[0];
    if (first && !this.selectedOrgId()) {
      await this.selectOrg(first.orgId);
    }
  }

  async loadSelectedOrg(orgId: string) {
    try {
      const data: any = this.orgs().find((org) => org.orgId === orgId) || {};
      this.orgDraft = {
        name: String(data.name || '').trim(),
        industry: String(data.industry || 'Healthcare').trim() || 'Healthcare',
        timezone: String(data.timezone || 'America/New_York').trim() || 'America/New_York',
        contactEmail: String(data.contactEmail || '').trim(),
        plan: (data.plan || 'free') as typeof PLANS[number],
        planStatus: (data.planStatus || 'active') as typeof PLAN_STATUSES[number],
        countryCode: String(data.countryCode || 'US').trim() || 'US',
        currencyCode: String(data.currencyCode || 'USD').trim().toUpperCase() || 'USD',
        payFrequency: (data.payFrequency || 'biweekly') as PayFrequency,
        taxProfile: (data.taxProfile || 'us_federal_state') as TaxProfileId,
        payrollTaxNotes: String(data.payrollTaxNotes || '').trim(),
        maxEmployees: Number(data.maxEmployees || 25),
        defaultPayRate: Number(data.defaultPayRate || 40),
        active: data.active !== false,
      };
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to load organization settings.');
    }
  }

  async saveSelectedOrg() {
    const orgId = this.selectedOrgId();
    if (!orgId) return;

    this.busyOrg.set(true);
    try {
      const payload = {
        orgId,
        name: this.orgDraft.name.trim(),
        industry: this.orgDraft.industry,
        timezone: this.orgDraft.timezone,
        contactEmail: this.orgDraft.contactEmail.trim(),
        plan: this.orgDraft.plan,
        planStatus: this.orgDraft.planStatus,
        countryCode: String(this.orgDraft.countryCode || 'US').trim(),
        currencyCode: String(this.orgDraft.currencyCode || 'USD').trim().toUpperCase(),
        payFrequency: this.orgDraft.payFrequency || 'biweekly',
        taxProfile: this.orgDraft.taxProfile || 'manual',
        payrollTaxNotes: String(this.orgDraft.payrollTaxNotes || '').trim(),
        maxEmployees: Number(this.orgDraft.maxEmployees || 0),
        defaultPayRate: Number(this.orgDraft.defaultPayRate || 0),
        active: this.orgDraft.active,
      };

      await this.sa.updateOrg(payload);

      this.orgMsg.set(`Organization "${payload.name || orgId}" saved.`);
      this.reloadOrgs();
      setTimeout(() => this.orgMsg.set(null), 4500);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to save organization settings.');
    } finally {
      this.busyOrg.set(false);
    }
  }

  async toggleOrgActive(active: boolean) {
    this.orgDraft.active = active;
    await this.saveSelectedOrg();
  }

  async lookup() {
    this.provMsg.set(null);
    this.lookupResult.set(null);
    this.busyLookup.set(true);
    try {
      const result = await this.sa.lookupUserByEmail(this.lookupEmail.trim());
      if (result?.found === false) {
        this.lookupResult.set(result);
        this.toast.info('No user found for this email. Ask the staff member to create an account first, then retry lookup.');
        return;
      }
      this.lookupResult.set(result);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Lookup failed.');
    } finally {
      this.busyLookup.set(false);
    }
  }

  async provision() {
    const uid = this.lookupResult()?.uid;
    if (!uid) return;

    this.provMsg.set(null);
    this.busyProv.set(true);
    try {
      await this.sa.setUserClaims({
        uid,
        orgId: this.provOrgId.trim(),
        accessRole: this.provAccessRole,
        jobRole: this.provJobRole,
        active: true,
        platformRole: this.makeSuperAdmin ? 'superAdmin' : null,
      });
      this.provMsg.set(`Provisioned ${this.lookupResult().email} → ${this.provOrgId} as ${this.provAccessRole}/${this.provJobRole}.`);
      setTimeout(() => this.provMsg.set(null), 6000);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Provision failed.');
    } finally {
      this.busyProv.set(false);
    }
  }

  async revokeSelectedUser() {
    const user = this.lookupResult();
    if (!user?.uid) return;

    this.membershipBusy.set(true);
    this.membershipMsg.set(null);
    try {
      await this.sa.manageUserMembership({
        uid: user.uid,
        action: 'revoke',
        orgId: user.orgId || this.provOrgId || undefined,
        reason: this.membershipReason.trim() || undefined,
      });
      this.membershipMsg.set(`User ${user.email} was revoked from the organization.`);
      await this.lookup();
    } catch (e: any) {
      this.toast.errorFrom(e, 'Revoke failed.');
    } finally {
      this.membershipBusy.set(false);
    }
  }

  async transferSelectedUser() {
    const user = this.lookupResult();
    if (!user?.uid) return;

    const toOrgId = this.membershipTargetOrgId.trim();
    if (!toOrgId) {
      this.toast.error('Target org is required for transfer.');
      return;
    }

    this.membershipBusy.set(true);
    this.membershipMsg.set(null);
    try {
      await this.sa.manageUserMembership({
        uid: user.uid,
        action: 'transfer',
        orgId: user.orgId || undefined,
        toOrgId,
        accessRole: user.accessRole || 'staff',
        jobRole: user.jobRole || 'RN',
        reason: this.membershipReason.trim() || undefined,
      });
      this.membershipMsg.set(`User ${user.email} moved to ${toOrgId}.`);
      await this.lookup();
    } catch (e: any) {
      this.toast.errorFrom(e, 'Transfer failed.');
    } finally {
      this.membershipBusy.set(false);
    }
  }

  async approveTransferRequest(request: any) {
    this.busyTransferRequests.set(true);
    this.transferRequestMsg.set(null);
    try {
      await this.sa.reviewUserTransferRequest({
        requestId: request.requestId,
        decision: 'approve',
      });
      this.transferRequestMsg.set(`Transfer approved for ${request.userEmail || request.uid}.`);
      await this.loadTransferRequests();
    } catch (e: any) {
      this.toast.errorFrom(e, 'Transfer approval failed.');
    } finally {
      this.busyTransferRequests.set(false);
    }
  }

  async rejectTransferRequest(request: any) {
    const reviewNote = window.prompt('Optional rejection note', '')?.trim() || undefined;

    this.busyTransferRequests.set(true);
    this.transferRequestMsg.set(null);
    try {
      await this.sa.reviewUserTransferRequest({
        requestId: request.requestId,
        decision: 'reject',
        reviewNote,
      });
      this.transferRequestMsg.set(`Transfer rejected for ${request.userEmail || request.uid}.`);
      await this.loadTransferRequests();
    } catch (e: any) {
      this.toast.errorFrom(e, 'Transfer rejection failed.');
    } finally {
      this.busyTransferRequests.set(false);
    }
  }

  async setSelectedOrgStatus(status: typeof PLAN_STATUSES[number]) {
    this.orgDraft.planStatus = status;
    await this.saveSelectedOrg();
    this.toast.success(`Organization marked ${status}.`);
  }

  async setSelectedOrgPlan(plan: typeof PLANS[number]) {
    this.orgDraft.plan = plan;
    if (this.orgDraft.planStatus === 'canceled') this.orgDraft.planStatus = 'active';
    await this.saveSelectedOrg();
    this.toast.success(`Organization moved to ${plan} plan.`);
  }

  async copySelectedOrgGovernancePack() {
    const org = this.selectedOrg();
    if (!org) return;

    const pack = {
      generatedAt: new Date().toISOString(),
      organization: {
        orgId: org.orgId,
        name: org.name,
        active: org.active !== false,
        plan: org.plan || 'free',
        planStatus: org.planStatus || 'active',
        industry: (org as any).industry || 'Unknown',
      },
      recommendedActions: this.recommendedOrgActions(org),
      supportChecklist: [
        'Confirm billing and planStatus before freezing or reactivating.',
        'Review global audit entries for the selected org.',
        'Verify root user claims and org user document match.',
        'Ask org admin to sign out and sign in after role changes.',
      ],
    };

    await navigator.clipboard.writeText(JSON.stringify(pack, null, 2));
    this.toast.success('Governance support pack copied.');
  }

  exportPlatformSnapshot() {
    const snapshot = {
      generatedAt: new Date().toISOString(),
      totals: {
        organizations: this.orgs().length,
        active: this.activeOrgs(),
        atRisk: this.riskOrgs().length,
        transfersPending: this.transferRequests().length,
      },
      planMix: Object.fromEntries(this.plans.map((plan) => [plan, this.planCount(plan)])),
      organizations: this.orgs().map((o) => ({
        orgId: o.orgId,
        name: o.name,
        active: o.active !== false,
        plan: o.plan || 'free',
        planStatus: o.planStatus || 'active',
        industry: (o as any).industry || null,
      })),
    };

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `innovashift-platform-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  recommendedOrgActions(org: OrgDirectoryItem): string[] {
    const actions: string[] = [];
    if (org.active === false) actions.push('Tenant is frozen. Confirm incident or billing resolution before reactivation.');
    if ((org.planStatus || 'active') !== 'active') actions.push(`Plan status is ${org.planStatus}. Review billing and service limits.`);
    if (!org.plan || org.plan === 'free') actions.push('Free plan tenant. Review conversion, limits, and support level.');
    if (!actions.length) actions.push('No immediate governance action required.');
    return actions;
  }

  securityChecks() {
    return [
      { title: 'Tenant isolation', ok: true, detail: 'Org-scoped access is enforced by claims and Firestore rules.' },
      { title: 'Plan gating', ok: this.atRiskOrgs().length === 0, detail: 'Inactive or canceled plans are visible above and can be frozen.' },
      { title: 'Audit trail', ok: this.auditLogs().length > 0, detail: 'Audit feed is loaded for incident response and compliance.' },
      { title: 'Provisioning control', ok: true, detail: 'Super-admin can provision users and assign platform roles.' },
    ];
  }

  governanceChecks() {
    return [
      {
        title: 'Tenant lifecycle controls',
        ok: true,
        detail: 'Selected tenants can be frozen, reactivated, upgraded, downgraded, and marked for billing review.',
      },
      {
        title: 'Support evidence packs',
        ok: true,
        detail: 'Super Admin can copy a tenant governance pack and export a platform snapshot for operations.',
      },
      {
        title: 'Risk visibility',
        ok: this.riskOrgs().length === 0,
        detail: `${this.riskOrgs().length} tenant(s) need review based on plan or billing status.`,
      },
      {
        title: 'Transfer governance',
        ok: this.transferRequests().length === 0,
        detail: `${this.transferRequests().length} membership transfer request(s) pending platform approval.`,
      },
    ];
  }

  ngOnDestroy() {
    if (this.unsub) this.unsub();
  }
}
