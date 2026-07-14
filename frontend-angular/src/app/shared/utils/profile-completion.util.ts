export type ProfileCompletionStatus = 'complete' | 'needs_attention' | 'incomplete';

export interface ProfileCompletionResult {
  score: number;
  completed: number;
  total: number;
  missing: string[];
  status: ProfileCompletionStatus;
}

type Requirement = {
  label: string;
  ok: (user: any) => boolean;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function hasAny(...values: unknown[]): boolean {
  return values.some((value) => text(value).length > 0);
}

function profile(user: any) {
  return user?.profile || {};
}

function address(user: any) {
  return profile(user)?.address || user?.address || {};
}

function emergency(user: any) {
  return profile(user)?.emergencyContact || user?.emergencyContact || {};
}

const REQUIREMENTS: Requirement[] = [
  {
    label: 'Full name',
    ok: (user) => hasAny(user?.displayName),
  },
  {
    label: 'Email',
    ok: (user) => hasAny(user?.email),
  },
  {
    label: 'Phone number',
    ok: (user) => hasAny(profile(user)?.phone, user?.phone),
  },
  {
    label: 'Job title or role',
    ok: (user) => hasAny(profile(user)?.title, user?.title, user?.jobRole),
  },
  {
    label: 'Department',
    ok: (user) => hasAny(profile(user)?.department, user?.department),
  },
  {
    label: 'Primary location',
    ok: (user) => hasAny(profile(user)?.locationName, user?.locationName),
  },
  {
    label: 'Mailing address',
    ok: (user) => {
      const a = address(user);
      return hasAny(a?.line1) && hasAny(a?.city) && hasAny(a?.state) && hasAny(a?.postalCode);
    },
  },
  {
    label: 'Emergency contact',
    ok: (user) => hasAny(emergency(user)?.name) && hasAny(emergency(user)?.phone),
  },
  {
    label: 'W-4 withholding',
    ok: (user) => hasAny(user?.taxWithholding?.filingStatus) && user?.taxWithholding?.certified === true,
  },
  {
    label: 'W-2 delivery',
    ok: (user) => hasAny(user?.w2?.delivery) && hasAny(user?.w2?.email),
  },
  {
    label: 'Time zone preference',
    ok: (user) => hasAny(user?.preferences?.timezone),
  },
];

export function profileCompletion(user: any): ProfileCompletionResult {
  const missing = REQUIREMENTS.filter((requirement) => !requirement.ok(user)).map((requirement) => requirement.label);
  const total = REQUIREMENTS.length;
  const completed = total - missing.length;
  const score = Math.round((completed / total) * 100);
  const status: ProfileCompletionStatus =
    score >= 100 ? 'complete' :
    score >= 75 ? 'needs_attention' :
    'incomplete';

  return { score, completed, total, missing, status };
}
