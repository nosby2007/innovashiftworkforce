import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, PLATFORM_ID, ViewChild, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { OrgExperienceService } from '../../core/experience/org-experience.service';
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
import {
  DEFAULT_EXPERIENCE_FLAGS,
  EXPERIENCE_FLAG_OPTIONS,
  ExperienceFlagKey,
  ExperienceFlags,
  normalizeExperienceFlags,
} from '../../core/experience/experience-flags.model';
import { OrgHoliday, BenefitLine, defaultDeductionElectionsForCountry } from '../../shared/utils/payroll.util';
// Leaflet touches `window` at module-evaluation time, so it's type-only here
// and loaded dynamically (gated on isPlatformBrowser) in ensureMapReady() —
// see geofence-map.component.ts for the full rationale.
import type * as Leaflet from 'leaflet';

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
  overtimeEnabled: boolean;
  overtimeMultiplier: number;
  overtimeWeeklyThresholdHours: number;
  holidayWorkMultiplier: number;
  minRestHours: number;
  maxConsecutiveDays: number;
  maxWeeklyScheduledHours: number;
  holidays: OrgHoliday[];
  customJobRoles: string[];
  customDocumentTypes: string[];
  customSkills: string[];
  defaultFederalTaxPercent: number;
  defaultStateTaxPercent: number;
  defaultSocialSecurityPercent: number;
  defaultMedicarePercent: number;
  default401kMatchPercent: number;
  default401kProvider: string;
  benefitPlans: BenefitLine[];
  breakRequiredAfterHours: number;
  minRequiredBreakMinutes: number;
  gpsAttendanceEnabled: boolean;
  sites: OrgSite[];
  accrualPolicy: AccrualPolicy;
  ssoEnabled: boolean;
  ssoProvider: string;
  integrationConfigs: OrgIntegrationConfig[];
  experienceFlags: ExperienceFlags;
  dataRetention: DataRetentionSettings;
  stripeCustomerId?: string;
  createdAt?: any;
  updatedAt?: any;
}

// Years null = "not confirmed yet, never auto-delete this category" — the
// safe default. Only an explicit number (set after legal/counsel confirms
// the figure for this org's jurisdiction) turns on automated purging for
// that category in enforceDataRetention. See docs/DATA_RETENTION_POLICY.md.
interface DataRetentionSettings {
  timeEntriesYears: number | null;
  payrollRunsYears: number | null;
  accrualLedgerYears: number | null;
  timeOffRequestsYears: number | null;
  employeeDocumentsYearsAfterTermination: number | null;
  confirmedBy: string | null;
  confirmedAt: any;
}

const DEFAULT_DATA_RETENTION: DataRetentionSettings = {
  timeEntriesYears: null,
  payrollRunsYears: null,
  accrualLedgerYears: null,
  timeOffRequestsYears: null,
  employeeDocumentsYearsAfterTermination: null,
  confirmedBy: null,
  confirmedAt: null,
};

