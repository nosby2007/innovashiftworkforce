/**
 * Industry Configuration Engine — Phase 1 core types (backend mirror).
 *
 * This repo has no shared frontend/backend types package — types like
 * AccessRole are independently duplicated on each side (see infra/tenancy.ts
 * vs. org-context.service.ts). This file follows that existing convention;
 * keep it in sync with
 * frontend-angular/src/app/shared/models/experience-config.model.ts by hand.
 */

export interface TerminologyTerm {
  singular: string;
  plural: string;
}

export interface TerminologyConfig {
  workUnit: TerminologyTerm;
  workforceMember: TerminologyTerm;
  department: TerminologyTerm;
  location: TerminologyTerm;
  marketplaceLabel: string;
  scheduleLabel: string;
}

export interface JobRoleOption {
  value: string;
  label: string;
}

export interface WorkforceModelConfig {
  jobRoleCatalogId: string | null;
  supportsMultiRoleShifts: boolean;
  recommendedJobRoles?: JobRoleOption[];
}

export interface SchedulingConfig {
  defaultShiftLengthHours: number | null;
  overtimeRulesId: string | null;
}

export interface OnboardingConfig {
  requiredDocumentTypeIds: string[];
}

export interface ComplianceConfig {
  regulatoryNotes: string | null;
}

export interface PayrollConfig {
  notes: string | null;
}

export interface AttendanceConfig {
  geofenceStrictness: 'default' | 'strict' | 'relaxed';
}

export interface NavigationConfig {
  hiddenNavKeys: string[];
}

export interface DashboardsConfig {
  widgetSetId: string | null;
  hiddenWidgetKeys?: string[];
}

export interface AiConfig {
  industryContextPrompt: string | null;
}

export type PlanFeatureLike =
  | 'adminAnalytics'
  | 'smartScheduler'
  | 'timesheetsExport'
  | 'auditLog'
  | 'gpsAttendance'
  | 'multiSiteManagement'
  | 'ssoConfig'
  | 'customIntegrations'
  | 'aiCopilot';

export interface FeaturesConfig {
  recommendedPlanFeatures: PlanFeatureLike[];
}

export interface OrganizationExperienceSnapshot {
  terminology: TerminologyConfig;
  workforceModel: WorkforceModelConfig;
  scheduling: SchedulingConfig;
  onboarding: OnboardingConfig;
  compliance: ComplianceConfig;
  payroll: PayrollConfig;
  attendance: AttendanceConfig;
  navigation: NavigationConfig;
  dashboards: DashboardsConfig;
  ai: AiConfig;
  features: FeaturesConfig;
}

export type IndustryProfileCategory = 'generic' | 'healthcare' | 'education' | 'hospitality' | 'other';

export interface IndustryProfileVersion {
  versionId: string;
  profileId: string;
  status: 'draft' | 'published';
  terminology: TerminologyConfig;
  workforceModel: WorkforceModelConfig;
  scheduling: SchedulingConfig;
  onboarding: OnboardingConfig;
  compliance: ComplianceConfig;
  payroll: PayrollConfig;
  attendance: AttendanceConfig;
  navigation: NavigationConfig;
  dashboards: DashboardsConfig;
  ai: AiConfig;
  features: FeaturesConfig;
  createdAt?: any;
  createdBy?: string;
  publishedAt?: any | null;
}

/** Deep-copies a published version's config sections into a new snapshot object — never a live reference. */
export function buildSnapshotFromVersion(version: IndustryProfileVersion): OrganizationExperienceSnapshot {
  return {
    terminology: JSON.parse(JSON.stringify(version.terminology)),
    workforceModel: JSON.parse(JSON.stringify(version.workforceModel)),
    scheduling: JSON.parse(JSON.stringify(version.scheduling)),
    onboarding: JSON.parse(JSON.stringify(version.onboarding)),
    compliance: JSON.parse(JSON.stringify(version.compliance)),
    payroll: JSON.parse(JSON.stringify(version.payroll)),
    attendance: JSON.parse(JSON.stringify(version.attendance)),
    navigation: JSON.parse(JSON.stringify(version.navigation)),
    dashboards: JSON.parse(JSON.stringify(version.dashboards)),
    ai: JSON.parse(JSON.stringify(version.ai)),
    features: JSON.parse(JSON.stringify(version.features)),
  };
}

/**
 * SuperAdmin may activate a profile for any org. A regular caller may only
 * activate for their own org, and only with the admin role specifically —
 * this changes terminology/workforce-model shape org-wide, structurally
 * significant enough to restrict the same way this codebase already
 * restricts payroll/tax settings (not manager/scheduler/hr).
 */
export function canActivateIndustryProfile(
  caller: { uid: string; orgId?: string; accessRole?: string; platformRole?: string },
  targetOrgId: string
): boolean {
  if (caller.platformRole === 'superAdmin') return true;
  return caller.accessRole === 'admin' && caller.orgId === targetOrgId;
}
