import { describe, it, expect } from 'vitest';
import { haversineMeters } from './geo.util';

describe('haversineMeters', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineMeters(33.749, -84.388, 33.749, -84.388)).toBe(0);
  });

  it('matches a known distance (~1.11km per degree of latitude at the equator)', () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('is symmetric', () => {
    const a = haversineMeters(33.749, -84.388, 33.75, -84.39);
    const b = haversineMeters(33.75, -84.39, 33.749, -84.388);
    expect(a).toBeCloseTo(b, 6);
  });

  it('matches the backend geofence check for a nearby point within a typical site radius', () => {
    // ~80m north of the site — should read within a 150m default radius.
    const d = haversineMeters(33.749, -84.388, 33.7497, -84.388);
    expect(d).toBeGreaterThan(70);
    expect(d).toBeLessThan(90);
  });
});
