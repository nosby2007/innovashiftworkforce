import { describe, it, expect } from 'vitest';
import { getJobRoleOptions, resolveJobRoleOptions } from './job-role-catalog.util';
import { OrganizationExperienceConfig } from '../models/experience-config.model';

function baseSnapshot(recommendedJobRoles?: { value: string; label: string }[]): OrganizationExperienceConfig['snapshot'] {
  return {
    terminology: {
      workUnit: { singular: 'Shift', plural: 'Shifts' },
      workforceMember: { singular: 'Employee', plural: 'Employees' },
      department: { singular: 'Department', plural: 'Departments' },
      location: { singular: 'Location', plural: 'Locations' },
      marketplaceLabel: 'Staff Marketplace',
      scheduleLabel: 'Schedule',
    },
    workforceModel: { jobRoleCatalogId: null, supportsMultiRoleShifts: true, recommendedJobRoles },
    scheduling: { defaultShiftLengthHours: null, overtimeRulesId: null },
    onboarding: { requiredDocumentTypeIds: [] },
    compliance: { regulatoryNotes: null },
    payroll: { notes: null },
    attendance: { geofenceStrictness: 'default' },
    navigation: { hiddenNavKeys: [] },
    dashboards: { widgetSetId: null },
    ai: { industryContextPrompt: null },
    features: { recommendedPlanFeatures: [] },
  };
}

describe('resolveJobRoleOptions', () => {
  it('falls back to getJobRoleOptions for a legacy (unconfigured) org', () => {
    const result = resolveJobRoleOptions('Healthcare', {
      configurationStatus: 'legacy',
      snapshot: baseSnapshot(),
    } as OrganizationExperienceConfig);
    expect(result).toEqual(getJobRoleOptions('Healthcare'));
  });

  it('falls back to getJobRoleOptions when experience is null or undefined', () => {
    expect(resolveJobRoleOptions('Healthcare', null)).toEqual(getJobRoleOptions('Healthcare'));
    expect(resolveJobRoleOptions('Retail', undefined)).toEqual(getJobRoleOptions('Retail'));
  });

  it('uses the activated profile\'s recommendedJobRoles when configured and non-empty', () => {
    const recommended = [
      { value: 'Teacher', label: 'Teacher' },
      { value: 'Principal', label: 'Principal' },
      { value: 'Other', label: 'Other' },
    ];
    const result = resolveJobRoleOptions('Education', {
      configurationStatus: 'configured',
      snapshot: baseSnapshot(recommended),
    } as OrganizationExperienceConfig);
    expect(result).toEqual(recommended);
  });

  it('falls back to getJobRoleOptions when configured but recommendedJobRoles is empty or missing', () => {
    const emptyResult = resolveJobRoleOptions('Healthcare', {
      configurationStatus: 'configured',
      snapshot: baseSnapshot([]),
    } as OrganizationExperienceConfig);
    expect(emptyResult).toEqual(getJobRoleOptions('Healthcare'));

    const missingResult = resolveJobRoleOptions('Healthcare', {
      configurationStatus: 'configured',
      snapshot: baseSnapshot(undefined),
    } as OrganizationExperienceConfig);
    expect(missingResult).toEqual(getJobRoleOptions('Healthcare'));
  });
});
