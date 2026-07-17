import { describe, it, expect } from 'vitest';
import { deriveUnderstaffingTrend } from './understaffing-trend';

describe('deriveUnderstaffingTrend', () => {
  it('returns null with too little history', () => {
    expect(deriveUnderstaffingTrend([2], [])).toBeNull();
    expect(deriveUnderstaffingTrend([], [])).toBeNull();
  });

  it('reports worsening when recent problem-days and severity are both up', () => {
    const t = deriveUnderstaffingTrend([4, 5, 6, 5], [1, 2]);
    expect(t?.direction).toBe('worsening');
  });

  it('reports improving when recent problem-days and severity are both down', () => {
    const t = deriveUnderstaffingTrend([1], [4, 5, 6, 5, 6]);
    expect(t?.direction).toBe('improving');
  });

  it('reports stable when frequency and severity are similar', () => {
    const t = deriveUnderstaffingTrend([2, 3], [2, 3]);
    expect(t?.direction).toBe('stable');
  });

  it('does not call it worsening for a brand-new org with no prior history', () => {
    const t = deriveUnderstaffingTrend([3, 4, 5], []);
    expect(t?.direction).toBe('stable');
    expect(t?.priorProblemDays).toBe(0);
  });

  it('computes averages correctly', () => {
    const t = deriveUnderstaffingTrend([2, 4], [1, 3]);
    expect(t?.recentAvgGaps).toBe(3);
    expect(t?.priorAvgGaps).toBe(2);
  });
});
