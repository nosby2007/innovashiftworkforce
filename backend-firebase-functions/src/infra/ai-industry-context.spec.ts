import { describe, it, expect } from 'vitest';
import { GENERIC_AI_CONTEXT_LINE, resolveAiIndustryContext } from './ai-industry-context';

describe('resolveAiIndustryContext', () => {
  it('returns the generic line with no terminology hint when no config doc exists', () => {
    const result = resolveAiIndustryContext(null);
    expect(result.contextLine).toBe(GENERIC_AI_CONTEXT_LINE);
    expect(result.terminologyHint).toBe('');
  });

  it('returns the generic line for a legacy (unconfigured) org', () => {
    const result = resolveAiIndustryContext({
      configurationStatus: 'legacy',
      snapshot: {
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
        ai: { industryContextPrompt: 'should be ignored for a legacy org' },
        features: { recommendedPlanFeatures: [] },
      },
    });
    expect(result.contextLine).toBe(GENERIC_AI_CONTEXT_LINE);
    expect(result.terminologyHint).toBe('');
  });

  it('uses the activated profile\'s industryContextPrompt and terminology for a configured org', () => {
    const result = resolveAiIndustryContext({
      configurationStatus: 'configured',
      snapshot: {
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
        compliance: { regulatoryNotes: null },
        payroll: { notes: null },
        attendance: { geofenceStrictness: 'default' },
        navigation: { hiddenNavKeys: [] },
        dashboards: { widgetSetId: null },
        ai: { industryContextPrompt: 'Education framing here.' },
        features: { recommendedPlanFeatures: [] },
      },
    });
    expect(result.contextLine).toBe('Education framing here.');
    expect(result.terminologyHint).toContain('Class Session');
    expect(result.terminologyHint).toContain('Instructors');
  });

  it('falls back to the generic line when configured but industryContextPrompt is null', () => {
    const result = resolveAiIndustryContext({
      configurationStatus: 'configured',
      snapshot: {
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
    });
    expect(result.contextLine).toBe(GENERIC_AI_CONTEXT_LINE);
    // still includes a terminology hint, since the org IS configured (just with no custom prompt)
    expect(result.terminologyHint).toContain('Shift');
  });
});
