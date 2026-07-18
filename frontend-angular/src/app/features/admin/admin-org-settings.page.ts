import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ToastService } from '../../core/ui/toast.service';
import { PlanEntitlementsService } from '../../core/tenancy/plan-entitlements.service';
import {
  CURRENCY_OPTIONS,
  PAY_FREQUENCY_OPTIONS,
  TAX_PROFILE_OPTIONS,
  PayFrequency,
  TaxProfileId,
  defaultCurrencyForTaxProfile,
} from '../../core/tenancy/org-finance.model';
import {
  AccrualPolicy,
  AccrualTier,
  CADENCE_OPTIONS,
  DEFAULT_ACCRUAL_POLICY,
} from '../../core/tenancy/org-accrual.model';
import * as L from 'leaflet';

interface OrgSite {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  radiusM: number;
  active: boolean;
}

interface OrgIntegrationConfig {
  label: string;
  endpoint: string;
  active: boolean;
}

interface OrgSettings {
  name: string;
  industry: string;
  timezone: string;
  contactEmail: string;
  plan: string;
  planStatus: string;
  countryCode: string;
  currencyCode: string;
  payFrequency: PayFrequency;
  taxProfile: TaxProfileId;
  payrollTaxNotes: string;
  maxEmployees: number;
  defaultPayRate: number;
  breakRequiredAfterHours: number;
  minRequiredBreakMinutes: number;
  gpsAttendanceEnabled: boolean;
  sites: OrgSite[];
  accrualPolicy: AccrualPolicy;
  ssoEnabled: boolean;
  ssoProvider: string;
  integrationConfigs: OrgIntegrationConfig[];
  stripeCustomerId?: string;
  createdAt?: any;
  updatedAt?: any;
}

const DEFAULT_SETTINGS: OrgSettings = {
  name: '', industry: 'Healthcare', timezone: 'America/New_York',
  contactEmail: '', plan: 'free', planStatus: 'active', maxEmployees: 25,
  countryCode: 'US',
  currencyCode: 'USD',
  payFrequency: 'biweekly',
  taxProfile: 'us_federal_state',
  payrollTaxNotes: '',
  defaultPayRate: 40,
  breakRequiredAfterHours: 6,
  minRequiredBreakMinutes: 30,
  gpsAttendanceEnabled: false,
  sites: [],
  accrualPolicy: { ...DEFAULT_ACCRUAL_POLICY, tiers: DEFAULT_ACCRUAL_POLICY.tiers.map((t) => ({ ...t })) },
  ssoEnabled: false,
  ssoProvider: '',
  integrationConfigs: [],
};

const INDUSTRIES = [
  'Healthcare','Hospitality','Retail','Manufacturing',
  'Transportation','Education','Finance','Technology','Other',
];

