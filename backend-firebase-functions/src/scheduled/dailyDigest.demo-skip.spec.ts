import { describe, it, expect } from 'vitest';
import { shouldSkipOrgForDigest } from './dailyDigest';

describe('shouldSkipOrgForDigest', () => {
  it('skips an org explicitly marked as a demo sandbox', () => {
    expect(shouldSkipOrgForDigest({ isDemo: true })).toBe(true);
  });

  it('does not skip a real org with isDemo explicitly false', () => {
    expect(shouldSkipOrgForDigest({ isDemo: false })).toBe(false);
  });

  it('does not skip an org with no isDemo field at all (real orgs today)', () => {
    expect(shouldSkipOrgForDigest({})).toBe(false);
    expect(shouldSkipOrgForDigest(null)).toBe(false);
    expect(shouldSkipOrgForDigest(undefined)).toBe(false);
  });

  it('does not skip on a truthy-but-not-strictly-true isDemo value', () => {
    expect(shouldSkipOrgForDigest({ isDemo: 1 })).toBe(false);
    expect(shouldSkipOrgForDigest({ isDemo: 'true' })).toBe(false);
  });
});
