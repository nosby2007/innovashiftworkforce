import { describe, it, expect } from 'vitest';
import { getJobRoleOptions, resolveJobRoleOptions, mergeCustomJobRoles } from './job-role-catalog.util';
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

describe('mergeCustomJobRoles', () => {
  const base = getJobRoleOptions('Retail'); // GENERIC_ROLES, ends with Other

  it('returns base unchanged when customRoles is null, undefined, or empty', () => {
    expect(mergeCustomJobRoles(base, null)).toEqual(base);
    expect(mergeCustomJobRoles(base, undefined)).toEqual(base);
    expect(mergeCustomJobRoles(base, [])).toEqual(base);
  });

  it('inserts custom roles before the trailing Other entry', () => {
    const result = mergeCustomJobRoles(base, ['Barista']);
    expect(result[result.length - 1]).toEqual({ value: 'Other', label: 'Other' });
    expect(result.find((o) => o.value === 'Barista')).toEqual({ value: 'Barista', label: 'Barista' });
    expect(result.length).toBe(base.length + 1);
  });

  it('appends at the end when base has no Other entry', () => {
    const noOther = base.filter((o) => o.value !== 'Other');
    const result = mergeCustomJobRoles(noOther, ['Barista']);
    expect(result[result.length - 1]).toEqual({ value: 'Barista', label: 'Barista' });
  });

  it('dedupes case-insensitively against the base list', () => {
    const result = mergeCustomJobRoles(base, ['manager', 'ADMIN']);
    expect(result.length).toBe(base.length);
  });

  it('dedupes case-insensitively against itself', () => {
    const result = mergeCustomJobRoles(base, ['Barista', 'barista', 'BARISTA']);
    expect(result.filter((o) => o.value.toLowerCase() === 'barista').length).toBe(1);
  });

  it('drops blank entries and a literal "Other" (case-insensitive)', () => {
    const result = mergeCustomJobRoles(base, ['', '   ', 'other', 'OTHER']);
    expect(result).toEqual(base);
  });

  it('trims whitespace from custom role names', () => {
    const result = mergeCustomJobRoles(base, ['  Barista  ']);
    expect(result.find((o) => o.value === 'Barista')).toBeTruthy();
  });
});
