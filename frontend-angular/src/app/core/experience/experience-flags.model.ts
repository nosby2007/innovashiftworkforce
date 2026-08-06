// nextRosterWorkflow and nextMobileShell were removed — scaffolded in the
// original "futuristic roster" rollout (PR #56) but never got a consumer
// anywhere in the app, so toggling them never did anything visible.
export type ExperienceFlagKey =
  | 'nextSchedulerActions'
  | 'nextStaffAttendanceCard';

export type ExperienceFlags = Record<ExperienceFlagKey, boolean>;

export const DEFAULT_EXPERIENCE_FLAGS: ExperienceFlags = {
  nextSchedulerActions: false,
  nextStaffAttendanceCard: false,
};

export const EXPERIENCE_FLAG_OPTIONS: Array<{
  key: ExperienceFlagKey;
  label: string;
  description: string;
}> = [
  {
    key: 'nextSchedulerActions',
    label: 'Next scheduler actions',
    description: 'Enhanced shift-click command drawer for edit, assign, publish to marketplace, chat, and risk actions.',
  },
  {
    key: 'nextStaffAttendanceCard',
    label: 'Next staff attendance card',
    description: 'Daily shift card-first clock-in experience while keeping the current timecard inquiry available.',
  },
];

export function normalizeExperienceFlags(raw: Partial<Record<string, unknown>> | null | undefined): ExperienceFlags {
  const source = raw || {};
  return {
    nextSchedulerActions: source['nextSchedulerActions'] === true,
    nextStaffAttendanceCard: source['nextStaffAttendanceCard'] === true,
  };
}