const TIMEZONES = [
  'America/New_York','America/Chicago','America/Denver',
  'America/Los_Angeles','America/Phoenix','America/Anchorage','Pacific/Honolulu',
  'Europe/London','Europe/Paris','Africa/Douala','Africa/Lagos','Africa/Accra',
  'Africa/Nairobi','Africa/Johannesburg','Asia/Dubai','Asia/Tokyo','Australia/Sydney',
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

const PLAN_BADGE: Record<string, string> = {
  free: 'vs-badge--neutral', starter: 'vs-badge--primary',
  pro: 'vs-badge--success', enterprise: 'vs-badge--warning',
};

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule],
  template: `
    <div class="vs-page-pad">

      <!-- Header -->
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">Organization Settings</h1>
          <p class="vs-page-subtitle">Manage your organization's profile and configuration</p>
        </div>
        <div class="vs-page-actions">
          <span class="vs-badge {{ planBadge() }}">
            <mat-icon style="font-size:13px;">workspace_premium</mat-icon>
            {{ settings().plan | uppercase }} plan
          </span>
        </div>
      </div>

      <!-- No org -->
      <div *ngIf="!orgId" class="ors-no-org vs-glass">
        <mat-icon>warning_amber</mat-icon>
        No organization context. Contact a Super Admin.
      </div>

      <ng-container *ngIf="orgId">

        <!-- Profile section -->
        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Organization Profile</div>
              <div class="vs-panel-subtitle">Basic information about your organization</div>
            </div>
            <mat-icon class="ors-section-icon">business</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <div class="vs-form-row vs-form-row--2">
              <div>
                <label class="vs-field-label" for="ors-name">Organization Name *</label>
                <input id="ors-name" class="vs-input" [(ngModel)]="draft.name" placeholder="Acme Healthcare Inc.">
              </div>
              <div>
                <label class="vs-field-label" for="ors-email">Contact Email</label>
                <input id="ors-email" class="vs-input" type="email" [(ngModel)]="draft.contactEmail" placeholder="admin@example.com">
              </div>
            </div>
            <div class="vs-form-row vs-form-row--2">
              <div>
                <label class="vs-field-label" for="ors-industry">Industry</label>
                <select id="ors-industry" class="vs-select" [(ngModel)]="draft.industry">
                  <option *ngFor="let i of industries" [value]="i">{{ i }}</option>
                </select>
              </div>
              <div>
                <label class="vs-field-label" for="ors-tz">Timezone</label>
                <select id="ors-tz" class="vs-select" [(ngModel)]="draft.timezone">
                  <option *ngFor="let tz of timezones" [value]="tz">{{ tz }}</option>
                </select>
              </div>
            </div>
            
            <div class="vs-form-row vs-form-row--2" style="margin-top:16px;">
              <div>
                <label class="vs-field-label" for="ors-pay">Default Pay Rate ({{ draft.currencyCode }}/hr)</label>
                <input id="ors-pay" type="number" class="vs-input" [(ngModel)]="draft.defaultPayRate" placeholder="40.00">
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Applies automatically when creating new shifts</div>
              </div>
              <div>
                <label class="vs-field-label" for="ors-break-threshold">Break Required After</label>
                <select id="ors-break-threshold" class="vs-select" [(ngModel)]="draft.breakRequiredAfterHours">
                  <option [value]="4">4 hours</option>
                  <option [value]="6">6 hours</option>
                </select>
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Staff must take a break before checkout past this threshold</div>
              </div>
            </div>

            <div class="vs-form-row vs-form-row--2" style="margin-top:16px;">
              <div>
                <label class="vs-field-label" for="ors-break-min">Minimum Break Duration (minutes)</label>
                <input id="ors-break-min" type="number" class="vs-input" min="1" [(ngModel)]="draft.minRequiredBreakMinutes" placeholder="30">
              </div>
            </div>
          </div>
        </section>

        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Finance, Payroll & Tax</div>
              <div class="vs-panel-subtitle">Currency, pay cycle, and statutory payroll profile for this organization</div>
            </div>
            <mat-icon class="ors-section-icon">account_balance</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <div class="vs-form-row vs-form-row--3">
              <div>
                <label class="vs-field-label" for="ors-country">Country / Jurisdiction</label>
                <select id="ors-country" class="vs-select" [(ngModel)]="draft.countryCode">
                  <option *ngFor="let c of countries" [value]="c.code">{{ c.label }}</option>
                </select>
              </div>
              <div>
                <label class="vs-field-label" for="ors-currency">Currency</label>
                <select id="ors-currency" class="vs-select" [(ngModel)]="draft.currencyCode">
                  <option *ngFor="let c of currencies" [value]="c.code">{{ c.label }}</option>
                </select>
              </div>
              <div>
                <label class="vs-field-label" for="ors-pay-frequency">Payment Cycle</label>
                <select id="ors-pay-frequency" class="vs-select" [(ngModel)]="draft.payFrequency">
                  <option *ngFor="let f of payFrequencies" [value]="f.value">{{ f.label }}</option>
                </select>
              </div>
            </div>
            <div class="vs-form-row vs-form-row--2" style="margin-top:16px;">
              <div>
                <label class="vs-field-label" for="ors-tax-profile">Tax Profile</label>
                <select id="ors-tax-profile" class="vs-select" [(ngModel)]="draft.taxProfile" (ngModelChange)="onTaxProfileChange($event)">
                  <option *ngFor="let t of taxProfiles" [value]="t.value">{{ t.label }}</option>
                </select>
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">{{ taxProfileDescription(draft.taxProfile) }}</div>
              </div>
              <div>
                <label class="vs-field-label" for="ors-tax-notes">Payroll Tax Notes</label>
                <textarea id="ors-tax-notes" class="vs-input" rows="3" [(ngModel)]="draft.payrollTaxNotes" placeholder="Local statutory notes, accountant contact, external payroll provider..."></textarea>
              </div>
            </div>
          </div>
        </section>

        <!-- PTO Accrual Policy section -->
        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">PTO Accrual Policy</div>
              <div class="vs-panel-subtitle">Define how employees earn paid time off and sick time automatically</div>
            </div>
            <mat-icon class="ors-section-icon">event_available</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <label class="ors-toggle-row">
              <input type="checkbox" [(ngModel)]="draft.accrualPolicy.enabled">
              <div>
                <div class="ors-toggle-title">Enable automatic PTO accrual</div>
                <div class="vs-muted">When on, employee PTO/sick balances grow automatically on the schedule below, based on tenure.</div>
              </div>
            </label>

            <ng-container *ngIf="draft.accrualPolicy.enabled">
              <div class="vs-form-row vs-form-row--2" style="margin-top:16px;">
                <div>
                  <label class="vs-field-label" for="ors-accrual-cadence">Accrual Cadence</label>
                  <select id="ors-accrual-cadence" class="vs-select" [(ngModel)]="draft.accrualPolicy.cadence">
                    <option *ngFor="let c of cadenceOptions" [value]="c.value">{{ c.label }}</option>
                  </select>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">{{ cadenceDescription(draft.accrualPolicy.cadence) }}</div>
                </div>
                <div>
                  <label class="vs-field-label" for="ors-accrual-cap">Balance Cap (hours)</label>
                  <input id="ors-accrual-cap" class="vs-input" type="number" min="0" [(ngModel)]="draft.accrualPolicy.maxBalanceHours" placeholder="240">
                  <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Accrual grants stop once an employee's PTO balance reaches this cap.</div>
                </div>
              </div>

              <div class="ors-site-actions" style="justify-content:space-between; margin-top:16px;">
                <strong>Tenure Tiers</strong>
                <button class="vs-btn-ghost" (click)="addAccrualTier()" type="button">
                  <mat-icon>add</mat-icon> Add Tier
                </button>
              </div>

              <div class="ors-site-card" *ngFor="let tier of draft.accrualPolicy.tiers; index as i">
                <div class="vs-form-row vs-form-row--3">
                  <div>
                    <label class="vs-field-label">Min. Tenure (months)</label>
                    <input class="vs-input" type="number" min="0" [(ngModel)]="tier.minTenureMonths" placeholder="0">
                  </div>
                  <div>
                    <label class="vs-field-label">PTO Hours / Year</label>
                    <input class="vs-input" type="number" min="0" [(ngModel)]="tier.ptoHoursPerYear" placeholder="80">
                  </div>
                  <div>
                    <label class="vs-field-label">Sick Hours / Year</label>
                    <input class="vs-input" type="number" min="0" [(ngModel)]="tier.sickHoursPerYear" placeholder="40">
                  </div>
                </div>
                <div class="ors-site-footer">
                  <span class="vs-muted">Applies once an employee has this many months of tenure or more.</span>
                  <button class="vs-btn-ghost" type="button" (click)="removeAccrualTier(i)" [disabled]="draft.accrualPolicy.tiers.length <= 1">
                    <mat-icon>delete</mat-icon> Remove
                  </button>
                </div>
              </div>
            </ng-container>
          </div>
        </section>

        <!-- Subscription section -->
        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Subscription & Plan</div>
              <div class="vs-panel-subtitle">Your current plan limits and billing status</div>
            </div>
            <mat-icon class="ors-section-icon">credit_card</mat-icon>
          </div>
          <div class="vs-panel-body">
            <div class="ors-plan-grid">
              <div class="ors-plan-item vs-glass">
                <div class="vs-stat-label">Current Plan</div>
                <div class="ors-plan-val">{{ settings().plan | titlecase }}</div>
                <span class="vs-badge {{ planBadge() }}">{{ settings().planStatus }}</span>
              </div>
              <div class="ors-plan-item vs-glass">
                <div class="vs-stat-label">Max Employees</div>
                <div class="ors-plan-val">{{ settings().maxEmployees }}</div>
                <span class="vs-muted" style="font-size:12px;">seats included</span>
              </div>
              <div class="ors-plan-item vs-glass ors-plan-upgrade">
                <div class="vs-stat-label">Change Plan</div>
                <div class="ors-plan-choices">
                  <button class="vs-btn-ghost ors-plan-choice-btn" type="button" (click)="upgradeToPlan('starter')" [disabled]="billingBusy() || settings().plan === 'starter'">
                    <mat-icon>{{ billingBusy() ? 'hourglass_empty' : 'bolt' }}</mat-icon> Starter — $49/mo
                  </button>
                  <button class="vs-btn-primary ors-plan-choice-btn" type="button" (click)="upgradeToPlan('pro')" [disabled]="billingBusy() || settings().plan === 'pro'">
                    <mat-icon>{{ billingBusy() ? 'hourglass_empty' : 'workspace_premium' }}</mat-icon> Pro — $149/mo
                  </button>
                </div>
                <button class="vs-btn-ghost ors-upgrade-btn" type="button" (click)="manageBilling()" [disabled]="billingBusy() || !hasBillingCustomer()" *ngIf="hasBillingCustomer()">
                  <mat-icon>credit_card</mat-icon> Manage Subscription / Billing Portal
                </button>
                <span class="vs-muted" style="font-size:12px;">Need Enterprise or a custom plan? <a href="mailto:contact@innovacarereview.com">Contact sales</a>.</span>
              </div>
            </div>
          </div>
        </section>

        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Attendance Controls</div>
              <div class="vs-panel-subtitle">Configure GPS attendance and geofence policies</div>
            </div>
            <mat-icon class="ors-section-icon">pin_drop</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <div *ngIf="hasGpsAttendance(); else gpsUpgrade" class="ors-stack">
              <label class="ors-toggle-row">
                <input type="checkbox" [(ngModel)]="draft.gpsAttendanceEnabled">
                <div>
                  <div class="ors-toggle-title">Require GPS-verified attendance</div>
                  <div class="vs-muted">Staff will need approved browser geolocation within a configured site radius to clock in and out.</div>
                </div>
              </label>
            </div>
            <ng-template #gpsUpgrade>
              <div class="ors-upgrade-card">
                <mat-icon>workspace_premium</mat-icon>
                <div>
                  <strong>Pro feature</strong>
                  <div>GPS attendance and geofence enforcement unlock on Pro and Enterprise plans.</div>
                </div>
              </div>
            </ng-template>
          </div>
        </section>

        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Sites & Geofences</div>
              <div class="vs-panel-subtitle">Define the places where shifts can be scheduled and attendance can be verified</div>
            </div>
            <div class="ors-site-actions">
              <span class="vs-badge" [class.vs-badge--warning]="hasMultiSite()" [class.vs-badge--neutral]="!hasMultiSite()">
                {{ hasMultiSite() ? 'Enterprise multi-site' : 'Single-site mode' }}
              </span>
              <button class="vs-btn-ghost" (click)="addSite()" type="button" [disabled]="!canManageSites()">
                <mat-icon>add</mat-icon> Add Site
              </button>
            </div>
          </div>
          <div class="vs-panel-body ors-form">
            <div *ngIf="draft.sites.length === 0" class="ors-empty-site vs-glass">
              <mat-icon>location_off</mat-icon>
              <div>
                <strong>No sites configured.</strong>
                <div class="vs-muted">Add at least one site before enforcing GPS attendance.</div>
              </div>
            </div>

            <div class="ors-site-card" *ngFor="let site of draft.sites; index as i">
              <div class="ors-site-actions" style="justify-content:space-between;">
                <strong>Site {{ i + 1 }}</strong>
                <button class="vs-btn-ghost" type="button" (click)="selectSite(i)">
                  <mat-icon>map</mat-icon> Edit On Map
                </button>
              </div>
              <div class="vs-form-row vs-form-row--2">
                <div>
                  <label class="vs-field-label">Site Name *</label>
                  <input class="vs-input" [(ngModel)]="site.name" placeholder="Downtown Clinic">
                </div>
                <div>
                  <label class="vs-field-label">Address</label>
                  <input class="vs-input" [(ngModel)]="site.address" placeholder="123 Main St, Atlanta, GA">
                </div>
              </div>
              <div class="vs-form-row vs-form-row--3">
                <div>
                  <label class="vs-field-label">Latitude</label>
                  <input class="vs-input" type="number" [(ngModel)]="site.latitude" (ngModelChange)="onSiteRadiusChange()" placeholder="33.7490">
                </div>
                <div>
                  <label class="vs-field-label">Longitude</label>
                  <input class="vs-input" type="number" [(ngModel)]="site.longitude" (ngModelChange)="onSiteRadiusChange()" placeholder="-84.3880">
                </div>
                <div>
                  <label class="vs-field-label">Radius (meters)</label>
                  <input class="vs-input" type="number" min="25" [(ngModel)]="site.radiusM" (ngModelChange)="onSiteRadiusChange()" placeholder="150">
                </div>
              </div>
              <div class="ors-site-footer">
                <label class="ors-toggle-row">
                  <input type="checkbox" [(ngModel)]="site.active">
                  <div>
                    <div class="ors-toggle-title">Active site</div>
                    <div class="vs-muted">Only active sites are valid for GPS verification and shift assignment.</div>
                  </div>
                </label>
                <button class="vs-btn-ghost" type="button" (click)="removeSite(i)">
                  <mat-icon>delete</mat-icon> Remove
                </button>
              </div>
            </div>

            <div *ngIf="!canManageSites()" class="ors-upgrade-card">
              <mat-icon>lock</mat-icon>
              <div>
                <strong>Starter plan</strong>
                <div>Site and geofence configuration requires Pro for one site, Enterprise for multi-site operations.</div>
              </div>
            </div>

            <div class="ors-map-shell" *ngIf="canManageSites() && draft.sites.length > 0">
              <div class="vs-field-label">Geofence Map</div>
              <div class="vs-muted" style="margin-bottom:8px;">Click on the map to set latitude/longitude for the selected site.</div>
              <div #geofenceMap class="ors-map"></div>
            </div>
          </div>
        </section>

        <section class="vs-glass-strong ors-section" *ngIf="hasEnterpriseControls(); else enterpriseUpgrade">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Enterprise Access</div>
              <div class="vs-panel-subtitle">SSO and custom integration settings for enterprise deployments</div>
            </div>
            <mat-icon class="ors-section-icon">shield_lock</mat-icon>
          </div>
          <div class="vs-panel-body ors-form ors-stack">
            <label class="ors-toggle-row" *ngIf="hasSsoConfig()">
              <input type="checkbox" [(ngModel)]="draft.ssoEnabled">
              <div>
                <div class="ors-toggle-title">Enable SSO setup</div>
                <div class="vs-muted">Use this to prepare SAML/OIDC rollout with your implementation team.</div>
              </div>
            </label>

            <div *ngIf="hasSsoConfig()" class="vs-form-row">
              <div>
                <label class="vs-field-label">Identity Provider</label>
                <input class="vs-input" [(ngModel)]="draft.ssoProvider" placeholder="Okta, Azure AD, Ping, Google Workspace">
              </div>
            </div>

            <div *ngIf="hasCustomIntegrations()">
              <div class="ors-subhead">Custom Integrations</div>
              <div class="ors-site-card" *ngFor="let integration of draft.integrationConfigs; index as i">
                <div class="vs-form-row vs-form-row--2">
                  <div>
                    <label class="vs-field-label">Label</label>
                    <input class="vs-input" [(ngModel)]="integration.label" placeholder="Payroll Export">
                  </div>
                  <div>
                    <label class="vs-field-label">Endpoint or Notes</label>
                    <input class="vs-input" [(ngModel)]="integration.endpoint" placeholder="https://api.partner.com/push-shifts">
                  </div>
                </div>
                <div class="ors-site-footer">
                  <label class="ors-toggle-row">
                    <input type="checkbox" [(ngModel)]="integration.active">
                    <div>
                      <div class="ors-toggle-title">Enabled</div>
                      <div class="vs-muted">Use this as a deployment checklist before backend activation.</div>
                    </div>
                  </label>
                  <button class="vs-btn-ghost" type="button" (click)="removeIntegration(i)">
                    <mat-icon>delete</mat-icon> Remove
                  </button>
                </div>
              </div>
              <button class="vs-btn-ghost" type="button" (click)="addIntegration()">
                <mat-icon>add_link</mat-icon> Add Integration
              </button>
            </div>
          </div>
        </section>
        <ng-template #enterpriseUpgrade>
          <section class="vs-glass-strong ors-section">
            <div class="vs-panel-head">
              <div>
                <div class="vs-panel-title">Enterprise Access</div>
                <div class="vs-panel-subtitle">SSO and integrations are reserved for enterprise customers</div>
              </div>
              <mat-icon class="ors-section-icon">workspace_premium</mat-icon>
            </div>
            <div class="vs-panel-body">
              <div class="ors-upgrade-card">
                <mat-icon>workspace_premium</mat-icon>
                <div>
                  <strong>Enterprise feature set</strong>
                  <div>Unlock multi-site scheduling, SSO setup, and custom integrations on the Enterprise plan.</div>
                </div>
              </div>
            </div>
          </section>
        </ng-template>

        <!-- Save / feedback -->
        <div class="ors-save-row">
          <div *ngIf="saveMsg()" class="ors-msg ors-msg--ok">
            <mat-icon>check_circle</mat-icon> {{ saveMsg() }}
          </div>
          <button class="vs-btn-primary ors-save-btn"
                  (click)="save()"
                  [disabled]="saving() || !draft.name">
            <span *ngIf="!saving()"><mat-icon>save</mat-icon> Save Changes</span>
            <span *ngIf="saving()" class="ors-spinner"></span>
          </button>
        </div>

      </ng-container>
    </div>
  `,
  styles: [`
    .ors-no-org {
      display: flex; align-items: center; gap: 12px;
      padding: 20px 24px; color: var(--warning); font-weight: 600;
    }
    .ors-section {
      margin-bottom: 20px;
      overflow: hidden;
      border: 1px solid var(--border);
      box-shadow: 0 12px 28px rgba(2,6,23,0.25), inset 0 1px 0 rgba(255,255,255,0.04);
      position: relative;
    }
    .ors-section::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      background: linear-gradient(180deg, #0ea5e9, #22c55e);
      opacity: 0.9;
    }
    .ors-section-icon { color: var(--text-subtle); }
    .ors-form { padding-top: 0 !important; }

    .ors-plan-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
    }
    @media (max-width: 700px) { .ors-plan-grid { grid-template-columns: 1fr; } }

    .ors-plan-item {
      padding: 18px 20px;
      display: flex; flex-direction: column; gap: 6px;
      border-radius: var(--radius-md) !important;
      border: 1px solid var(--border);
    }
    .ors-plan-val { font-size: 22px; font-weight: 900; color: var(--text); }
    .ors-plan-upgrade { border: 1px solid rgba(99,102,241,0.30) !important; }
    .ors-upgrade-btn {
      margin-top: 4px;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 14px !important; font-size: 13px !important;
    }
    .ors-plan-choices { display: flex; flex-direction: column; gap: 6px; }
    .ors-plan-choice-btn {
      display: inline-flex; align-items: center; gap: 6px; justify-content: center;
      padding: 8px 14px !important; font-size: 13px !important;
    }
    .ors-plan-choice-btn mat-icon { font-size: 17px; width: 17px; height: 17px; }

    .ors-save-row {
      display: flex; align-items: center; justify-content: flex-end;
      gap: 14px; flex-wrap: wrap;
      margin-top: 4px;
    }
    .ors-stack { display:flex; flex-direction:column; gap:16px; }
    .ors-toggle-row {
      display:flex; gap:12px; align-items:flex-start; padding:14px 16px;
      border:1px solid var(--border); border-radius:var(--radius-md); background:rgba(255,255,255,0.02);
    }
    .ors-toggle-title { font-weight:800; color:var(--text); margin-bottom:4px; }
    .ors-upgrade-card {
      display:flex; gap:12px; align-items:flex-start; padding:14px 16px;
      border:1px dashed rgba(250,204,21,0.35); border-radius:var(--radius-md);
      background:rgba(250,204,21,0.12); color:#fde68a;
    }
    .ors-site-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .ors-empty-site { display:flex; gap:12px; align-items:flex-start; padding:16px; }
    .ors-site-card {
      border:1px solid var(--border); border-radius:var(--radius-md);
      padding:16px; display:flex; flex-direction:column; gap:14px;
      background:linear-gradient(135deg, rgba(2,132,199,0.10), rgba(30,41,59,0.16));
    }
    .ors-site-footer { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap; }
    .ors-map-shell { margin-top: 8px; }
    .ors-map {
      height: 300px;
      border-radius: var(--radius-md);
      border: 1px solid var(--border);
      overflow: hidden;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
    }
    .ors-subhead { font-weight:900; text-transform:uppercase; letter-spacing:0.08em; font-size:12px; color:var(--text-subtle); }
    .ors-msg {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 14px;
      border-radius: var(--radius-sm);
      font-size: 13px; font-weight: 600;
    }
    .ors-msg mat-icon { font-size: 16px !important; }
    .ors-msg--ok  { background: rgba(34,197,94,0.12); color: #86efac; border: 1px solid rgba(34,197,94,0.25); }
    .ors-msg--err { background: rgba(239,68,68,0.12); color: #fca5a5; border: 1px solid rgba(239,68,68,0.25); }

    .ors-save-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 10px 20px !important;
      min-width: 150px;
      justify-content: center;
    }
    .ors-spinner {
      display: inline-block; width: 16px; height: 16px;
      border: 2px solid rgba(255,255,255,0.30); border-top-color: #fff;
      border-radius: 50%; animation: orspin 0.7s linear infinite;
    }
    @keyframes orspin { to { transform: rotate(360deg); } }
  `]
})
export class AdminOrgSettingsPage implements OnInit, AfterViewInit, OnDestroy {
  orgId: string | null = null;
  settings  = signal<OrgSettings>({ ...DEFAULT_SETTINGS });
  draft: OrgSettings = { ...DEFAULT_SETTINGS };
  saving    = signal(false);
  saveMsg   = signal<string | null>(null);
  billingBusy = signal(false);

