import { describe, it, expect } from 'vitest';
import { buildSnapshotFromVersion, IndustryProfileVersion } from './experience-config';

function makeVersion(): IndustryProfileVersion {
  return {
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
    compliance: { regulatoryNotes: null },
    payroll: { notes: null },
    attendance: { geofenceStrictness: 'default' },
    navigation: { hiddenNavKeys: [] },
    dashboards: { widgetSetId: null },
    ai: { industryContextPrompt: null },
    features: { recommendedPlanFeatures: [] },
  };
}

describe('buildSnapshotFromVersion', () => {
  it('copies every config section from the version', () => {
    const version = makeVersion();
    const snapshot = buildSnapshotFromVersion(version);
    expect(snapshot.terminology.workUnit.singular).toBe('Class Session');
    expect(snapshot.workforceModel.supportsMultiRoleShifts).toBe(true);
  });

  it('returns a real deep copy, not a live reference', () => {
    const version = makeVersion();
    const snapshot = buildSnapshotFromVersion(version);
    version.terminology.workUnit.singular = 'Mutated After The Fact';
    version.onboarding.requiredDocumentTypeIds.push('mutated');
    expect(snapshot.terminology.workUnit.singular).toBe('Class Session');
    expect(snapshot.onboarding.requiredDocumentTypeIds).toEqual([]);
  });
});
