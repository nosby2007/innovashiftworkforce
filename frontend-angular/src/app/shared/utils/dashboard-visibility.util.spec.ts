import { describe, it, expect } from 'vitest';
import { isNavKeyHidden, isWidgetHidden } from './dashboard-visibility.util';
import { OrganizationExperienceConfig } from '../models/experience-config.model';

function baseSnapshot(hiddenNavKeys: string[], hiddenWidgetKeys?: string[]): OrganizationExperienceConfig['snapshot'] {
  return {
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
    navigation: { hiddenNavKeys },
    dashboards: { widgetSetId: null, hiddenWidgetKeys },
    ai: { industryContextPrompt: null },
    features: { recommendedPlanFeatures: [] },
  };
}

describe('isNavKeyHidden', () => {
  it('never hides anything for a legacy (unconfigured) org, regardless of key', () => {
    const experience = { configurationStatus: 'legacy' as const, snapshot: baseSnapshot(['quickLinks.payroll']) };
    expect(isNavKeyHidden('quickLinks.payroll', experience)).toBe(false);
  });

  it('returns false when experience is null or undefined', () => {
    expect(isNavKeyHidden('quickLinks.payroll', null)).toBe(false);
    expect(isNavKeyHidden('quickLinks.payroll', undefined)).toBe(false);
  });

  it('hides a key present in a configured profile\'s hiddenNavKeys', () => {
    const experience = { configurationStatus: 'configured' as const, snapshot: baseSnapshot(['quickLinks.payroll']) };
    expect(isNavKeyHidden('quickLinks.payroll', experience)).toBe(true);
  });

  it('does not hide a key absent from a configured profile\'s hiddenNavKeys', () => {
    const experience = { configurationStatus: 'configured' as const, snapshot: baseSnapshot(['quickLinks.payroll']) };
    expect(isNavKeyHidden('quickLinks.auditLog', experience)).toBe(false);
  });

  it('does not hide anything when hiddenNavKeys is empty (the default for every seed profile today)', () => {
    const experience = { configurationStatus: 'configured' as const, snapshot: baseSnapshot([]) };
    expect(isNavKeyHidden('quickLinks.payroll', experience)).toBe(false);
  });
});

describe('isWidgetHidden', () => {
  it('never hides anything for a legacy (unconfigured) org, regardless of key', () => {
    const experience = { configurationStatus: 'legacy' as const, snapshot: baseSnapshot([], ['widgets.kpiCoverageRate']) };
    expect(isWidgetHidden('widgets.kpiCoverageRate', experience)).toBe(false);
  });

  it('returns false when experience is null or undefined', () => {
    expect(isWidgetHidden('widgets.kpiCoverageRate', null)).toBe(false);
    expect(isWidgetHidden('widgets.kpiCoverageRate', undefined)).toBe(false);
  });

  it('hides a key present in a configured profile\'s hiddenWidgetKeys', () => {
    const experience = { configurationStatus: 'configured' as const, snapshot: baseSnapshot([], ['widgets.kpiCoverageRate']) };
    expect(isWidgetHidden('widgets.kpiCoverageRate', experience)).toBe(true);
  });

  it('does not hide a key absent from a configured profile\'s hiddenWidgetKeys', () => {
    const experience = { configurationStatus: 'configured' as const, snapshot: baseSnapshot([], ['widgets.kpiCoverageRate']) };
    expect(isWidgetHidden('widgets.kpiAssigned', experience)).toBe(false);
  });

  it('does not hide anything when hiddenWidgetKeys is empty (the default for every seed profile today)', () => {
    const experience = { configurationStatus: 'configured' as const, snapshot: baseSnapshot([], []) };
    expect(isWidgetHidden('widgets.kpiCoverageRate', experience)).toBe(false);
  });

  it('does not hide anything when hiddenWidgetKeys is undefined (defensive, field is optional)', () => {
    const experience = { configurationStatus: 'configured' as const, snapshot: baseSnapshot([]) };
    expect(isWidgetHidden('widgets.kpiCoverageRate', experience)).toBe(false);
  });
});
