import { describe, it, expect } from 'vitest';
import { computeRiskScore } from './ai-risk.util';

describe('computeRiskScore', () => {
  it('returns score 0 / level low for no alerts', () => {
    expect(computeRiskScore([])).toEqual({ score: 0, level: 'low' });
  });

  it('weights a critical alert double a warning', () => {
    expect(computeRiskScore([{ severity: 'critical' }])).toEqual({ score: 2, level: 'medium' });
    expect(computeRiskScore([{ severity: 'warning' }])).toEqual({ score: 1, level: 'medium' });
  });

  it('buckets 1-3 as medium', () => {
    expect(computeRiskScore([{ severity: 'warning' }, { severity: 'warning' }, { severity: 'warning' }]).level).toBe('medium');
  });

  it('buckets 4+ as high', () => {
    expect(computeRiskScore([{ severity: 'critical' }, { severity: 'critical' }]).level).toBe('high');
    expect(computeRiskScore([{ severity: 'warning' }, { severity: 'warning' }, { severity: 'warning' }, { severity: 'warning' }]).level).toBe('high');
  });

  it('sums mixed severities correctly', () => {
    const result = computeRiskScore([{ severity: 'critical' }, { severity: 'warning' }, { severity: 'warning' }]);
    expect(result).toEqual({ score: 4, level: 'high' });
  });
});
