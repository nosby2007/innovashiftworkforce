import type { JobRoleOption, OrganizationExperienceConfig } from '../models/experience-config.model';

export type { JobRoleOption };

const HEALTHCARE_ROLES: JobRoleOption[] = [
  { value: 'RN', label: 'RN' },
  { value: 'CNA', label: 'CNA' },
  { value: 'LPN', label: 'LPN' },
  { value: 'Caregiver', label: 'Caregiver' },
  { value: 'NP', label: 'NP' },
  { value: 'MD', label: 'MD' },
  { value: 'Manager', label: 'Manager' },
  { value: 'Admin', label: 'Admin' },
  { value: 'HR', label: 'HR' },
  { value: 'Other', label: 'Other' },
];

const GENERIC_ROLES: JobRoleOption[] = [
  { value: 'Associate', label: 'Associate' },
  { value: 'Clerk', label: 'Clerk' },
  { value: 'Assistant', label: 'Assistant' },
  { value: 'Technician', label: 'Technician' },
  { value: 'Operator', label: 'Operator' },
  { value: 'Driver', label: 'Driver' },
  { value: 'Supervisor', label: 'Supervisor' },
  { value: 'Manager', label: 'Manager' },
  { value: 'Admin', label: 'Admin' },
  { value: 'HR', label: 'HR' },
  { value: 'Other', label: 'Other' },
];

export function isHealthcareIndustry(industry: unknown): boolean {
  const value = String(industry ?? '').trim().toLowerCase();
  return value === 'healthcare' || value === 'hospital' || value === 'clinic' || value === 'medical';
}

export function getJobRoleOptions(industry: unknown): JobRoleOption[] {
  return isHealthcareIndustry(industry) ? HEALTHCARE_ROLES : GENERIC_ROLES;
}

/**
 * Prefers an activated industry profile's recommended job roles; falls back
 * to today's industry-string-based getJobRoleOptions() for legacy orgs (the
 * vast majority) or a profile that doesn't set the list.
 */
export function resolveJobRoleOptions(
  orgIndustry: unknown,
  experience: Pick<OrganizationExperienceConfig, 'configurationStatus' | 'snapshot'> | null | undefined
): JobRoleOption[] {
  const recommended =
    experience?.configurationStatus === 'configured'
      ? experience.snapshot.workforceModel.recommendedJobRoles
      : undefined;
  return recommended && recommended.length > 0 ? recommended : getJobRoleOptions(orgIndustry);
}

/**
 * Merges an org's custom job-role names into a resolved options list,
 * inserted before the trailing "Other" entry. Additive only — never
 * removes or replaces anything from `base`. Dedupes case-insensitively
 * against `base` and against itself, drops blanks and a literal "other"
 * (that's already the built-in free-text fallback).
 */
export function mergeCustomJobRoles(
  base: JobRoleOption[],
  customRoles: string[] | null | undefined
): JobRoleOption[] {
  const existing = new Set(base.map((o) => o.value.toLowerCase()));
  const seen = new Set<string>();
  const additions: JobRoleOption[] = [];
  for (const raw of customRoles || []) {
    const value = String(raw || '').trim();
    const key = value.toLowerCase();
    if (!value || key === 'other' || existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    additions.push({ value, label: value });
  }
  if (!additions.length) return base;
  const otherIndex = base.findIndex((o) => o.value.toLowerCase() === 'other');
  return otherIndex === -1
    ? [...base, ...additions]
    : [...base.slice(0, otherIndex), ...additions, ...base.slice(otherIndex)];
}
