import {
  OrganizationExperienceConfig,
  OrganizationExperienceSnapshot,
} from './experience-config.model';

/**
 * Terminology values here must stay byte-identical to today's hardcoded UI
 * copy — that's what makes this a safe, invisible default for every
 * existing org. If you're changing a value here, you're changing what
 * every unconfigured org sees; experience-config.defaults.spec.ts locks
 * this contract.
 */
export const GENERIC_WORKFORCE_SNAPSHOT: OrganizationExperienceSnapshot = {
  terminology: {
    workUnit: { singular: 'Shift', plural: 'Shifts' },
    workforceMember: { singular: 'Employee', plural: 'Employees' },
    department: { singular: 'Department', plural: 'Departments' },
    location: { singular: 'Location', plural: 'Locations' },
    marketplaceLabel: 'Staff Marketplace',
    scheduleLabel: 'Schedule',
  },
  workforceModel: {
    jobRoleCatalogId: null,
    supportsMultiRoleShifts: true,
  },
  scheduling: {
    defaultShiftLengthHours: null,
    overtimeRulesId: null,
  },
  onboarding: {
    requiredDocumentTypeIds: [],
  },
  compliance: {
    regulatoryNotes: null,
  },
  payroll: {
    notes: null,
  },
  attendance: {
    geofenceStrictness: 'default',
  },
  navigation: {
    hiddenNavKeys: [],
  },
  dashboards: {
    widgetSetId: null,
    hiddenWidgetKeys: [],
  },
  ai: {
    industryContextPrompt: null,
  },
  features: {
    recommendedPlanFeatures: [],
  },
};

/**
 * Every org that hasn't activated an industry profile resolves to this.
 * A missing `orgs/{orgId}/experience/config` doc IS the "legacy" signal —
 * there is no backfill/migration that writes this doc to existing orgs.
 */
export function legacyFallbackConfig(orgId: string): OrganizationExperienceConfig {
  return {
    orgId,
    configurationStatus: 'legacy',
    selection: null,
    industryProfileId: 'generic_workforce',
    industryProfileVersionId: null,
    snapshot: GENERIC_WORKFORCE_SNAPSHOT,
    activatedAt: null,
    activatedBy: null,
  };
}