  industries = INDUSTRIES;
  timezones  = TIMEZONES;
  countries = COUNTRIES;
  currencies = CURRENCY_OPTIONS;
  payFrequencies = PAY_FREQUENCY_OPTIONS;
  taxProfiles = TAX_PROFILE_OPTIONS;
  selectedSiteIndex = 0;

  @ViewChild('geofenceMap') geofenceMap?: ElementRef<HTMLDivElement>;
  private map: L.Map | null = null;
  private marker: L.Marker | null = null;
  private circle: L.Circle | null = null;

  constructor(private ctx: OrgContextService, private toast: ToastService, private plans: PlanEntitlementsService) {
    this.orgId = this.ctx.orgId();
  }

  async ngOnInit() {
    this.handleBillingReturn();
    if (!this.orgId) return;
    try {
      const db = getFirestore();
      const snap = await getDoc(doc(db, 'orgs', this.orgId));
      if (snap.exists()) {
        const data = snap.data() as Partial<OrgSettings>;
        const loaded: OrgSettings = { ...DEFAULT_SETTINGS, ...data };
        this.settings.set(loaded);
        this.draft = { ...loaded };
        this.ctx.setContext({
          orgId: this.ctx.orgId(),
          uid: this.ctx.uid(),
          accessRole: this.ctx.accessRole(),
          platformRole: this.ctx.platformRole(),
          displayName: this.ctx.displayName(),
          email: this.ctx.email(),
          jobRole: this.ctx.jobRole(),
          plan: loaded.plan,
          planStatus: loaded.planStatus,
          countryCode: loaded.countryCode,
          currencyCode: loaded.currencyCode,
          payFrequency: loaded.payFrequency,
          taxProfile: loaded.taxProfile,
        });
        if (this.draft.sites.length > 0) {
          this.selectedSiteIndex = 0;
        }
      }
    } catch (e) { /* non-critical */ }
  }

