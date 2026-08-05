import { IndustryProfileCategory, IndustryProfileVersion } from './experience-config';

/**
 * Source of truth for the 4 Phase-1 seed profiles. Consumed by
 * tools/seed-industry-profiles.mjs (data is inlined there too, matching
 * bootstrap-superadmin.mjs's style, to avoid a build-order dependency on
 * compiled lib/ output) and by activateIndustryProfile.spec.ts for
 * realistic fixtures.
 *
 * generic_workforce's terminology is intentionally identical to
 * GENERIC_WORKFORCE_SNAPSHOT in
 * frontend-angular/src/app/shared/models/experience-config.defaults.ts —
 * activating it explicitly must produce the same result as the lazy
 * legacy fallback.
 */

export interface IndustryProfileSeed {
  id: string;
  name: string;
  description: string;
  category: IndustryProfileCategory;
  version: Omit<IndustryProfileVersion, 'createdAt' | 'createdBy' | 'publishedAt'>;
}

export const INDUSTRY_PROFILE_SEEDS: IndustryProfileSeed[] = [
  {
    id: 'generic_workforce',
    name: 'Generic Workforce',
    description: 'A general-purpose configuration for organizations that don\'t fit a specific vertical.',
    category: 'generic',
    version: {
      versionId: 'v1',
      profileId: 'generic_workforce',
      status: 'published',
      terminology: {
        workUnit: { singular: 'Shift', plural: 'Shifts' },
        workforceMember: { singular: 'Employee', plural: 'Employees' },
        department: { singular: 'Department', plural: 'Departments' },
        location: { singular: 'Location', plural: 'Locations' },
        marketplaceLabel: 'Staff Marketplace',
        scheduleLabel: 'Schedule',
      },
      workforceModel: { jobRoleCatalogId: null, supportsMultiRoleShifts: true },
      scheduling: { defaultShiftLengthHours: null, overtimeRulesId: null },
      onboarding: { requiredDocumentTypeIds: [] },
      compliance: { regulatoryNotes: null },
      payroll: { notes: null },
      attendance: { geofenceStrictness: 'default' },
      navigation: { hiddenNavKeys: [] },
      dashboards: { widgetSetId: null },
      ai: { industryContextPrompt: null },
      features: { recommendedPlanFeatures: [] },
    },
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    description: 'Coordinate clinical and support staff, qualifications, coverage and compliance.',
    category: 'healthcare',
    version: {
      versionId: 'v1',
      profileId: 'healthcare',
      status: 'published',
      terminology: {
        workUnit: { singular: 'Shift', plural: 'Shifts' },
        workforceMember: { singular: 'Staff Member', plural: 'Staff' },
        department: { singular: 'Unit', plural: 'Units' },
        location: { singular: 'Facility', plural: 'Facilities' },
        marketplaceLabel: 'Open Shift Board',
        scheduleLabel: 'Schedule',
      },
      workforceModel: { jobRoleCatalogId: null, supportsMultiRoleShifts: true },
      scheduling: { defaultShiftLengthHours: null, overtimeRulesId: null },
      onboarding: { requiredDocumentTypeIds: [] },
      compliance: { regulatoryNotes: 'Recommended only — confirm licensure and credentialing requirements with your compliance team.' },
      payroll: { notes: null },
      attendance: { geofenceStrictness: 'default' },
      navigation: { hiddenNavKeys: [] },
      dashboards: { widgetSetId: null },
      ai: { industryContextPrompt: null },
      features: { recommendedPlanFeatures: ['gpsAttendance'] },
    },
  },
  {
    id: 'education',
    name: 'Education',
    description: 'Plan teachers, administrators, substitutes, transport and campus staff.',
    category: 'education',
    version: {
      versionId: 'v1',
      profileId: 'education',
      status: 'published',
      terminology: {
        workUnit: { singular: 'Class Session', plural: 'Class Sessions' },
        workforceMember: { singular: 'Instructor', plural: 'Instructors' },
        department: { singular: 'Program', plural: 'Programs' },
        location: { singular: 'Campus', plural: 'Campuses' },
        marketplaceLabel: 'Open Class Board',
        scheduleLabel: 'Class Schedule',
      },
      workforceModel: { jobRoleCatalogId: null, supportsMultiRoleShifts: true },
      scheduling: { defaultShiftLengthHours: null, overtimeRulesId: null },
      onboarding: { requiredDocumentTypeIds: [] },
      compliance: { regulatoryNotes: 'Recommended only — confirm background-check and safeguarding requirements with your compliance team.' },
      payroll: { notes: null },
      attendance: { geofenceStrictness: 'default' },
      navigation: { hiddenNavKeys: [] },
      dashboards: { widgetSetId: null },
      ai: { industryContextPrompt: null },
      features: { recommendedPlanFeatures: [] },
    },
  },
  {
    id: 'restaurant_food_service',
    name: 'Restaurant & Food Service',
    description: 'Coordinate front-of-house, kitchen, managers, opening and closing coverage.',
    category: 'other',
    version: {
      versionId: 'v1',
      profileId: 'restaurant_food_service',
      status: 'published',
      terminology: {
        workUnit: { singular: 'Shift', plural: 'Shifts' },
        workforceMember: { singular: 'Team Member', plural: 'Team Members' },
        department: { singular: 'Station', plural: 'Stations' },
        location: { singular: 'Restaurant', plural: 'Restaurants' },
        marketplaceLabel: 'Open Shift Board',
        scheduleLabel: 'Schedule',
      },
      workforceModel: { jobRoleCatalogId: null, supportsMultiRoleShifts: true },
      scheduling: { defaultShiftLengthHours: null, overtimeRulesId: null },
      onboarding: { requiredDocumentTypeIds: [] },
      compliance: { regulatoryNotes: 'Recommended only — confirm food-handler and alcohol-service certification requirements with your compliance team.' },
      payroll: { notes: null },
      attendance: { geofenceStrictness: 'default' },
      navigation: { hiddenNavKeys: [] },
      dashboards: { widgetSetId: null },
      ai: { industryContextPrompt: null },
      features: { recommendedPlanFeatures: [] },
    },
  },
];
