import { describe, it, expect, vi } from 'vitest';
import { TerminologyService } from './terminology.service';
import { legacyFallbackConfig } from '../../shared/models/experience-config.defaults';
import { OrganizationExperienceConfig } from '../../shared/models/experience-config.model';

function stubExperience(config: OrganizationExperienceConfig) {
  return { config: () => config } as any;
}

function stubTransloco(translations: Record<string, string>) {
  return { translate: vi.fn((key: string) => translations[key] ?? key) } as any;
}

describe('TerminologyService', () => {
  it('resolves the legacy/generic case through transloco keys, not literal English strings', () => {
    const i18n = stubTransloco({
      'terminology.workUnitPlural': 'Quarts',
      'terminology.workforceMemberSingular': 'employé',
      'terminology.marketplaceLabel': 'Bourse aux quarts du personnel',
    });
    const svc = new TerminologyService(stubExperience(legacyFallbackConfig('org-1')), i18n);
    expect(svc.workUnitPlural()).toBe('Quarts');
    expect(svc.workforceMemberSingular()).toBe('employé');
    expect(svc.marketplaceLabel()).toBe('Bourse aux quarts du personnel');
    expect(i18n.translate).toHaveBeenCalledWith('terminology.workUnitPlural');
  });

  it('resolves an activated (configured) profile from the literal snapshot, not transloco', () => {
    const educationConfig: OrganizationExperienceConfig = {
      ...legacyFallbackConfig('org-2'),
      configurationStatus: 'configured',
      industryProfileId: 'education',
      snapshot: {
        ...legacyFallbackConfig('org-2').snapshot,
        terminology: {
          workUnit: { singular: 'Class Session', plural: 'Class Sessions' },
          workforceMember: { singular: 'Instructor', plural: 'Instructors' },
          department: { singular: 'Program', plural: 'Programs' },
          location: { singular: 'Campus', plural: 'Campuses' },
          marketplaceLabel: 'Open Class Board',
          scheduleLabel: 'Class Schedule',
        },
      },
    };
    const i18n = stubTransloco({});
    const svc = new TerminologyService(stubExperience(educationConfig), i18n);
    expect(svc.workUnitSingular()).toBe('Class Session');
    expect(svc.workforceMemberPlural()).toBe('Instructors');
    expect(svc.marketplaceLabel()).toBe('Open Class Board');
    expect(i18n.translate).not.toHaveBeenCalled();
  });
});