  ngAfterViewInit() {
    setTimeout(() => this.ensureMapReady(), 0);
  }

  ngOnDestroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  planBadge() { return PLAN_BADGE[this.settings().plan] ?? 'vs-badge--neutral'; }
  taxProfileDescription(profile: string) {
    return this.taxProfiles.find((item) => item.value === profile)?.description ?? 'Manual tax profile.';
  }
  onTaxProfileChange(profile: string) {
    if (!this.draft.currencyCode || this.draft.currencyCode === 'USD') {
      this.draft.currencyCode = defaultCurrencyForTaxProfile(profile);
    }
  }

  hasGpsAttendance() { return this.plans.has('gpsAttendance'); }
  hasMultiSite() { return this.plans.has('multiSiteManagement'); }
  hasSsoConfig() { return this.plans.has('ssoConfig'); }
  hasCustomIntegrations() { return this.plans.has('customIntegrations'); }
  hasEnterpriseControls() { return this.hasSsoConfig() || this.hasCustomIntegrations(); }
  canManageSites() { return this.hasGpsAttendance() || this.hasMultiSite(); }
  hasBillingCustomer() { return !!String(this.settings().stripeCustomerId || '').trim(); }

  addSite() {
    if (!this.canManageSites()) {
      this.toast.error('Site management requires Pro or Enterprise plan.');
      return;
    }
    if (!this.hasMultiSite() && this.draft.sites.length >= 1) {
      this.toast.error('Multiple sites require the Enterprise plan.');
      return;
    }

    this.draft = {
      ...this.draft,
      sites: [
        ...this.draft.sites,
        {
          id: this.createLocalId('site'),
          name: '',
          address: '',
          latitude: null,
          longitude: null,
          radiusM: 150,
          active: true,
        },
      ],
    };
    this.selectedSiteIndex = this.draft.sites.length - 1;
    this.refreshMapFromSelectedSite();
  }

