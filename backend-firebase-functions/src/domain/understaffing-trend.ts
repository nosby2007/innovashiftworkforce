/**
 * Pure trend-direction math for the long-term understaffing forecast in
 * dailyDigest.ts. Split out so it's testable without a Firestore mock —
 * the caller is responsible for fetching aiDigests history and bucketing
 * gap counts into a recent-4-weeks vs prior-4-weeks array before calling
 * this. Direction is only called worsening/improving when both halves have
 * data; a brand-new org with only recent history isn't "worsening", it just
 * doesn't have enough history yet.
 */

const FORECAST_MIN_PROBLEM_DAYS = 3; // don't forecast off fewer than 3 historical problem-days

export interface UnderstaffingTrend {
  direction: 'worsening' | 'improving' | 'stable';
  recentProblemDays: number;
  priorProblemDays: number;
  recentAvgGaps: number;
  priorAvgGaps: number;
}

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0;
}

export function deriveUnderstaffingTrend(recentGapCounts: number[], priorGapCounts: number[]): UnderstaffingTrend | null {
  if (recentGapCounts.length + priorGapCounts.length < FORECAST_MIN_PROBLEM_DAYS) return null;

  const recentAvgGaps = avg(recentGapCounts);
  const priorAvgGaps = avg(priorGapCounts);

  let direction: UnderstaffingTrend['direction'] = 'stable';
  if (recentGapCounts.length > 0 && priorGapCounts.length > 0) {
    if (recentGapCounts.length > priorGapCounts.length * 1.3 || recentAvgGaps > priorAvgGaps * 1.25) direction = 'worsening';
    else if (recentGapCounts.length < priorGapCounts.length * 0.7 && recentAvgGaps < priorAvgGaps * 0.85) direction = 'improving';
  }

  return {
    direction,
    recentProblemDays: recentGapCounts.length,
    priorProblemDays: priorGapCounts.length,
    recentAvgGaps,
    priorAvgGaps,
  };
}
