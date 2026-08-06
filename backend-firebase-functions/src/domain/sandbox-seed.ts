/**
 * Pure fake-data generator for the public "try a live demo" sandbox org.
 * No Firestore/Admin SDK imports — the caller (provisionSandboxOrg.ts)
 * converts these plain millis/primitives into Timestamp-bearing docs at the
 * write site, matching this codebase's domain/-layer convention (see
 * domain/shift-eligibility.ts's ShiftSlice).
 */

export interface SandboxSeedProfile {
  orgName: string;
  industry: string;
}

export const SANDBOX_SEED_PROFILES: SandboxSeedProfile[] = [
  { orgName: 'Sunrise Senior Care', industry: 'Home Health' },
  { orgName: 'Riverside Home Health', industry: 'Home Health' },
  { orgName: 'Maple Grove Clinic', industry: 'Outpatient Clinic' },
];

/** Deterministic profile selection — no Math.random() in the pure layer. */
export function pickSandboxSeedProfile(seedIndex: number): SandboxSeedProfile {
  const profiles = SANDBOX_SEED_PROFILES;
  const i = ((seedIndex % profiles.length) + profiles.length) % profiles.length;
  return profiles[i];
}

export type SandboxJobRole = 'RN' | 'CNA' | 'LPN';

const JOB_ROLES: SandboxJobRole[] = ['RN', 'CNA', 'LPN'];
const PAY_RATE_BY_ROLE: Record<SandboxJobRole, number> = { RN: 42, CNA: 22, LPN: 30 };
const FIRST_NAMES = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley'];
const LAST_NAMES = ['Nguyen', 'Garcia', 'Smith', 'Patel', 'Johnson', 'Lee'];

/** RFC 2606-reserved TLD — guaranteed to never resolve, even if an email
 *  gate elsewhere were ever bypassed. */
const SANDBOX_EMAIL_DOMAIN = 'sandbox.innovashift.example';

export interface SandboxEmployeeSeed {
  uid: string;
  displayName: string;
  email: string;
  jobRole: string;
  accessRole: 'admin' | 'staff';
}

export interface SandboxShiftSeed {
  id: string;
  title: string;
  locationName: string;
  requiredJobRole: string;
  requiredJobRoles: string[];
  payRate: number;
  status: 'completed' | 'claimed' | 'published' | 'draft';
  assignedUserId: string | null;
  assignedUserName: string | null;
  marketplaceVisible: boolean;
  startAtMs: number;
  endAtMs: number;
}

export interface SandboxTimeEntrySeed {
  id: string;
  userId: string;
  shiftId: string;
  checkInAtMs: number;
  checkOutAtMs: number;
}

export interface SandboxTimeOffRequestSeed {
  id: string;
  userId: string;
  displayName: string;
  requestType: 'pto' | 'sick' | 'unpaid';
  startDate: string; // YYYY-MM-DD, UTC
  endDate: string;
  hours: number;
}

export interface SandboxShiftSwapRequestSeed {
  id: string;
  requesterUid: string;
  requesterName: string;
  targetUid: string;
  targetName: string;
  shiftId: string;
  shiftTitle: string;
  shiftLocationName: string;
  sourceStartAtMs: number;
  sourceEndAtMs: number;
}

