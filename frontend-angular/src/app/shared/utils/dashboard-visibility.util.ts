import { OrganizationExperienceConfig } from '../models/experience-config.model';

/**
 * True when the activated profile's NavigationConfig.hiddenNavKeys lists
 * this key. Legacy/unconfigured orgs (the vast majority today) never hide
 * anything — no seed profile ships a non-empty hiddenNavKeys list yet, so
 * this is real, tested infrastructure ahead of content (matches this
 * codebase's pattern for other Phase 1 inert config sections).
 */
export function isNavKeyHidden(
  key: string,
  experience: Pick<OrganizationExperienceConfig, 'configurationStatus' | 'snapshot'> | null | undefined
): boolean {
  if (experience?.configurationStatus !== 'configured') return false;
  return experience.snapshot.navigation.hiddenNavKeys.includes(key);
}

/**
 * True when the activated profile's DashboardsConfig.hiddenWidgetKeys lists
 * this key. Same legacy-safe contract as isNavKeyHidden — no seed profile
 * ships a non-empty hiddenWidgetKeys list yet, so this is real, tested
 * infrastructure ahead of content.
 */
export function isWidgetHidden(
  key: string,
  experience: Pick<OrganizationExperienceConfig, 'configurationStatus' | 'snapshot'> | null | undefined
): boolean {
  if (experience?.configurationStatus !== 'configured') return false;
  return (experience.snapshot.dashboards.hiddenWidgetKeys || []).includes(key);
}
