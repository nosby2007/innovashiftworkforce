export type JobRoleCatalogItem = {
  value: string;
  label: string;
};

const HEALTHCARE_ROLES: JobRoleCatalogItem[] = [
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

const GENERIC_ROLES: JobRoleCatalogItem[] = [
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

function normalizeIndustry(industry: unknown): string {
  return String(industry ?? '').trim().toLowerCase();
}

export function isHealthcareIndustry(industry: unknown): boolean {
  const value = normalizeIndustry(industry);
  return value === 'healthcare' || value === 'hospital' || value === 'clinic' || value === 'medical';
}

export function getJobRoleCatalog(industry: unknown): JobRoleCatalogItem[] {
  return isHealthcareIndustry(industry) ? HEALTHCARE_ROLES : GENERIC_ROLES;
}

export function getAllowedJobRoles(industry: unknown): string[] {
  return getJobRoleCatalog(industry).map((item) => item.value);
}

export function normalizeJobRole(value: unknown): string {
  return String(value ?? '').trim();
}

export function isValidJobRoleForIndustry(industry: unknown, jobRole: unknown): boolean {
  const value = normalizeJobRole(jobRole);
  if (!value) return false;
  return getAllowedJobRoles(industry).includes(value) || getAllowedJobRoles(industry).includes(value.toUpperCase());
}

export function resolveRequiredRoles(payload: unknown): string[] {
  const items = Array.isArray(payload)
    ? payload
    : typeof payload === 'string'
      ? payload.split(',')
      : [];

  return Array.from(
    new Set(
      items
        .map((item) => normalizeJobRole(item))
        .filter(Boolean)
    )
  );
}

export function shiftRoleMatches(userJobRole: unknown, requiredRoles: unknown): boolean {
  const userRole = normalizeJobRole(userJobRole).toLowerCase();
  if (!userRole) return false;

  const required = resolveRequiredRoles(requiredRoles);
  if (required.length === 0) return true;

  return required.some((role) => role.toLowerCase() === userRole);
}