  removeSite(index: number) {
    this.draft = {
      ...this.draft,
      sites: this.draft.sites.filter((_, i) => i !== index),
    };
    this.selectedSiteIndex = Math.max(0, Math.min(this.selectedSiteIndex, this.draft.sites.length - 1));
    this.refreshMapFromSelectedSite();
  }

  cadenceOptions = CADENCE_OPTIONS;

  cadenceDescription(cadence: AccrualPolicy['cadence']): string {
    return this.cadenceOptions.find((c) => c.value === cadence)?.description || '';
  }

  addAccrualTier() {
    const tiers: AccrualTier[] = [
      ...this.draft.accrualPolicy.tiers,
      { minTenureMonths: 0, ptoHoursPerYear: 0, sickHoursPerYear: 0 },
    ];
    this.draft = { ...this.draft, accrualPolicy: { ...this.draft.accrualPolicy, tiers } };
  }

  removeAccrualTier(index: number) {
    if (this.draft.accrualPolicy.tiers.length <= 1) return;
    const tiers = this.draft.accrualPolicy.tiers.filter((_, i) => i !== index);
    this.draft = { ...this.draft, accrualPolicy: { ...this.draft.accrualPolicy, tiers } };
  }

  addIntegration() {
    this.draft = {
      ...this.draft,
      integrationConfigs: [
        ...this.draft.integrationConfigs,
        { label: '', endpoint: '', active: true },
      ],
    };
  }

