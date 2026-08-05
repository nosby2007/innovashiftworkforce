import { Injectable, computed } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { OrgExperienceService } from './org-experience.service';

/**
 * Resolves industry-specific business terms (e.g. "Shift" vs. "Class
 * Session"). This is a separate layer from Transloco's language
 * translation — terminology answers "what word does this org use for this
 * concept," language answers "in what language." Existing i18n keys stay
 * the sentence templates; components interpolate the resolved term into
 * them (`'marketplace.title' | transloco: { term: terminology.workUnitPlural() }`).
 *
 * For the generic/legacy default (100% of orgs today — no org has ever
 * activated a profile in Phase 1), terms are resolved through the new
 * `terminology.*` transloco keys rather than the literal English strings in
 * GENERIC_WORKFORCE_SNAPSHOT, so French-language orgs get correctly
 * localized (and correctly cased/gendered) text instead of English words
 * spliced into a French sentence. Those literal snapshot strings remain the
 * documented default data (and are what an explicitly-activated
 * `generic_workforce` profile would carry), but they are English-only —
 * activated non-generic profiles showing English-only terms regardless of
 * UI language is an accepted Phase 1 limitation (there are zero such live
 * orgs; per-locale profile terminology is a later-phase improvement).
 */
@Injectable({ providedIn: 'root' })
export class TerminologyService {
  constructor(private experience: OrgExperienceService, private i18n: TranslocoService) {}

  private isCustomized = computed(() => this.experience.config().configurationStatus === 'configured');
  private snapshotTerminology = computed(() => this.experience.config().snapshot.terminology);

  private resolve(translocoKey: string, snapshotValue: (t: ReturnType<TerminologyService['snapshotTerminology']>) => string): string {
    return this.isCustomized() ? snapshotValue(this.snapshotTerminology()) : this.i18n.translate(translocoKey);
  }

  workUnitSingular = () => this.resolve('terminology.workUnitSingular', (t) => t.workUnit.singular);
  workUnitPlural = () => this.resolve('terminology.workUnitPlural', (t) => t.workUnit.plural);
  workforceMemberSingular = () => this.resolve('terminology.workforceMemberSingular', (t) => t.workforceMember.singular);
  workforceMemberPlural = () => this.resolve('terminology.workforceMemberPlural', (t) => t.workforceMember.plural);
  departmentSingular = () => this.resolve('terminology.departmentSingular', (t) => t.department.singular);
  departmentPlural = () => this.resolve('terminology.departmentPlural', (t) => t.department.plural);
  locationSingular = () => this.resolve('terminology.locationSingular', (t) => t.location.singular);
  locationPlural = () => this.resolve('terminology.locationPlural', (t) => t.location.plural);
  marketplaceLabel = () => this.resolve('terminology.marketplaceLabel', (t) => t.marketplaceLabel);
  scheduleLabel = () => this.resolve('terminology.scheduleLabel', (t) => t.scheduleLabel);
}
