import { describe, it, expect } from 'vitest';
import { buildSnapshotFromVersion, canActivateIndustryProfile, IndustryProfileVersion } from './experience-config';

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

describe('canActivateIndustryProfile', () => {
  it('allows a superAdmin to activate for any org', () => {
    expect(canActivateIndustryProfile({ uid: 'u1', platformRole: 'superAdmin' }, 'org-other')).toBe(true);
  });

  it('allows an org admin to activate for their own org', () => {
    expect(canActivateIndustryProfile({ uid: 'u1', orgId: 'org-1', accessRole: 'admin' }, 'org-1')).toBe(true);
  });

  it('denies an org admin activating for a different org', () => {
    expect(canActivateIndustryProfile({ uid: 'u1', orgId: 'org-1', accessRole: 'admin' }, 'org-2')).toBe(false);
  });

  it('denies a manager, even for their own org', () => {
    expect(canActivateIndustryProfile({ uid: 'u1', orgId: 'org-1', accessRole: 'manager' }, 'org-1')).toBe(false);
  });

  it('denies a scheduler/hr, even for their own org', () => {
    expect(canActivateIndustryProfile({ uid: 'u1', orgId: 'org-1', accessRole: 'scheduler' }, 'org-1')).toBe(false);
    expect(canActivateIndustryProfile({ uid: 'u1', orgId: 'org-1', accessRole: 'hr' }, 'org-1')).toBe(false);
  });

  it('denies a caller with no role/org context', () => {
    expect(canActivateIndustryProfile({ uid: 'u1' }, 'org-1')).toBe(false);
  });
});