const DEFAULT_SETTINGS: OrgSettings = {
  name: '', industry: 'Healthcare', timezone: 'America/New_York',
  contactEmail: '', plan: 'free', planStatus: 'active', maxEmployees: 25,
  countryCode: 'US',
  currencyCode: 'USD',
  payFrequency: 'biweekly',
  taxProfile: 'us_federal_state',
  payrollTaxNotes: '',
  defaultPayRate: 40,
  overtimeEnabled: true,
  overtimeMultiplier: 1.5,
  overtimeWeeklyThresholdHours: 40,
  holidayWorkMultiplier: 1.5,
  minRestHours: 8,
  maxConsecutiveDays: 6,
  maxWeeklyScheduledHours: 60,
  holidays: [],
  customJobRoles: [],
  customDocumentTypes: [],
  customSkills: [],
  // Real US federal/state/FICA figures only get applied for US orgs — see
  // ngOnInit(), which fills these in via defaultDeductionElectionsForCountry
  // the first time an org's settings are loaded with none saved yet.
  defaultFederalTaxPercent: 0,
  defaultStateTaxPercent: 0,
  defaultSocialSecurityPercent: 0,
  defaultMedicarePercent: 0,
  default401kMatchPercent: 0,
  default401kProvider: '',
  benefitPlans: [],
  breakRequiredAfterHours: 6,
  minRequiredBreakMinutes: 30,
  gpsAttendanceEnabled: false,
  sites: [],
  accrualPolicy: { ...DEFAULT_ACCRUAL_POLICY, tiers: DEFAULT_ACCRUAL_POLICY.tiers.map((t) => ({ ...t })) },
  ssoEnabled: false,
  ssoProvider: '',
  integrationConfigs: [],
  experienceFlags: { ...DEFAULT_EXPERIENCE_FLAGS },
  dataRetention: { ...DEFAULT_DATA_RETENTION },
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
  imports: [CommonModule, FormsModule, RouterLink, MatIconModule, MatButtonModule, TranslocoModule],
  template: `
    <div class="vs-page-pad">

      <!-- Header -->
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">{{ 'orgSettings.title' | transloco }}</h1>
          <p class="vs-page-subtitle">{{ 'orgSettings.subtitle' | transloco }}</p>
        </div>
        <div class="vs-page-actions">
          <span class="vs-badge {{ planBadge() }}">
            <mat-icon style="font-size:13px;">workspace_premium</mat-icon>
            {{ 'orgSettings.planLabel' | transloco: { plan: (settings().plan | uppercase) } }}
          </span>
        </div>
      </div>

      <!-- No org -->
      <div *ngIf="!orgId" class="ors-no-org vs-glass">
        <mat-icon>warning_amber</mat-icon>
        {{ 'orgSettings.noOrgContext' | transloco }}
      </div>

      <ng-container *ngIf="orgId">

        <!-- Profile section -->
        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.profileTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.profileSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">business</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <div class="vs-form-row vs-form-row--2">
              <div>
                <label class="vs-field-label" for="ors-name">{{ 'orgSettings.orgNameLabel' | transloco }}</label>
                <input id="ors-name" class="vs-input" [(ngModel)]="draft.name" [placeholder]="'orgSettings.orgNamePlaceholder' | transloco">
              </div>
              <div>
                <label class="vs-field-label" for="ors-email">{{ 'orgSettings.contactEmailLabel' | transloco }}</label>
                <input id="ors-email" class="vs-input" type="email" [(ngModel)]="draft.contactEmail" placeholder="admin@example.com">
              </div>
            </div>
            <div class="vs-form-row vs-form-row--2">
              <div>
                <label class="vs-field-label" for="ors-industry">{{ 'orgSettings.industryLabel' | transloco }}</label>
                <select id="ors-industry" class="vs-select" [(ngModel)]="draft.industry">
                  <option *ngFor="let i of industries" [value]="i">{{ i }}</option>
                </select>
              </div>
              <div>
                <label class="vs-field-label" for="ors-tz">{{ 'orgSettings.timezoneLabel' | transloco }}</label>
                <select id="ors-tz" class="vs-select" [(ngModel)]="draft.timezone">
                  <option *ngFor="let tz of timezones" [value]="tz">{{ tz }}</option>
                </select>
              </div>
            </div>

            <div class="vs-form-row vs-form-row--2" style="margin-top:16px;">
              <div>
                <label class="vs-field-label" for="ors-pay">{{ 'orgSettings.defaultPayRateLabel' | transloco: { currency: draft.currencyCode } }}</label>
                <input id="ors-pay" type="number" class="vs-input" [(ngModel)]="draft.defaultPayRate" placeholder="40.00">
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">{{ 'orgSettings.defaultPayRateHint' | transloco }}</div>
              </div>
              <div>
                <label class="vs-field-label" for="ors-break-threshold">{{ 'orgSettings.breakRequiredAfterLabel' | transloco }}</label>
                <select id="ors-break-threshold" class="vs-select" [(ngModel)]="draft.breakRequiredAfterHours">
                  <option [value]="4">{{ 'orgSettings.breakOption4h' | transloco }}</option>
                  <option [value]="6">{{ 'orgSettings.breakOption6h' | transloco }}</option>
                </select>
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">{{ 'orgSettings.breakRequiredAfterHint' | transloco }}</div>
              </div>
            </div>

            <div class="vs-form-row vs-form-row--2" style="margin-top:16px;">
              <div>
                <label class="vs-field-label" for="ors-break-min">{{ 'orgSettings.minBreakDurationLabel' | transloco }}</label>
                <input id="ors-break-min" type="number" class="vs-input" min="1" [(ngModel)]="draft.minRequiredBreakMinutes" placeholder="30">
              </div>
            </div>
          </div>
        </section>

        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.industryProfileTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.industryProfileSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">tune</mat-icon>
          </div>
          <div class="vs-panel-body ors-industry-profile-body">
            <ng-container *ngIf="experienceConfig().configurationStatus === 'configured'; else notConfigured">
              <span class="vs-badge vs-badge--success">{{ 'orgSettings.active' | transloco }}</span>
              <span>{{ experienceConfig().industryProfileId }}</span>
            </ng-container>
            <ng-template #notConfigured>
              <span class="vs-badge vs-badge--neutral">{{ 'orgSettings.notSetUp' | transloco }}</span>
              <span>{{ 'orgSettings.usingGenericDefaults' | transloco }}</span>
            </ng-template>
            <a class="vs-btn-ghost" routerLink="/admin/industry-setup">
              <mat-icon>arrow_forward</mat-icon> {{ 'orgSettings.setUpIndustryProfile' | transloco }}
            </a>
          </div>
        </section>

        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.financeTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.financeSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">account_balance</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <div class="vs-form-row vs-form-row--3">
              <div>
                <label class="vs-field-label" for="ors-country">{{ 'orgSettings.countryLabel' | transloco }}</label>
                <select id="ors-country" class="vs-select" [(ngModel)]="draft.countryCode">
                  <option *ngFor="let c of countries" [value]="c.code">{{ c.label }}</option>
                </select>
              </div>
              <div>
                <label class="vs-field-label" for="ors-currency">{{ 'orgSettings.currencyLabel' | transloco }}</label>
                <select id="ors-currency" class="vs-select" [(ngModel)]="draft.currencyCode">
                  <option *ngFor="let c of currencies" [value]="c.code">{{ c.label }}</option>
                </select>
              </div>
              <div>
                <label class="vs-field-label" for="ors-pay-frequency">{{ 'orgSettings.paymentCycleLabel' | transloco }}</label>
                <select id="ors-pay-frequency" class="vs-select" [(ngModel)]="draft.payFrequency">
                  <option *ngFor="let f of payFrequencies" [value]="f.value">{{ f.label }}</option>
                </select>
              </div>
            </div>
            <div class="vs-form-row vs-form-row--2" style="margin-top:16px;">
              <div>
                <label class="vs-field-label" for="ors-tax-profile">{{ 'orgSettings.taxProfileLabel' | transloco }}</label>
                <select id="ors-tax-profile" class="vs-select" [(ngModel)]="draft.taxProfile" (ngModelChange)="onTaxProfileChange($event)">
                  <option *ngFor="let t of taxProfiles" [value]="t.value">{{ t.label }}</option>
                </select>
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">{{ taxProfileDescription(draft.taxProfile) }}</div>
              </div>
              <div>
                <label class="vs-field-label" for="ors-tax-notes">{{ 'orgSettings.payrollTaxNotesLabel' | transloco }}</label>
                <textarea id="ors-tax-notes" class="vs-input" rows="3" [(ngModel)]="draft.payrollTaxNotes" [placeholder]="'orgSettings.payrollTaxNotesPlaceholder' | transloco"></textarea>
              </div>
            </div>
          </div>
        </section>

        <!-- Overtime & Paid Holidays section -->
        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.otHolidaysTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.otHolidaysSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">schedule</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <label class="ors-toggle-row">
              <input type="checkbox" [(ngModel)]="draft.overtimeEnabled">
              <div>
                <div class="ors-toggle-title">{{ 'orgSettings.enableOvertimeLabel' | transloco }}</div>
                <div class="vs-muted">{{ 'orgSettings.enableOvertimeHint' | transloco }}</div>
              </div>
            </label>

            <div class="vs-form-row vs-form-row--2" style="margin-top:16px;" *ngIf="draft.overtimeEnabled">
              <div>
                <label class="vs-field-label" for="ors-ot-multiplier">{{ 'orgSettings.otMultiplierLabel' | transloco }}</label>
                <input id="ors-ot-multiplier" type="number" class="vs-input" min="1" step="0.1" [(ngModel)]="draft.overtimeMultiplier" placeholder="1.5">
                <div class="ors-quick-set">
                  <button class="vs-btn-ghost ors-quick-set-btn" type="button" (click)="draft.overtimeMultiplier = 1.5">1.5x</button>
                  <button class="vs-btn-ghost ors-quick-set-btn" type="button" (click)="draft.overtimeMultiplier = 2">2x</button>
                </div>
              </div>
              <div>
                <label class="vs-field-label" for="ors-ot-threshold">{{ 'orgSettings.weeklyOtThresholdLabel' | transloco }}</label>
                <input id="ors-ot-threshold" type="number" class="vs-input" min="1" [(ngModel)]="draft.overtimeWeeklyThresholdHours" placeholder="40">
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">{{ 'orgSettings.weeklyOtThresholdHint' | transloco }}</div>
              </div>
            </div>

            <div class="vs-form-row" style="margin-top:16px;">
              <div>
                <label class="vs-field-label" for="ors-holiday-multiplier">{{ 'orgSettings.holidayMultiplierLabel' | transloco }}</label>
                <input id="ors-holiday-multiplier" type="number" class="vs-input" min="1" step="0.1" [(ngModel)]="draft.holidayWorkMultiplier" placeholder="1.5">
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">{{ 'orgSettings.holidayMultiplierHint' | transloco }}</div>
              </div>
            </div>

            <div class="ors-site-actions" style="justify-content:space-between; margin-top:16px;">
              <strong>{{ 'orgSettings.paidHolidays' | transloco }}</strong>
              <button class="vs-btn-ghost" (click)="addHoliday()" type="button">
                <mat-icon>add</mat-icon> {{ 'orgSettings.addHoliday' | transloco }}
              </button>
            </div>

            <div *ngIf="draft.holidays.length === 0" class="ors-empty-site vs-glass">
              <mat-icon>event_busy</mat-icon>
              <div>
                <strong>{{ 'orgSettings.noHolidaysTitle' | transloco }}</strong>
                <div class="vs-muted">{{ 'orgSettings.noHolidaysHint' | transloco }}</div>
              </div>
            </div>

            <div class="ors-site-card" *ngFor="let holiday of draft.holidays; index as i">
              <div class="vs-form-row vs-form-row--3">
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.holidayNameLabel' | transloco }}</label>
                  <input class="vs-input" [(ngModel)]="holiday.name" [placeholder]="'orgSettings.holidayNamePlaceholder' | transloco">
                </div>
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.dateLabel' | transloco }}</label>
                  <input class="vs-input" type="date" [(ngModel)]="holiday.date">
                </div>
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.paidHoursLabel' | transloco }}</label>
                  <input class="vs-input" type="number" min="0" step="0.5" [(ngModel)]="holiday.paidHours" placeholder="8">
                </div>
              </div>
              <div class="ors-site-footer">
                <span class="vs-muted">{{ 'orgSettings.holidayFooterHint' | transloco }}</span>
                <button class="vs-btn-ghost" type="button" (click)="removeHoliday(i)">
                  <mat-icon>delete</mat-icon> {{ 'orgSettings.remove' | transloco }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Fatigue & Rest Rules section -->
        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.fatigueRulesTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.fatigueRulesSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">bedtime</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <div class="vs-form-row vs-form-row--3">
              <div>
                <label class="vs-field-label" for="ors-min-rest">{{ 'orgSettings.minRestHoursLabel' | transloco }}</label>
                <input id="ors-min-rest" type="number" class="vs-input" min="1" [(ngModel)]="draft.minRestHours" placeholder="8">
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">{{ 'orgSettings.minRestHoursHint' | transloco }}</div>
              </div>
              <div>
                <label class="vs-field-label" for="ors-max-consecutive">{{ 'orgSettings.maxConsecutiveDaysLabel' | transloco }}</label>
                <input id="ors-max-consecutive" type="number" class="vs-input" min="1" [(ngModel)]="draft.maxConsecutiveDays" placeholder="6">
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">{{ 'orgSettings.maxConsecutiveDaysHint' | transloco }}</div>
              </div>
              <div>
                <label class="vs-field-label" for="ors-max-weekly">{{ 'orgSettings.maxWeeklyScheduledHoursLabel' | transloco }}</label>
                <input id="ors-max-weekly" type="number" class="vs-input" min="1" [(ngModel)]="draft.maxWeeklyScheduledHours" placeholder="60">
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">{{ 'orgSettings.maxWeeklyScheduledHoursHint' | transloco }}</div>
              </div>
            </div>
          </div>
        </section>

        <!-- Custom Job Roles section -->
        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.customRolesTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.customRolesSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">badge</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <div class="ors-site-actions" style="justify-content:space-between;">
              <strong>{{ 'orgSettings.customRolesHeader' | transloco }}</strong>
              <button class="vs-btn-ghost" (click)="addCustomJobRole()" type="button">
                <mat-icon>add</mat-icon> {{ 'orgSettings.addRole' | transloco }}
              </button>
            </div>

            <div *ngIf="draft.customJobRoles.length === 0" class="ors-empty-site vs-glass">
              <mat-icon>badge</mat-icon>
              <div>
                <strong>{{ 'orgSettings.noCustomRolesTitle' | transloco }}</strong>
                <div class="vs-muted">{{ 'orgSettings.noCustomRolesHint' | transloco }}</div>
              </div>
            </div>

            <div class="ors-site-card" *ngFor="let role of draft.customJobRoles; index as i">
              <div class="vs-form-row">
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.roleNameLabel' | transloco }}</label>
                  <input class="vs-input" [(ngModel)]="draft.customJobRoles[i]" [placeholder]="'orgSettings.roleNamePlaceholder' | transloco">
                </div>
              </div>
              <div class="ors-site-footer">
                <button class="vs-btn-ghost" type="button" (click)="removeCustomJobRole(i)">
                  <mat-icon>delete</mat-icon> {{ 'orgSettings.remove' | transloco }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Custom Document Types section -->
        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.customDocTypesTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.customDocTypesSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">description</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <div class="ors-site-actions" style="justify-content:space-between;">
              <strong>{{ 'orgSettings.customDocTypesHeader' | transloco }}</strong>
              <button class="vs-btn-ghost" (click)="addCustomDocumentType()" type="button">
                <mat-icon>add</mat-icon> {{ 'orgSettings.addDocType' | transloco }}
              </button>
            </div>

            <div *ngIf="draft.customDocumentTypes.length === 0" class="ors-empty-site vs-glass">
              <mat-icon>description</mat-icon>
              <div>
                <strong>{{ 'orgSettings.noCustomDocTypesTitle' | transloco }}</strong>
                <div class="vs-muted">{{ 'orgSettings.noCustomDocTypesHint' | transloco }}</div>
              </div>
            </div>

            <div class="ors-site-card" *ngFor="let docType of draft.customDocumentTypes; index as i">
              <div class="vs-form-row">
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.docTypeNameLabel' | transloco }}</label>
                  <input class="vs-input" [(ngModel)]="draft.customDocumentTypes[i]" [placeholder]="'orgSettings.docTypeNamePlaceholder' | transloco">
                </div>
              </div>
              <div class="ors-site-footer">
                <button class="vs-btn-ghost" type="button" (click)="removeCustomDocumentType(i)">
                  <mat-icon>delete</mat-icon> {{ 'orgSettings.remove' | transloco }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Skills Catalog section -->
        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.skillsCatalogTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.skillsCatalogSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">verified</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <div class="ors-site-actions" style="justify-content:space-between;">
              <strong>{{ 'orgSettings.skillsCatalogHeader' | transloco }}</strong>
              <button class="vs-btn-ghost" (click)="addCustomSkill()" type="button">
                <mat-icon>add</mat-icon> {{ 'orgSettings.addSkill' | transloco }}
              </button>
            </div>

            <div *ngIf="draft.customSkills.length === 0" class="ors-empty-site vs-glass">
              <mat-icon>verified</mat-icon>
              <div>
                <strong>{{ 'orgSettings.noSkillsTitle' | transloco }}</strong>
                <div class="vs-muted">{{ 'orgSettings.noSkillsHint' | transloco }}</div>
              </div>
            </div>

            <div class="ors-site-card" *ngFor="let skill of draft.customSkills; index as i">
              <div class="vs-form-row">
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.skillNameLabel' | transloco }}</label>
                  <input class="vs-input" [(ngModel)]="draft.customSkills[i]" [placeholder]="'orgSettings.skillNamePlaceholder' | transloco">
                </div>
              </div>
              <div class="ors-site-footer">
                <button class="vs-btn-ghost" type="button" (click)="removeCustomSkill(i)">
                  <mat-icon>delete</mat-icon> {{ 'orgSettings.remove' | transloco }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Payroll Deductions & Benefits section -->
        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.deductionsTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.deductionsSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">account_balance_wallet</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <div class="vs-muted" style="margin-bottom:8px;" *ngIf="draft.countryCode === 'US'; else nonUsDeductionsNote">
              {{ 'orgSettings.usDeductionsNote' | transloco }}
            </div>
            <ng-template #nonUsDeductionsNote>
              <div class="vs-muted" style="margin-bottom:8px;">
                {{ 'orgSettings.nonUsDeductionsNote' | transloco }}
              </div>
            </ng-template>
            <div class="vs-form-row vs-form-row--3">
              <div>
                <label class="vs-field-label" for="ors-fed-tax">{{ 'orgSettings.federalTaxLabel' | transloco }}</label>
                <input id="ors-fed-tax" type="number" class="vs-input" min="0" step="0.1" [(ngModel)]="draft.defaultFederalTaxPercent" placeholder="0">
              </div>
              <div>
                <label class="vs-field-label" for="ors-state-tax">{{ 'orgSettings.stateTaxLabel' | transloco }}</label>
                <input id="ors-state-tax" type="number" class="vs-input" min="0" step="0.1" [(ngModel)]="draft.defaultStateTaxPercent" placeholder="0">
              </div>
              <div>
                <label class="vs-field-label" for="ors-401k-match">{{ 'orgSettings.match401kLabel' | transloco }}</label>
                <input id="ors-401k-match" type="number" class="vs-input" min="0" step="0.1" [(ngModel)]="draft.default401kMatchPercent" placeholder="0">
              </div>
            </div>
            <div class="vs-form-row vs-form-row--3" style="margin-top:16px;">
              <div>
                <label class="vs-field-label" for="ors-ss">{{ 'orgSettings.ssLabel' | transloco }}</label>
                <input id="ors-ss" type="number" class="vs-input" min="0" step="0.01" [(ngModel)]="draft.defaultSocialSecurityPercent" placeholder="0">
              </div>
              <div>
                <label class="vs-field-label" for="ors-medicare">{{ 'orgSettings.medicareLabel' | transloco }}</label>
                <input id="ors-medicare" type="number" class="vs-input" min="0" step="0.01" [(ngModel)]="draft.defaultMedicarePercent" placeholder="0">
              </div>
              <div>
                <label class="vs-field-label" for="ors-401k-provider">{{ 'orgSettings.provider401kLabel' | transloco }}</label>
                <input id="ors-401k-provider" class="vs-input" [(ngModel)]="draft.default401kProvider" [placeholder]="'orgSettings.provider401kPlaceholder' | transloco">
              </div>
            </div>
            <button class="vs-btn-ghost ors-quick-set-btn" type="button" style="margin-top:10px;" *ngIf="draft.countryCode === 'US'" (click)="useUsDeductionDefaults()">
              {{ 'orgSettings.useUsRates' | transloco }}
            </button>

            <div class="ors-site-actions" style="justify-content:space-between; margin-top:16px;">
              <strong>{{ 'orgSettings.benefitPlansHeader' | transloco }}</strong>
              <button class="vs-btn-ghost" (click)="addBenefitPlan()" type="button">
                <mat-icon>add</mat-icon> {{ 'orgSettings.addBenefitPlan' | transloco }}
              </button>
            </div>

            <div *ngIf="draft.benefitPlans.length === 0" class="ors-empty-site vs-glass">
              <mat-icon>favorite_border</mat-icon>
              <div>
                <strong>{{ 'orgSettings.noBenefitPlansTitle' | transloco }}</strong>
                <div class="vs-muted">{{ 'orgSettings.noBenefitPlansHint' | transloco }}</div>
              </div>
            </div>

            <div class="ors-site-card" *ngFor="let plan of draft.benefitPlans; index as i">
              <div class="vs-form-row vs-form-row--2">
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.planNameLabel' | transloco }}</label>
                  <input class="vs-input" [(ngModel)]="plan.label" [placeholder]="'orgSettings.planNamePlaceholder' | transloco">
                </div>
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.providerCarrierLabel' | transloco }}</label>
                  <input class="vs-input" [(ngModel)]="plan.provider" [placeholder]="'orgSettings.providerCarrierPlaceholder' | transloco">
                </div>
              </div>
              <div class="vs-form-row vs-form-row--2" style="margin-top:12px;">
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.employeeCostLabel' | transloco }}</label>
                  <input class="vs-input" type="number" min="0" step="0.01" [(ngModel)]="plan.employeeAmount" placeholder="50.00">
                </div>
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.employerContribLabel' | transloco }}</label>
                  <input class="vs-input" type="number" min="0" step="0.01" [(ngModel)]="plan.employerAmount" placeholder="200.00">
                </div>
              </div>
              <div class="ors-site-footer">
                <span class="vs-muted">{{ 'orgSettings.benefitFooterHint' | transloco }}</span>
                <button class="vs-btn-ghost" type="button" (click)="removeBenefitPlan(i)">
                  <mat-icon>delete</mat-icon> {{ 'orgSettings.remove' | transloco }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.nextExpTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.nextExpSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">rocket_launch</mat-icon>
          </div>
          <div class="vs-panel-body">
            <div class="ors-rollout-warning">
              <mat-icon>published_with_changes</mat-icon>
              <div>
                <strong>{{ 'orgSettings.rollbackProtectedTitle' | transloco }}</strong>
                <span>{{ 'orgSettings.rollbackProtectedBody' | transloco }}</span>
              </div>
            </div>
            <div class="ors-flag-grid">
              <label class="ors-flag-card" *ngFor="let option of experienceFlagOptions">
                <input
                  type="checkbox"
                  [checked]="experienceFlagEnabled(option.key)"
                  (change)="setExperienceFlag(option.key, $any($event.target).checked)">
                <span class="ors-flag-copy">
                  <strong>{{ option.label }}</strong>
                  <small>{{ option.description }}</small>
                </span>
                <span class="vs-badge" [class.vs-badge--success]="experienceFlagEnabled(option.key)" [class.vs-badge--neutral]="!experienceFlagEnabled(option.key)">
                  {{ (experienceFlagEnabled(option.key) ? 'orgSettings.on' : 'orgSettings.off') | transloco }}
                </span>
              </label>
            </div>
          </div>
        </section>

        <!-- Data Retention section -->
        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.retentionTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.retentionSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">auto_delete</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <div class="vs-muted" style="margin-bottom:8px;">
              {{ 'orgSettings.retentionNote' | transloco }}
            </div>
            <div class="vs-form-row vs-form-row--3">
              <div>
                <label class="vs-field-label" for="ors-ret-time">{{ 'orgSettings.timeEntriesYearsLabel' | transloco }}</label>
                <input id="ors-ret-time" type="number" class="vs-input" min="1" step="1" [(ngModel)]="draft.dataRetention.timeEntriesYears" [placeholder]="'orgSettings.never' | transloco">
              </div>
              <div>
                <label class="vs-field-label" for="ors-ret-payroll">{{ 'orgSettings.payrollRunsYearsLabel' | transloco }}</label>
                <input id="ors-ret-payroll" type="number" class="vs-input" min="1" step="1" [(ngModel)]="draft.dataRetention.payrollRunsYears" [placeholder]="'orgSettings.never' | transloco">
              </div>
              <div>
                <label class="vs-field-label" for="ors-ret-accrual">{{ 'orgSettings.accrualLedgerYearsLabel' | transloco }}</label>
                <input id="ors-ret-accrual" type="number" class="vs-input" min="1" step="1" [(ngModel)]="draft.dataRetention.accrualLedgerYears" [placeholder]="'orgSettings.never' | transloco">
              </div>
            </div>
            <div class="vs-form-row vs-form-row--3" style="margin-top:16px;">
              <div>
                <label class="vs-field-label" for="ors-ret-requests">{{ 'orgSettings.timeOffRequestsYearsLabel' | transloco }}</label>
                <input id="ors-ret-requests" type="number" class="vs-input" min="1" step="1" [(ngModel)]="draft.dataRetention.timeOffRequestsYears" [placeholder]="'orgSettings.never' | transloco">
              </div>
              <div>
                <label class="vs-field-label" for="ors-ret-docs">{{ 'orgSettings.employeeDocsYearsLabel' | transloco }}</label>
                <input id="ors-ret-docs" type="number" class="vs-input" min="1" step="1" [(ngModel)]="draft.dataRetention.employeeDocumentsYearsAfterTermination" [placeholder]="'orgSettings.never' | transloco">
              </div>
              <div>
                <label class="vs-field-label">{{ 'orgSettings.lastConfirmedLabel' | transloco }}</label>
                <div class="vs-input" style="display:flex; align-items:center; background:transparent; cursor:default;">
                  {{ draft.dataRetention.confirmedAt ? (draft.dataRetention.confirmedBy + ' · ' + formatConfirmedAt()) : ('orgSettings.notYetConfirmed' | transloco) }}
                </div>
              </div>
            </div>
            <button class="vs-btn-ghost ors-quick-set-btn" type="button" style="margin-top:10px;" (click)="confirmDataRetention()">
              {{ 'orgSettings.markConfirmed' | transloco }}
            </button>
          </div>
        </section>

        <!-- PTO Accrual Policy section -->
        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.ptoTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.ptoSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">event_available</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <label class="ors-toggle-row">
              <input type="checkbox" [(ngModel)]="draft.accrualPolicy.enabled">
              <div>
                <div class="ors-toggle-title">{{ 'orgSettings.enableAccrualLabel' | transloco }}</div>
                <div class="vs-muted">{{ 'orgSettings.enableAccrualHint' | transloco }}</div>
              </div>
            </label>

            <ng-container *ngIf="draft.accrualPolicy.enabled">
              <div class="vs-form-row vs-form-row--2" style="margin-top:16px;">
                <div>
                  <label class="vs-field-label" for="ors-accrual-cadence">{{ 'orgSettings.accrualCadenceLabel' | transloco }}</label>
                  <select id="ors-accrual-cadence" class="vs-select" [(ngModel)]="draft.accrualPolicy.cadence">
                    <option *ngFor="let c of cadenceOptions" [value]="c.value">{{ c.label }}</option>
                  </select>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">{{ cadenceDescription(draft.accrualPolicy.cadence) }}</div>
                </div>
                <div>
                  <label class="vs-field-label" for="ors-accrual-cap">{{ 'orgSettings.balanceCapLabel' | transloco }}</label>
                  <input id="ors-accrual-cap" class="vs-input" type="number" min="0" [(ngModel)]="draft.accrualPolicy.maxBalanceHours" placeholder="240">
                  <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">{{ 'orgSettings.balanceCapHint' | transloco }}</div>
                </div>
              </div>

              <div class="ors-site-actions" style="justify-content:space-between; margin-top:16px;">
                <strong>{{ 'orgSettings.tenureTiersHeader' | transloco }}</strong>
                <button class="vs-btn-ghost" (click)="addAccrualTier()" type="button">
                  <mat-icon>add</mat-icon> {{ 'orgSettings.addTier' | transloco }}
                </button>
              </div>

              <div class="ors-site-card" *ngFor="let tier of draft.accrualPolicy.tiers; index as i">
                <div class="vs-form-row vs-form-row--3">
                  <div>
                    <label class="vs-field-label">{{ 'orgSettings.minTenureLabel' | transloco }}</label>
                    <input class="vs-input" type="number" min="0" [(ngModel)]="tier.minTenureMonths" placeholder="0">
                  </div>
                  <div>
                    <label class="vs-field-label">{{ 'orgSettings.ptoHoursYearLabel' | transloco }}</label>
                    <input class="vs-input" type="number" min="0" [(ngModel)]="tier.ptoHoursPerYear" placeholder="80">
                  </div>
                  <div>
                    <label class="vs-field-label">{{ 'orgSettings.sickHoursYearLabel' | transloco }}</label>
                    <input class="vs-input" type="number" min="0" [(ngModel)]="tier.sickHoursPerYear" placeholder="40">
                  </div>
                </div>
                <div class="ors-site-footer">
                  <span class="vs-muted">{{ 'orgSettings.tierFooterHint' | transloco }}</span>
                  <button class="vs-btn-ghost" type="button" (click)="removeAccrualTier(i)" [disabled]="draft.accrualPolicy.tiers.length <= 1">
                    <mat-icon>delete</mat-icon> {{ 'orgSettings.remove' | transloco }}
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
              <div class="vs-panel-title">{{ 'orgSettings.subscriptionTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.subscriptionSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">credit_card</mat-icon>
          </div>
          <div class="vs-panel-body">
            <div class="ors-plan-grid">
              <div class="ors-plan-item vs-glass">
                <div class="vs-stat-label">{{ 'orgSettings.currentPlanLabel' | transloco }}</div>
                <div class="ors-plan-val">{{ settings().plan | titlecase }}</div>
                <span class="vs-badge {{ planBadge() }}">{{ settings().planStatus }}</span>
              </div>
              <div class="ors-plan-item vs-glass">
                <div class="vs-stat-label">{{ 'orgSettings.maxEmployeesLabel' | transloco }}</div>
                <div class="ors-plan-val">{{ settings().maxEmployees }}</div>
                <span class="vs-muted" style="font-size:12px;">{{ 'orgSettings.seatsIncluded' | transloco }}</span>
              </div>
              <div class="ors-plan-item vs-glass ors-plan-upgrade">
                <div class="vs-stat-label">{{ 'orgSettings.changePlanLabel' | transloco }}</div>
                <div class="ors-plan-choices">
                  <button class="vs-btn-ghost ors-plan-choice-btn" type="button" (click)="upgradeToPlan('starter')" [disabled]="billingBusy() || settings().plan === 'starter'">
                    <mat-icon>{{ billingBusy() ? 'hourglass_empty' : 'bolt' }}</mat-icon> {{ 'orgSettings.starterPlanBtn' | transloco }}
                  </button>
                  <button class="vs-btn-primary ors-plan-choice-btn" type="button" (click)="upgradeToPlan('pro')" [disabled]="billingBusy() || settings().plan === 'pro'">
                    <mat-icon>{{ billingBusy() ? 'hourglass_empty' : 'workspace_premium' }}</mat-icon> {{ 'orgSettings.proPlanBtn' | transloco }}
                  </button>
                </div>
                <button class="vs-btn-ghost ors-upgrade-btn" type="button" (click)="manageBilling()" [disabled]="billingBusy() || !hasBillingCustomer()" *ngIf="hasBillingCustomer()">
                  <mat-icon>credit_card</mat-icon> {{ 'orgSettings.manageBillingBtn' | transloco }}
                </button>
                <span class="vs-muted" style="font-size:12px;">{{ 'orgSettings.needEnterprise' | transloco }} <a href="mailto:contact@innovacarereview.com">{{ 'orgSettings.contactSales' | transloco }}</a>.</span>
              </div>
            </div>
          </div>
        </section>

        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.attendanceControlsTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.attendanceControlsSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">pin_drop</mat-icon>
          </div>
          <div class="vs-panel-body ors-form">
            <div *ngIf="hasGpsAttendance(); else gpsUpgrade" class="ors-stack">
              <label class="ors-toggle-row">
                <input type="checkbox" [(ngModel)]="draft.gpsAttendanceEnabled">
                <div>
                  <div class="ors-toggle-title">{{ 'orgSettings.requireGpsLabel' | transloco }}</div>
                  <div class="vs-muted">{{ 'orgSettings.requireGpsHint' | transloco }}</div>
                </div>
              </label>
            </div>
            <ng-template #gpsUpgrade>
              <div class="ors-upgrade-card">
                <mat-icon>workspace_premium</mat-icon>
                <div>
                  <strong>{{ 'orgSettings.proFeatureTitle' | transloco }}</strong>
                  <div>{{ 'orgSettings.gpsUpgradeHint' | transloco }}</div>
                </div>
              </div>
            </ng-template>
          </div>
        </section>

        <section class="vs-glass-strong ors-section">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.sitesTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.sitesSubtitle' | transloco }}</div>
            </div>
            <div class="ors-site-actions">
              <span class="vs-badge" [class.vs-badge--warning]="hasMultiSite()" [class.vs-badge--neutral]="!hasMultiSite()">
                {{ (hasMultiSite() ? 'orgSettings.enterpriseMultiSite' : 'orgSettings.singleSiteMode') | transloco }}
              </span>
              <button class="vs-btn-ghost" (click)="addSite()" type="button" [disabled]="!canManageSites()">
                <mat-icon>add</mat-icon> {{ 'orgSettings.addSite' | transloco }}
              </button>
            </div>
          </div>
          <div class="vs-panel-body ors-form">
            <div *ngIf="draft.sites.length === 0" class="ors-empty-site vs-glass">
              <mat-icon>location_off</mat-icon>
              <div>
                <strong>{{ 'orgSettings.noSitesTitle' | transloco }}</strong>
                <div class="vs-muted">{{ 'orgSettings.noSitesHint' | transloco }}</div>
              </div>
            </div>

            <div class="ors-site-card" *ngFor="let site of draft.sites; index as i">
              <div class="ors-site-actions" style="justify-content:space-between;">
                <strong>{{ 'orgSettings.siteNumber' | transloco: { n: i + 1 } }}</strong>
                <button class="vs-btn-ghost" type="button" (click)="selectSite(i)">
                  <mat-icon>map</mat-icon> {{ 'orgSettings.editOnMap' | transloco }}
                </button>
              </div>
              <div class="vs-form-row vs-form-row--2">
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.siteNameLabel' | transloco }}</label>
                  <input class="vs-input" [(ngModel)]="site.name" [placeholder]="'orgSettings.siteNamePlaceholder' | transloco">
                </div>
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.addressLabel' | transloco }}</label>
                  <input class="vs-input" [(ngModel)]="site.address" [placeholder]="'orgSettings.addressPlaceholder' | transloco">
                </div>
              </div>
              <div class="vs-form-row vs-form-row--3">
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.latitudeLabel' | transloco }}</label>
                  <input class="vs-input" type="number" [(ngModel)]="site.latitude" (ngModelChange)="onSiteRadiusChange()" placeholder="33.7490">
                </div>
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.longitudeLabel' | transloco }}</label>
                  <input class="vs-input" type="number" [(ngModel)]="site.longitude" (ngModelChange)="onSiteRadiusChange()" placeholder="-84.3880">
                </div>
                <div>
                  <label class="vs-field-label">{{ 'orgSettings.radiusLabel' | transloco }}</label>
                  <input class="vs-input" type="number" min="25" [(ngModel)]="site.radiusM" (ngModelChange)="onSiteRadiusChange()" placeholder="150">
                </div>
              </div>
              <div class="ors-site-footer">
                <label class="ors-toggle-row">
                  <input type="checkbox" [(ngModel)]="site.active">
                  <div>
                    <div class="ors-toggle-title">{{ 'orgSettings.activeSiteLabel' | transloco }}</div>
                    <div class="vs-muted">{{ 'orgSettings.activeSiteHint' | transloco }}</div>
                  </div>
                </label>
                <button class="vs-btn-ghost" type="button" (click)="removeSite(i)">
                  <mat-icon>delete</mat-icon> {{ 'orgSettings.remove' | transloco }}
                </button>
              </div>
            </div>

            <div *ngIf="!canManageSites()" class="ors-upgrade-card">
              <mat-icon>lock</mat-icon>
              <div>
                <strong>{{ 'orgSettings.starterPlanTitle' | transloco }}</strong>
                <div>{{ 'orgSettings.sitesUpgradeHint' | transloco }}</div>
              </div>
            </div>

            <div class="ors-map-shell" *ngIf="canManageSites() && draft.sites.length > 0">
              <div class="vs-field-label">{{ 'orgSettings.geofenceMapLabel' | transloco }}</div>
              <div class="vs-muted" style="margin-bottom:8px;">{{ 'orgSettings.geofenceMapHint' | transloco }}</div>
              <div #geofenceMap class="ors-map"></div>
            </div>
          </div>
        </section>

        <section class="vs-glass-strong ors-section" *ngIf="hasEnterpriseControls(); else enterpriseUpgrade">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'orgSettings.enterpriseTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'orgSettings.enterpriseSubtitle' | transloco }}</div>
            </div>
            <mat-icon class="ors-section-icon">shield_lock</mat-icon>
          </div>
          <div class="vs-panel-body ors-form ors-stack">
            <label class="ors-toggle-row" *ngIf="hasSsoConfig()">
              <input type="checkbox" [(ngModel)]="draft.ssoEnabled">
              <div>
                <div class="ors-toggle-title">{{ 'orgSettings.enableSsoLabel' | transloco }}</div>
                <div class="vs-muted">{{ 'orgSettings.enableSsoHint' | transloco }}</div>
              </div>
            </label>

            <div *ngIf="hasSsoConfig()" class="vs-form-row">
              <div>
                <label class="vs-field-label">{{ 'orgSettings.idpLabel' | transloco }}</label>
                <input class="vs-input" [(ngModel)]="draft.ssoProvider" [placeholder]="'orgSettings.idpPlaceholder' | transloco">
              </div>
            </div>

            <div *ngIf="hasCustomIntegrations()">
              <div class="ors-subhead">{{ 'orgSettings.customIntegrationsHeader' | transloco }}</div>
              <div class="ors-site-card" *ngFor="let integration of draft.integrationConfigs; index as i">
                <div class="vs-form-row vs-form-row--2">
                  <div>
                    <label class="vs-field-label">{{ 'orgSettings.integrationLabelLabel' | transloco }}</label>
                    <input class="vs-input" [(ngModel)]="integration.label" [placeholder]="'orgSettings.integrationLabelPlaceholder' | transloco">
                  </div>
                  <div>
                    <label class="vs-field-label">{{ 'orgSettings.endpointNotesLabel' | transloco }}</label>
                    <input class="vs-input" [(ngModel)]="integration.endpoint" [placeholder]="'orgSettings.endpointNotesPlaceholder' | transloco">
                  </div>
                </div>
                <div class="ors-site-footer">
                  <label class="ors-toggle-row">
                    <input type="checkbox" [(ngModel)]="integration.active">
                    <div>
                      <div class="ors-toggle-title">{{ 'orgSettings.enabledLabel' | transloco }}</div>
                      <div class="vs-muted">{{ 'orgSettings.enabledHint' | transloco }}</div>
                    </div>
                  </label>
                  <button class="vs-btn-ghost" type="button" (click)="removeIntegration(i)">
                    <mat-icon>delete</mat-icon> {{ 'orgSettings.remove' | transloco }}
                  </button>
                </div>
              </div>
              <button class="vs-btn-ghost" type="button" (click)="addIntegration()">
                <mat-icon>add_link</mat-icon> {{ 'orgSettings.addIntegration' | transloco }}
              </button>
            </div>
          </div>
        </section>
        <ng-template #enterpriseUpgrade>
          <section class="vs-glass-strong ors-section">
            <div class="vs-panel-head">
              <div>
                <div class="vs-panel-title">{{ 'orgSettings.enterpriseTitle' | transloco }}</div>
                <div class="vs-panel-subtitle">{{ 'orgSettings.enterpriseUpgradeSubtitle' | transloco }}</div>
              </div>
              <mat-icon class="ors-section-icon">workspace_premium</mat-icon>
            </div>
            <div class="vs-panel-body">
              <div class="ors-upgrade-card">
                <mat-icon>workspace_premium</mat-icon>
                <div>
                  <strong>{{ 'orgSettings.enterpriseFeatureSetTitle' | transloco }}</strong>
                  <div>{{ 'orgSettings.enterpriseFeatureSetHint' | transloco }}</div>
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
            <span *ngIf="!saving()"><mat-icon>save</mat-icon> {{ 'orgSettings.saveChanges' | transloco }}</span>
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
    .ors-quick-set { display:flex; gap:6px; margin-top:6px; }
    .ors-quick-set-btn { padding:5px 10px !important; font-size:12px !important; }
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
    .ors-rollout-warning {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px 14px;
      margin-bottom: 14px;
      border-radius: var(--radius-md);
      border: 1px solid rgba(37, 99, 235, 0.22);
      background: rgba(37, 99, 235, 0.08);
      color: var(--text);
    }
    .ors-rollout-warning mat-icon { color: var(--primary); flex: 0 0 auto; }
    .ors-rollout-warning strong { display: block; font-weight: 900; margin-bottom: 2px; }
    .ors-rollout-warning span { color: var(--text-muted); font-size: 13px; line-height: 1.45; }
    .ors-industry-profile-body { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .ors-flag-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 12px;
    }
    .ors-flag-card {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 12px;
      align-items: center;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--panel);
      cursor: pointer;
    }
    .ors-flag-card input { width: 18px; height: 18px; accent-color: var(--primary); }
    .ors-flag-copy { display: grid; gap: 3px; min-width: 0; }
    .ors-flag-copy strong { color: var(--text); font-weight: 900; }
    .ors-flag-copy small { color: var(--text-muted); line-height: 1.35; }
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
  experienceFlagOptions = EXPERIENCE_FLAG_OPTIONS;
  selectedSiteIndex = 0;

  @ViewChild('geofenceMap') geofenceMap?: ElementRef<HTMLDivElement>;
  private platformId = inject(PLATFORM_ID);
  private L: typeof Leaflet | null = null;
  private map: Leaflet.Map | null = null;
  private marker: Leaflet.Marker | null = null;
  private circle: Leaflet.Circle | null = null;

  constructor(private ctx: OrgContextService, private toast: ToastService, private plans: PlanEntitlementsService, private experience: OrgExperienceService, private i18n: TranslocoService) {
    this.orgId = this.ctx.orgId();
  }

  experienceConfig() {
    return this.experience.config();
  }

  async ngOnInit() {
    this.handleBillingReturn();
    if (!this.orgId) return;
    try {
      const db = getFirestore();
      const snap = await getDoc(doc(db, 'orgs', this.orgId));
      if (snap.exists()) {
        const data = snap.data() as Partial<OrgSettings>;
        const loaded: OrgSettings = {
          ...DEFAULT_SETTINGS,
          ...data,
          experienceFlags: normalizeExperienceFlags((data as any).experienceFlags),
          dataRetention: { ...DEFAULT_DATA_RETENTION, ...(data as any).dataRetention },
        };
        // Real federal/state/FICA figures only make sense for a US org —
        // only apply them the first time (nothing saved yet for these fields).
        if (data.defaultFederalTaxPercent == null && data.defaultStateTaxPercent == null
          && data.defaultSocialSecurityPercent == null && data.defaultMedicarePercent == null) {
          const countryDefaults = defaultDeductionElectionsForCountry(loaded.countryCode);
          loaded.defaultFederalTaxPercent = countryDefaults.federalTaxPercent;
          loaded.defaultStateTaxPercent = countryDefaults.stateTaxPercent;
          loaded.defaultSocialSecurityPercent = countryDefaults.socialSecurityPercent;
          loaded.defaultMedicarePercent = countryDefaults.medicarePercent;
        }
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
    if (!isPlatformBrowser(this.platformId)) return;
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
    return this.taxProfiles.find((item) => item.value === profile)?.description ?? this.i18n.translate('orgSettings.manualTaxProfileFallback');
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
      this.toast.error(this.i18n.translate('orgSettings.siteRequiresProEnterprise'));
      return;
    }
    if (!this.hasMultiSite() && this.draft.sites.length >= 1) {
      this.toast.error(this.i18n.translate('orgSettings.multiSiteRequiresEnterprise'));
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

  useUsDeductionDefaults() {
    const defaults = defaultDeductionElectionsForCountry('US');
    this.draft.defaultFederalTaxPercent = defaults.federalTaxPercent;
    this.draft.defaultStateTaxPercent = defaults.stateTaxPercent;
    this.draft.defaultSocialSecurityPercent = defaults.socialSecurityPercent;
    this.draft.defaultMedicarePercent = defaults.medicarePercent;
  }

  confirmDataRetention() {
    this.draft = {
      ...this.draft,
      dataRetention: {
        ...this.draft.dataRetention,
        confirmedBy: this.ctx.displayName() || this.ctx.email() || this.ctx.uid() || this.i18n.translate('orgSettings.unknownConfirmedBy'),
        confirmedAt: new Date(),
      },
    };
  }

  experienceFlagEnabled(key: ExperienceFlagKey) {
    return normalizeExperienceFlags(this.draft.experienceFlags)[key] === true;
  }

  setExperienceFlag(key: ExperienceFlagKey, enabled: boolean) {
    this.draft = {
      ...this.draft,
      experienceFlags: {
        ...normalizeExperienceFlags(this.draft.experienceFlags),
        [key]: enabled,
      },
    };
  }

  formatConfirmedAt(): string {
    const value = this.draft.dataRetention.confirmedAt;
    const date = value?.toDate ? value.toDate() : value instanceof Date ? value : null;
    return date ? date.toLocaleDateString() : '';
  }

  addBenefitPlan() {
    this.draft = {
      ...this.draft,
      benefitPlans: [
        ...this.draft.benefitPlans,
        { id: this.createLocalId('benefit'), label: '', provider: '', employeeAmount: 0, employerAmount: 0 },
      ],
    };
  }

  removeBenefitPlan(index: number) {
    this.draft = {
      ...this.draft,
      benefitPlans: this.draft.benefitPlans.filter((_, i) => i !== index),
    };
  }

  addHoliday() {
    this.draft = {
      ...this.draft,
      holidays: [
        ...this.draft.holidays,
        { id: this.createLocalId('holiday'), name: '', date: '', paidHours: 8 },
      ],
    };
  }

  removeHoliday(index: number) {
    this.draft = {
      ...this.draft,
      holidays: this.draft.holidays.filter((_, i) => i !== index),
    };
  }

  addCustomJobRole() {
    this.draft = {
      ...this.draft,
      customJobRoles: [...this.draft.customJobRoles, ''],
    };
  }

  removeCustomJobRole(index: number) {
    this.draft = {
      ...this.draft,
      customJobRoles: this.draft.customJobRoles.filter((_, i) => i !== index),
    };
  }

  addCustomDocumentType() {
    this.draft = {
      ...this.draft,
      customDocumentTypes: [...this.draft.customDocumentTypes, ''],
    };
  }

  removeCustomDocumentType(index: number) {
    this.draft = {
      ...this.draft,
      customDocumentTypes: this.draft.customDocumentTypes.filter((_, i) => i !== index),
    };
  }

  addCustomSkill() {
    this.draft = {
      ...this.draft,
      customSkills: [...this.draft.customSkills, ''],
    };
  }

  removeCustomSkill(index: number) {
    this.draft = {
      ...this.draft,
      customSkills: this.draft.customSkills.filter((_, i) => i !== index),
    };
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

  private async ensureMapReady() {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.canManageSites()) return;
    if (this.map || !this.geofenceMap?.nativeElement) return;

    const L = this.L ?? (this.L = await import('leaflet'));

    this.map = L.map(this.geofenceMap.nativeElement, {
      center: [33.749, -84.388],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);

    this.map.on('click', (event: Leaflet.LeafletMouseEvent) => {
      const site = this.draft.sites[this.selectedSiteIndex];
      if (!site) return;
      site.latitude = Number(event.latlng.lat.toFixed(6));
      site.longitude = Number(event.latlng.lng.toFixed(6));
      this.refreshMapFromSelectedSite(false);
    });

    this.refreshMapFromSelectedSite();
  }

  private async refreshMapFromSelectedSite(recenter = true) {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.map) {
      await this.ensureMapReady();
      if (!this.map) return;
    }
    const L = this.L;
    if (!L) return;
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

    const center: Leaflet.LatLngExpression = [lat, lng];
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

      const normalizedHolidays: OrgHoliday[] = (this.draft.holidays || [])
        .map((h) => ({
          id: String(h.id || this.createLocalId('holiday')).trim(),
          name: String(h.name || '').trim(),
          date: String(h.date || '').trim(),
          paidHours: Math.max(0, Number(h.paidHours || 0)),
        }))
        .filter((h) => h.name && h.date);

      const normalizedBenefitPlans: BenefitLine[] = (this.draft.benefitPlans || [])
        .map((p) => ({
          id: String(p.id || this.createLocalId('benefit')).trim(),
          label: String(p.label || '').trim(),
          provider: String(p.provider || '').trim(),
          employeeAmount: Math.max(0, Number(p.employeeAmount || 0)),
          employerAmount: Math.max(0, Number(p.employerAmount || 0)),
        }))
        .filter((p) => p.label);

      const seenCustomJobRoles = new Set<string>();
      const normalizedCustomJobRoles: string[] = (this.draft.customJobRoles || [])
        .map((r) => String(r || '').trim())
        .filter((r) => {
          const key = r.toLowerCase();
          if (!r || key === 'other' || seenCustomJobRoles.has(key)) return false;
          seenCustomJobRoles.add(key);
          return true;
        })
        .slice(0, 25);

      const seenCustomDocumentTypes = new Set<string>();
      const normalizedCustomDocumentTypes: string[] = (this.draft.customDocumentTypes || [])
        .map((r) => String(r || '').trim())
        .filter((r) => {
          const key = r.toLowerCase();
          if (!r || key === 'other' || seenCustomDocumentTypes.has(key)) return false;
          seenCustomDocumentTypes.add(key);
          return true;
        })
        .slice(0, 25);

      const seenCustomSkills = new Set<string>();
      const normalizedCustomSkills: string[] = (this.draft.customSkills || [])
        .map((r) => String(r || '').trim())
        .filter((r) => {
          const key = r.toLowerCase();
          if (!r || key === 'other' || seenCustomSkills.has(key)) return false;
          seenCustomSkills.add(key);
          return true;
        })
        .slice(0, 25);

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

      const positiveYearsOrNull = (value: unknown): number | null => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
      };
      const normalizedDataRetention: DataRetentionSettings = {
        timeEntriesYears: positiveYearsOrNull(this.draft.dataRetention?.timeEntriesYears),
        payrollRunsYears: positiveYearsOrNull(this.draft.dataRetention?.payrollRunsYears),
        accrualLedgerYears: positiveYearsOrNull(this.draft.dataRetention?.accrualLedgerYears),
        timeOffRequestsYears: positiveYearsOrNull(this.draft.dataRetention?.timeOffRequestsYears),
        employeeDocumentsYearsAfterTermination: positiveYearsOrNull(this.draft.dataRetention?.employeeDocumentsYearsAfterTermination),
        confirmedBy: this.draft.dataRetention?.confirmedBy || null,
        confirmedAt: this.draft.dataRetention?.confirmedAt || null,
      };
      const normalizedExperienceFlags = normalizeExperienceFlags(this.draft.experienceFlags);

      const db = getFirestore();
      await setDoc(doc(db, 'orgs', this.orgId), {
        ...this.draft,
        countryCode: String(this.draft.countryCode || 'US').trim(),
        currencyCode: String(this.draft.currencyCode || 'USD').trim().toUpperCase(),
        payFrequency: this.draft.payFrequency || 'biweekly',
        taxProfile: this.draft.taxProfile || 'manual',
        payrollTaxNotes: String(this.draft.payrollTaxNotes || '').trim(),
        overtimeEnabled: this.draft.overtimeEnabled !== false,
        overtimeMultiplier: Math.max(1, Number(this.draft.overtimeMultiplier || 1.5)),
        overtimeWeeklyThresholdHours: Math.max(1, Number(this.draft.overtimeWeeklyThresholdHours || 40)),
        holidayWorkMultiplier: Math.max(1, Number(this.draft.holidayWorkMultiplier || 1.5)),
        minRestHours: Math.max(1, Number(this.draft.minRestHours || 8)),
        maxConsecutiveDays: Math.max(1, Number(this.draft.maxConsecutiveDays || 6)),
        maxWeeklyScheduledHours: Math.max(1, Number(this.draft.maxWeeklyScheduledHours || 60)),
        holidays: normalizedHolidays,
        customJobRoles: normalizedCustomJobRoles,
        customDocumentTypes: normalizedCustomDocumentTypes,
        customSkills: normalizedCustomSkills,
        defaultFederalTaxPercent: Math.max(0, Number(this.draft.defaultFederalTaxPercent || 0)),
        defaultStateTaxPercent: Math.max(0, Number(this.draft.defaultStateTaxPercent || 0)),
        defaultSocialSecurityPercent: Math.max(0, Number(this.draft.defaultSocialSecurityPercent || 0)),
        defaultMedicarePercent: Math.max(0, Number(this.draft.defaultMedicarePercent || 0)),
        default401kMatchPercent: Math.max(0, Number(this.draft.default401kMatchPercent || 0)),
        default401kProvider: String(this.draft.default401kProvider || '').trim(),
        benefitPlans: normalizedBenefitPlans,
        experienceFlags: normalizedExperienceFlags,
        dataRetention: normalizedDataRetention,
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
      this.settings.set({ ...this.draft, sites: normalizedSites, accrualPolicy: normalizedAccrualPolicy, holidays: normalizedHolidays, customJobRoles: normalizedCustomJobRoles, customDocumentTypes: normalizedCustomDocumentTypes, customSkills: normalizedCustomSkills, benefitPlans: normalizedBenefitPlans, experienceFlags: normalizedExperienceFlags, dataRetention: normalizedDataRetention });
      this.draft = { ...this.draft, sites: normalizedSites, accrualPolicy: normalizedAccrualPolicy, holidays: normalizedHolidays, customJobRoles: normalizedCustomJobRoles, customDocumentTypes: normalizedCustomDocumentTypes, customSkills: normalizedCustomSkills, benefitPlans: normalizedBenefitPlans, experienceFlags: normalizedExperienceFlags, dataRetention: normalizedDataRetention };
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
      this.saveMsg.set(this.i18n.translate('orgSettings.settingsSaved'));
      setTimeout(() => this.saveMsg.set(null), 4000);
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('orgSettings.failedToSaveSettings'));
    } finally {
      this.saving.set(false);
    }
  }

  private handleBillingReturn() {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get('billing');
    if (!billing) return;
    if (billing === 'success') {
      this.toast.success(this.i18n.translate('orgSettings.subscriptionUpdated'));
    } else if (billing === 'cancel') {
      this.toast.info(this.i18n.translate('orgSettings.checkoutCanceled'));
    }
    params.delete('billing');
    const query = params.toString();
    history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
  }

  async manageBilling() {
    if (!this.orgId) return;
    if (!this.hasBillingCustomer()) {
      this.toast.info(this.i18n.translate('orgSettings.noBillingCustomerYet'));
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
        this.toast.info(this.i18n.translate('orgSettings.noBillingCustomerYetUpgrade'));
        return;
      }
      this.toast.errorFrom(e, this.i18n.translate('orgSettings.failedToOpenPortal'));
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
        this.toast.error(this.i18n.translate('orgSettings.billingNotConfigured'));
        return;
      }
      this.toast.errorFrom(e, this.i18n.translate('orgSettings.failedToStartCheckout'));
    } finally {
      this.billingBusy.set(false);
    }
  }
}
