import { describe, it, expect } from 'vitest';
import { buildSandboxSeed, pickSandboxSeedProfile, SANDBOX_SEED_PROFILES } from './sandbox-seed';

const NOW = Date.UTC(2026, 3, 15, 14, 0, 0);

describe('pickSandboxSeedProfile', () => {
  it('is deterministic and cycles through the seed profile list', () => {
    expect(pickSandboxSeedProfile(0)).toEqual(SANDBOX_SEED_PROFILES[0]);
    expect(pickSandboxSeedProfile(1)).toEqual(SANDBOX_SEED_PROFILES[1]);
    expect(pickSandboxSeedProfile(SANDBOX_SEED_PROFILES.length)).toEqual(SANDBOX_SEED_PROFILES[0]);
  });

  it('handles negative indices without throwing', () => {
    expect(() => pickSandboxSeedProfile(-1)).not.toThrow();
  });
});

describe('buildSandboxSeed', () => {
  const profile = SANDBOX_SEED_PROFILES[0];

  it('is deterministic — same input produces the same output', () => {
    const a = buildSandboxSeed({ nowMs: NOW, profile });
    const b = buildSandboxSeed({ nowMs: NOW, profile });
    expect(a).toEqual(b);
  });

  it('seeds exactly 6 employees split evenly across 3 job roles', () => {
    const { employees } = buildSandboxSeed({ nowMs: NOW, profile });
    expect(employees).toHaveLength(6);
    const counts = employees.reduce((acc: Record<string, number>, e) => {
      acc[e.jobRole] = (acc[e.jobRole] || 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ RN: 2, CNA: 2, LPN: 2 });
  });

  it('every employee email ends in the reserved .example sandbox domain', () => {
    const { employees } = buildSandboxSeed({ nowMs: NOW, profile });
    for (const e of employees) {
      expect(e.email.endsWith('@sandbox.innovashift.example')).toBe(true);
    }
  });

  it('seeds shifts across completed/claimed/published/draft statuses', () => {
    const { shifts } = buildSandboxSeed({ nowMs: NOW, profile });
    const byStatus = shifts.reduce((acc: Record<string, number>, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    }, {});
    expect(byStatus).toEqual({ completed: 4, claimed: 3, published: 3, draft: 2 });
    expect(shifts).toHaveLength(12);
  });

  it('every completed shift has a matching time entry with the same user/shift and bounds', () => {
    const { shifts, timeEntries } = buildSandboxSeed({ nowMs: NOW, profile });
    const completed = shifts.filter((s) => s.status === 'completed');
    expect(timeEntries).toHaveLength(completed.length);
    for (const shift of completed) {
      const entry = timeEntries.find((e) => e.shiftId === shift.id);
      expect(entry).toBeTruthy();
      expect(entry!.userId).toBe(shift.assignedUserId);
      expect(entry!.checkInAtMs).toBe(shift.startAtMs);
      expect(entry!.checkOutAtMs).toBe(shift.endAtMs);
    }
  });

  it('published (open) shifts have no assignee and are marketplace-visible; draft shifts are not', () => {
    const { shifts } = buildSandboxSeed({ nowMs: NOW, profile });
    for (const s of shifts.filter((x) => x.status === 'published')) {
      expect(s.assignedUserId).toBeNull();
      expect(s.marketplaceVisible).toBe(true);
    }
    for (const s of shifts.filter((x) => x.status === 'draft')) {
      expect(s.assignedUserId).toBeNull();
      expect(s.marketplaceVisible).toBe(false);
    }
  });

  it('claimed/completed shifts always have a valid, non-overlapping-with-itself assignee', () => {
    const { shifts, employees } = buildSandboxSeed({ nowMs: NOW, profile });
    const uids = new Set(employees.map((e) => e.uid));
    for (const s of shifts.filter((x) => x.status === 'claimed' || x.status === 'completed')) {
      expect(s.assignedUserId).toBeTruthy();
      expect(uids.has(s.assignedUserId!)).toBe(true);
      expect(s.endAtMs).toBeGreaterThan(s.startAtMs);
    }
  });

  it('seeds exactly one pending time-off request for a real seeded employee', () => {
    const { timeOffRequest, employees } = buildSandboxSeed({ nowMs: NOW, profile });
    expect(employees.some((e) => e.uid === timeOffRequest.userId)).toBe(true);
    expect(timeOffRequest.startDate <= timeOffRequest.endDate).toBe(true);
    expect(timeOffRequest.hours).toBeGreaterThan(0);
  });

  it('seeds exactly one pending shift-swap request between two different real employees, tied to a real shift', () => {
    const { shiftSwapRequest, employees, shifts } = buildSandboxSeed({ nowMs: NOW, profile });
    expect(shiftSwapRequest.requesterUid).not.toBe(shiftSwapRequest.targetUid);
    expect(employees.some((e) => e.uid === shiftSwapRequest.requesterUid)).toBe(true);
    expect(employees.some((e) => e.uid === shiftSwapRequest.targetUid)).toBe(true);
    expect(shifts.some((s) => s.id === shiftSwapRequest.shiftId)).toBe(true);
  });

  it('produces a different-looking org name per profile without changing the seed shape', () => {
    const a = buildSandboxSeed({ nowMs: NOW, profile: SANDBOX_SEED_PROFILES[0] });
    const b = buildSandboxSeed({ nowMs: NOW, profile: SANDBOX_SEED_PROFILES[1] });
    expect(a.shifts[0].locationName).not.toBe(b.shifts[0].locationName);
    expect(a.employees).toHaveLength(b.employees.length);
  });
});