  removeIntegration(index: number) {
    this.draft = {
      ...this.draft,
      integrationConfigs: this.draft.integrationConfigs.filter((_, i) => i !== index),
    };
  }

  private createLocalId(prefix: string) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  selectSite(index: number) {
    this.selectedSiteIndex = index;
    this.refreshMapFromSelectedSite();
  }

  onSiteRadiusChange() {
    this.refreshMapFromSelectedSite(false);
  }

  private ensureMapReady() {
    if (!this.canManageSites()) return;
    if (this.map || !this.geofenceMap?.nativeElement) return;

    this.map = L.map(this.geofenceMap.nativeElement, {
      center: [33.749, -84.388],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);

    this.map.on('click', (event: L.LeafletMouseEvent) => {
      const site = this.draft.sites[this.selectedSiteIndex];
      if (!site) return;
      site.latitude = Number(event.latlng.lat.toFixed(6));
      site.longitude = Number(event.latlng.lng.toFixed(6));
      this.refreshMapFromSelectedSite(false);
    });

    this.refreshMapFromSelectedSite();
  }

  private refreshMapFromSelectedSite(recenter = true) {
    if (!this.map) {
      this.ensureMapReady();
      if (!this.map) return;
    }
    const site = this.draft.sites[this.selectedSiteIndex];
    if (!site) {
      if (this.marker) { this.map.removeLayer(this.marker); this.marker = null; }
      if (this.circle) { this.map.removeLayer(this.circle); this.circle = null; }
      return;
    }

    const lat = Number(site.latitude);
    const lng = Number(site.longitude);
    const radiusM = Math.max(25, Number(site.radiusM || 150));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const center: L.LatLngExpression = [lat, lng];
    if (!this.marker) {
      this.marker = L.marker(center).addTo(this.map);
    } else {
      this.marker.setLatLng(center);
    }

    if (!this.circle) {
      this.circle = L.circle(center, {
        radius: radiusM,
        color: '#22c55e',
        fillColor: '#22c55e',
        fillOpacity: 0.18,
      }).addTo(this.map);
    } else {
      this.circle.setLatLng(center);
      this.circle.setRadius(radiusM);
    }

    if (recenter) {
      this.map.setView(center, 15);
    }
  }

  async save() {
    if (!this.orgId || !this.draft.name) return;
    this.saving.set(true);
    this.saveMsg.set(null);
    try {
      const normalizedSites = (this.draft.sites || [])
        .map((site) => ({
          ...site,
          id: String(site.id || this.createLocalId('site')).trim(),
          name: String(site.name || '').trim(),
          address: String(site.address || '').trim(),
          latitude: site.latitude != null ? Number(site.latitude) : null,
          longitude: site.longitude != null ? Number(site.longitude) : null,
          radiusM: Math.max(25, Number(site.radiusM || 150)),
          active: site.active !== false,
        }))
        .filter((site) => site.name);

      const normalizedAccrualPolicy: AccrualPolicy = {
        enabled: !!this.draft.accrualPolicy?.enabled,
        cadence: this.draft.accrualPolicy?.cadence || 'monthly',
        maxBalanceHours: Math.max(0, Number(this.draft.accrualPolicy?.maxBalanceHours || 0)),
        tiers: (this.draft.accrualPolicy?.tiers || [])
          .map((t) => ({
            minTenureMonths: Math.max(0, Number(t.minTenureMonths || 0)),
            ptoHoursPerYear: Math.max(0, Number(t.ptoHoursPerYear || 0)),
            sickHoursPerYear: Math.max(0, Number(t.sickHoursPerYear || 0)),
          }))
          .sort((a, b) => a.minTenureMonths - b.minTenureMonths),
      };

      const db = getFirestore();
      await setDoc(doc(db, 'orgs', this.orgId), {
        ...this.draft,
        countryCode: String(this.draft.countryCode || 'US').trim(),
        currencyCode: String(this.draft.currencyCode || 'USD').trim().toUpperCase(),
        payFrequency: this.draft.payFrequency || 'biweekly',
        taxProfile: this.draft.taxProfile || 'manual',
        payrollTaxNotes: String(this.draft.payrollTaxNotes || '').trim(),
        gpsAttendanceEnabled: this.hasGpsAttendance() ? this.draft.gpsAttendanceEnabled : false,
        sites: this.canManageSites() ? normalizedSites : [],
        accrualPolicy: normalizedAccrualPolicy,
        ssoEnabled: this.hasSsoConfig() ? this.draft.ssoEnabled : false,
        ssoProvider: this.hasSsoConfig() ? String(this.draft.ssoProvider || '').trim() : '',
        integrationConfigs: this.hasCustomIntegrations()
          ? this.draft.integrationConfigs.map((item) => ({
              label: String(item.label || '').trim(),
              endpoint: String(item.endpoint || '').trim(),
              active: item.active !== false,
            })).filter((item) => item.label || item.endpoint)
          : [],
        orgId: this.orgId,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      this.settings.set({ ...this.draft, sites: normalizedSites, accrualPolicy: normalizedAccrualPolicy });
      this.draft = { ...this.draft, sites: normalizedSites, accrualPolicy: normalizedAccrualPolicy };
      this.ctx.setContext({
        orgId: this.ctx.orgId(),
        uid: this.ctx.uid(),
        accessRole: this.ctx.accessRole(),
        platformRole: this.ctx.platformRole(),
        displayName: this.ctx.displayName(),
        email: this.ctx.email(),
        jobRole: this.ctx.jobRole(),
        plan: this.draft.plan,
        planStatus: this.draft.planStatus,
        countryCode: this.draft.countryCode,
        currencyCode: this.draft.currencyCode,
        payFrequency: this.draft.payFrequency,
        taxProfile: this.draft.taxProfile,
      });
      this.refreshMapFromSelectedSite();
      this.saveMsg.set('Organization settings saved successfully.');
      setTimeout(() => this.saveMsg.set(null), 4000);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to save settings.');
    } finally {
      this.saving.set(false);
    }
  }

  private handleBillingReturn() {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get('billing');
    if (!billing) return;
    if (billing === 'success') {
      this.toast.success('Subscription updated — it may take a moment to reflect below.');
    } else if (billing === 'cancel') {
      this.toast.info('Checkout was canceled. No changes were made.');
    }
    params.delete('billing');
    const query = params.toString();
    history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
  }

  async manageBilling() {
    if (!this.orgId) return;
    if (!this.hasBillingCustomer()) {
      this.toast.info('This organization has no active billing customer yet. Upgrade the plan or attach a Stripe customer before opening the portal.');
      return;
    }
    this.billingBusy.set(true);
    try {
      const fns = getFunctions(undefined, 'us-east1');
      const createPortal = httpsCallable(fns, 'stripeCreatePortal');
      const res: any = await createPortal({ orgId: this.orgId });
      
      if (res.data?.url) {
        window.location.href = res.data.url;
      } else {
        throw new Error('No URL returned from Stripe');
      }
    } catch (e: any) {
      if (String(e?.code || '').includes('failed-precondition')) {
        this.toast.info('This organization has no active billing customer yet. Upgrade the plan before opening the Stripe portal.');
        return;
      }
      this.toast.errorFrom(e, 'Failed to open Stripe Portal.');
    } finally {
      this.billingBusy.set(false);
    }
  }

  async upgradeToPlan(planId: 'starter' | 'pro') {
    if (!this.orgId || this.billingBusy()) return;
    this.billingBusy.set(true);
    try {
      const fns = getFunctions(undefined, 'us-east1');
      const createCheckout = httpsCallable(fns, 'stripeCreateCheckout');
      const returnBase = `${window.location.origin}${window.location.pathname}`;
      const res: any = await createCheckout({
        orgId: this.orgId,
        planId,
        successUrl: `${returnBase}?billing=success`,
        cancelUrl: `${returnBase}?billing=cancel`,
      });

      if (res.data?.url) {
        window.location.href = res.data.url;
      } else {
        throw new Error('No checkout URL returned from Stripe');
      }
    } catch (e: any) {
      if (String(e?.code || '').includes('failed-precondition')) {
        this.toast.error('Billing isn\'t configured for this plan yet. Contact support.');
        return;
      }
      this.toast.errorFrom(e, 'Failed to start checkout.');
    } finally {
      this.billingBusy.set(false);
    }
  }
}
