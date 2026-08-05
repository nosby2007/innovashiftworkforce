import { describe, expect, it } from 'vitest';
import { GENERIC_WORKFORCE_SNAPSHOT, legacyFallbackConfig } from './experience-config.defaults';

describe('experience-config.defaults', () => {
  it('locks generic terminology to today\'s exact hardcoded copy', () => {
    expect(GENERIC_WORKFORCE_SNAPSHOT.terminology).toEqual({
      workUnit: { singular: 'Shift', plural: 'Shifts' },
      workforceMember: { singular: 'Employee', plural: 'Employees' },
      department: { singular: 'Department', plural: 'Departments' },
      location: { singular: 'Location', plural: 'Locations' },
      marketplaceLabel: 'Staff Marketplace',
      scheduleLabel: 'Schedule',
    });
  });

  it('leaves every later-phase section inert (no-op shape)', () => {
    expect(GENERIC_WORKFORCE_SNAPSHOT.workforceModel.jobRoleCatalogId).toBeNull();
    expect(GENERIC_WORKFORCE_SNAPSHOT.scheduling.overtimeRulesId).toBeNull();
    expect(GENERIC_WORKFORCE_SNAPSHOT.onboarding.requiredDocumentTypeIds).toEqual([]);
    expect(GENERIC_WORKFORCE_SNAPSHOT.attendance.geofenceStrictness).toBe('default');
    expect(GENERIC_WORKFORCE_SNAPSHOT.navigation.hiddenNavKeys).toEqual([]);
    expect(GENERIC_WORKFORCE_SNAPSHOT.ai.industryContextPrompt).toBeNull();
    expect(GENERIC_WORKFORCE_SNAPSHOT.features.recommendedPlanFeatures).toEqual([]);
  });

  it('legacyFallbackConfig marks the org as legacy with the generic snapshot', () => {
    const cfg = legacyFallbackConfig('org-123');
    expect(cfg.orgId).toBe('org-123');
    expect(cfg.configurationStatus).toBe('legacy');
    expect(cfg.selection).toBeNull();
    expect(cfg.industryProfileId).toBe('generic_workforce');
    expect(cfg.snapshot).toBe(GENERIC_WORKFORCE_SNAPSHOT);
  });
});
