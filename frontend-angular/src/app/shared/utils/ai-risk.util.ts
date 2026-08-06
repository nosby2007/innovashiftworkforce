export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskScore {
  score: number;
  level: RiskLevel;
}

/**
 * Weighted risk score from a set of compliance alerts — critical alerts
 * count double a plain warning. Used both for a "today's risk" indicator
 * (from the latest digest's alerts) and per-day in a risk trend line
 * (from digest history), so it stays a small, pure, reusable function
 * rather than logic embedded in either display.
 */
export function computeRiskScore(alerts: { severity: 'warning' | 'critical' }[]): RiskScore {
  const score = alerts.reduce((sum, a) => sum + (a.severity === 'critical' ? 2 : 1), 0);
  const level: RiskLevel = score === 0 ? 'low' : score <= 3 ? 'medium' : 'high';
  return { score, level };
}
