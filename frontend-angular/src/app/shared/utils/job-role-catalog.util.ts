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
