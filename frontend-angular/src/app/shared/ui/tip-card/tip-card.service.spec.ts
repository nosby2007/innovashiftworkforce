import { describe, it, expect, beforeEach } from 'vitest';
import { TipCardService } from './tip-card.service';

describe('TipCardService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reports an unseen tip as not seen', () => {
    const svc = new TipCardService();
    expect(svc.isSeen('scheduler-intro')).toBe(false);
  });

  it('remembers a dismissed tip', () => {
    const svc = new TipCardService();
    svc.markSeen('scheduler-intro');
    expect(svc.isSeen('scheduler-intro')).toBe(true);
  });

  it('persists across service instances (same localStorage)', () => {
    new TipCardService().markSeen('marketplace-intro');
    const svc2 = new TipCardService();
    expect(svc2.isSeen('marketplace-intro')).toBe(true);
  });

  it('keeps tips independent of each other', () => {
    const svc = new TipCardService();
    svc.markSeen('a');
    expect(svc.isSeen('a')).toBe(true);
    expect(svc.isSeen('b')).toBe(false);
  });
});
