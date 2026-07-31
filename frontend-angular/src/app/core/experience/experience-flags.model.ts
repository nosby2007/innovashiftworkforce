export type ExperienceFlagKey =
  | 'nextRosterWorkflow'
  | 'nextSchedulerActions'
  | 'nextStaffAttendanceCard'
  | 'nextMobileShell';

export type ExperienceFlags = Record<ExperienceFlagKey, boolean>;

export const DEFAULT_EXPERIENCE_FLAGS: ExperienceFlags = {
  nextRosterWorkflow: false,
  nextSchedulerActions: false,
  nextStaffAttendanceCard: false,
  nextMobileShell: false,
};

export const EXPERIENCE_FLAG_OPTIONS: Array<{
  key: ExperienceFlagKey;
  label: string;
  description: string;
}> = [
  {
    key: 'nextRosterWorkflow',
    label: 'Next roster workflow',
    description: 'Vacancy, qualified alerts, proposals, manager approval, auto roster update, and coverage reports.',
  },
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
  {
    key: 'nextMobileShell',
    label: 'Next mobile shell',
    description: 'Mobile-first navigation, bottom sheets, and PWA/Capacitor interaction refinements.',
  },
];

export function normalizeExperienceFlags(raw: Partial<Record<string, unknown>> | null | undefined): ExperienceFlags {
  const source = raw || {};
  return {
    nextRosterWorkflow: source['nextRosterWorkflow'] === true,
    nextSchedulerActions: source['nextSchedulerActions'] === true,
    nextStaffAttendanceCard: source['nextStaffAttendanceCard'] === true,
    nextMobileShell: source['nextMobileShell'] === true,
  };
}
