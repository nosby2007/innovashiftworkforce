/**
 * Industry Configuration Engine — Phase 1 core types.
 *
 * An OrganizationExperienceConfig is an immutable snapshot taken at
 * activation time from a published IndustryProfile version. It is never a
 * live join against the global catalog — editing a profile later must not
 * silently change the behavior of an org that already activated it.
 *
 * Sections beyond `terminology` are intentionally inert in Phase 1 (correct
 * shape, nothing reads them yet). Each is annotated with the phase that will
 * start consuming it, so this reads as forward schema, not dead code.
 */

export interface TerminologyTerm {
  singular: string;
  plural: string;
}

export interface TerminologyConfig {
  workUnit: TerminologyTerm;         // "Shift" (generic/healthcare/restaurant) → "Class Session" (education)
  workforceMember: TerminologyTerm;  // "Employee" → "Instructor"
  department: TerminologyTerm;       // "Department" → "Program" / "Station"
  location: TerminologyTerm;         // "Location" → "Campus" / "Facility"
  marketplaceLabel: string;          // "Shift Marketplace" → "Open Class Board"
  scheduleLabel: string;             // "Schedule" → "Class Schedule"
}

export interface JobRoleOption {
  value: string;
  label: string;
}

/** jobRoleCatalogId: FK into a future org-configurable job-role catalog, still unread. recommendedJobRoles (Phase 3b): dropdown options for an activated profile — optional, so absent/empty falls back to job-role-catalog.util.ts's getJobRoleOptions(orgIndustry). */
export interface WorkforceModelConfig {
  jobRoleCatalogId: string | null;
  supportsMultiRoleShifts: boolean;
  recommendedJobRoles?: JobRoleOption[];
}

/** Phase 4: configurable scheduling-rule engine. Unread in Phase 1. */
export interface SchedulingConfig {
  defaultShiftLengthHours: number | null;
  overtimeRulesId: string | null;
}

/** Phase 3: configurable document-requirement catalog. [] = today's fixed EmployeeDocumentType union, unchanged. */
export interface OnboardingConfig {
  requiredDocumentTypeIds: string[];
}

/** Advisory text only, never legal advice. Unread in Phase 1. */
export interface ComplianceConfig {
  regulatoryNotes: string | null;
}

/** Advisory notes only — payFrequency/taxProfile stay owned by orgs/{orgId}, never overridden here. */
export interface PayrollConfig {
  notes: string | null;
}

/** Phase 4: geofence strictness presets. Unread by checkInOut.ts in Phase 1. */
export interface AttendanceConfig {
  geofenceStrictness: 'default' | 'strict' | 'relaxed';
}

/** Phase 4: dynamic nav/dashboard config. [] = no nav item hidden. */
export interface NavigationConfig {
  hiddenNavKeys: string[];
}

/** Phase 4: configurable dashboard widgets. Unread in Phase 1. */
export interface DashboardsConfig {
  widgetSetId: string | null;
}

/** Phase 3: spliced into aiAssistantChat.ts's system prompt. aiAssistantChat.ts is not touched in Phase 1. */
export interface AiConfig {
  industryContextPrompt: string | null;
}

/**
 * Duplicates PlanEntitlementsService's PlanFeature string union rather than
 * importing it — this keeps the model free of any dependency that could
 * tempt someone into wiring subscription-entitlement logic here.
 * recommendedPlanFeatures is a display-only hint (Phase 2 UI); it must never
 * gate access on its own. See plan-entitlements.service.spec.ts.
 */
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

export interface OrganizationIndustrySelection {
  industryProfileId: string;
  industryProfileVersionId: string;
  selectedAt: any; // Firestore Timestamp
  selectedBy: string;
  notes?: string | null;
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

export type ConfigurationStatus = 'legacy' | 'configured';

export interface OrganizationExperienceConfig {
  orgId: string;
  configurationStatus: ConfigurationStatus;
  selection: OrganizationIndustrySelection | null;
  industryProfileId: string | null;
  industryProfileVersionId: string | null;
  snapshot: OrganizationExperienceSnapshot;
  activatedAt: any | null;
  activatedBy: string | null;
  createdAt?: any;
  updatedAt?: any;
}

export type IndustryProfileCategory = 'generic' | 'healthcare' | 'education' | 'hospitality' | 'other';

export interface IndustryProfile {
  id: string;
  name: string;
  description: string;
  category: IndustryProfileCategory;
  active: boolean;
  latestVersionId: string | null;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

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