export interface SandboxSeedData {
  employees: SandboxEmployeeSeed[];
  shifts: SandboxShiftSeed[];
  timeEntries: SandboxTimeEntrySeed[];
  timeOffRequest: SandboxTimeOffRequestSeed;
  shiftSwapRequest: SandboxShiftSwapRequestSeed;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function utcDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Builds a full, self-consistent set of fake employees/shifts/time entries
 *  and one pending time-off + one pending shift-swap request for a newly
 *  provisioned sandbox org. Pure and deterministic given `nowMs` — same
 *  input always produces the same shape (no Date.now()/Math.random() inside). */
export function buildSandboxSeed(input: { nowMs: number; profile: SandboxSeedProfile }): SandboxSeedData {
  const { nowMs, profile } = input;
  const locationName = `${profile.orgName} — Main Site`;

  const employees: SandboxEmployeeSeed[] = FIRST_NAMES.map((first, i) => {
    const last = LAST_NAMES[i];
    const jobRole = JOB_ROLES[i % JOB_ROLES.length];
    return {
      uid: `sandbox-emp-${i}`,
      displayName: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${SANDBOX_EMAIL_DOMAIN}`,
      jobRole,
      accessRole: 'staff',
    };
  });

  const shifts: SandboxShiftSeed[] = [];
  const timeEntries: SandboxTimeEntrySeed[] = [];

  const shiftFor = (
    id: string,
    dayOffset: number,
    startHour: number,
    durationHours: number,
    status: SandboxShiftSeed['status'],
    assignee: SandboxEmployeeSeed | null,
  ): SandboxShiftSeed => {
    const dayStartMs = Math.floor(nowMs / DAY_MS) * DAY_MS + dayOffset * DAY_MS;
    const startAtMs = dayStartMs + startHour * HOUR_MS;
    const endAtMs = startAtMs + durationHours * HOUR_MS;
    const requiredJobRole = assignee ? assignee.jobRole : JOB_ROLES[shifts.length % JOB_ROLES.length];
    return {
      id,
      title: `${requiredJobRole} Shift`,
      locationName,
      requiredJobRole,
      requiredJobRoles: [requiredJobRole],
      payRate: PAY_RATE_BY_ROLE[requiredJobRole as SandboxJobRole] ?? 25,
      status,
      assignedUserId: assignee ? assignee.uid : null,
      assignedUserName: assignee ? assignee.displayName : null,
      marketplaceVisible: status === 'published',
      startAtMs,
      endAtMs,
    };
  };

  // 4 completed shifts in the past (days -4..-1), one per employees[0..3],
  // each with a matching completed time entry so Attendance/Timesheets
  // aren't empty on first click.
  for (let i = 0; i < 4; i++) {
    const dayOffset = -(4 - i);
    const employee = employees[i];
    const shift = shiftFor(`sandbox-shift-completed-${i}`, dayOffset, 8, 8, 'completed', employee);
    shifts.push(shift);
    timeEntries.push({
      id: `sandbox-entry-${i}`,
      userId: employee.uid,
      shiftId: shift.id,
      checkInAtMs: shift.startAtMs,
      checkOutAtMs: shift.endAtMs,
    });
  }

  // 3 currently-assigned/claimed shifts: one "in progress" (spans now),
  // two upcoming in the next couple days.
  const inProgressStartHour = new Date(nowMs).getUTCHours() > 1 ? new Date(nowMs).getUTCHours() - 1 : 0;
  shifts.push(shiftFor('sandbox-shift-claimed-0', 0, inProgressStartHour, 4, 'claimed', employees[4]));
  shifts.push(shiftFor('sandbox-shift-claimed-1', 1, 8, 8, 'claimed', employees[5]));
  shifts.push(shiftFor('sandbox-shift-claimed-2', 2, 8, 8, 'claimed', employees[0]));

  // 3 open/published shifts (unassigned) — gives Marketplace + the AI
  // Copilot's coverage-gap detector something to show.
  shifts.push(shiftFor('sandbox-shift-open-0', 3, 8, 8, 'published', null));
  shifts.push(shiftFor('sandbox-shift-open-1', 4, 8, 8, 'published', null));
  shifts.push(shiftFor('sandbox-shift-open-2', 5, 20, 8, 'published', null));

  // 2 further-out draft shifts — not yet published.
  shifts.push(shiftFor('sandbox-shift-draft-0', 10, 8, 8, 'draft', null));
  shifts.push(shiftFor('sandbox-shift-draft-1', 12, 8, 8, 'draft', null));

  const timeOffEmployee = employees[3];
  const timeOffStartMs = Math.floor(nowMs / DAY_MS) * DAY_MS + 6 * DAY_MS;
  const timeOffEndMs = timeOffStartMs + DAY_MS;
  const timeOffRequest: SandboxTimeOffRequestSeed = {
    id: 'sandbox-timeoff-0',
    userId: timeOffEmployee.uid,
    displayName: timeOffEmployee.displayName,
    requestType: 'pto',
    startDate: utcDateKey(timeOffStartMs),
    endDate: utcDateKey(timeOffEndMs),
    hours: 8,
  };

  const swapSourceShift = shifts.find((s) => s.id === 'sandbox-shift-claimed-2')!;
  const shiftSwapRequest: SandboxShiftSwapRequestSeed = {
    id: 'sandbox-swap-0',
    requesterUid: employees[0].uid,
    requesterName: employees[0].displayName,
    targetUid: employees[1].uid,
    targetName: employees[1].displayName,
    shiftId: swapSourceShift.id,
    shiftTitle: swapSourceShift.title,
    shiftLocationName: swapSourceShift.locationName,
    sourceStartAtMs: swapSourceShift.startAtMs,
    sourceEndAtMs: swapSourceShift.endAtMs,
  };

  return { employees, shifts, timeEntries, timeOffRequest, shiftSwapRequest };
}
