import { describe, it, expect } from 'vitest';
import { buildSparklinePath } from './sparkline.util';

describe('buildSparklinePath', () => {
  it('returns empty paths for an empty array', () => {
    expect(buildSparklinePath([], 100, 40)).toEqual({ linePath: '', areaPath: '' });
  });

  it('renders a single point as a flat line at the horizontal center', () => {
    const { linePath } = buildSparklinePath([5], 100, 40);
    expect(linePath).toBe('M 50.00 20.00');
  });

  it('renders flat (all-equal) data as a flat line at mid-height, not NaN', () => {
    const { linePath } = buildSparklinePath([3, 3, 3], 100, 40);
    expect(linePath).not.toContain('NaN');
    expect(linePath).toBe('M 0.00 20.00 L 50.00 20.00 L 100.00 20.00');
  });

  it('places the max value near the top (small y) and min near the bottom (large y)', () => {
    const { linePath } = buildSparklinePath([0, 10], 100, 40, 4);
    const points = linePath.split(' L ').map((seg) => seg.replace('M ', '').split(' ').map(Number));
    expect(points[0][1]).toBeGreaterThan(points[1][1]); // first point (value 0) is lower (larger y) than second (value 10)
  });

  it('closes the area path down to the baseline and back to the start x', () => {
    const { areaPath } = buildSparklinePath([1, 2, 3], 100, 40);
    expect(areaPath.endsWith('Z')).toBe(true);
    expect(areaPath).toContain('L 100.00 40 L 0.00 40 Z');
  });
});
