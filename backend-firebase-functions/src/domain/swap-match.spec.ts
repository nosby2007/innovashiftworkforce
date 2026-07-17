import { describe, it, expect } from 'vitest';
import { scoreSwapCandidate } from './swap-match';

function slice(startAtMs: number, endAtMs: number) {
  return { startAtMs, endAtMs };
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

describe('scoreSwapCandidate', () => {
  it('is a great fit with no other shifts', () => {
    const source = slice(0, 8 * HOUR);
    const m = scoreSwapCandidate(source, []);
    expect(m.label).toBe('great_fit');
    expect(m.hasConflict).toBe(false);
  });

  it('is a great fit when other shifts have ample rest', () => {
    const source = slice(DAY, DAY + 8 * HOUR);
    const other = slice(0, 8 * HOUR);
    const m = scoreSwapCandidate(source, [other]);
    expect(m.label).toBe('great_fit');
  });

  it('flags a hard conflict on overlap', () => {
    const source = slice(0, 8 * HOUR);
    const other = slice(4 * HOUR, 12 * HOUR);
    const m = scoreSwapCandidate(source, [other]);
    expect(m.label).toBe('conflict');
    expect(m.hasConflict).toBe(true);
    expect(m.score).toBeLessThan(-500);
  });

  it('flags a tight turnaround when rest is under 8h but no overlap', () => {
    const source = slice(8 * HOUR, 16 * HOUR);
    const other = slice(0, 6 * HOUR); // ends 2h before source starts
    const m = scoreSwapCandidate(source, [other]);
    expect(m.label).toBe('tight_turnaround');
    expect(m.hasConflict).toBe(false);
  });

  it('uses the worst rest gap across multiple shifts', () => {
    const source = slice(8 * HOUR, 16 * HOUR);
    const farShift = slice(-3 * DAY, -3 * DAY + 8 * HOUR);
    const tightShift = slice(0, 6 * HOUR);
    const m = scoreSwapCandidate(source, [farShift, tightShift]);
    expect(m.label).toBe('tight_turnaround');
  });
});
