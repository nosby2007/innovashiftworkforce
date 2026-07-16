import { describe, it, expect } from 'vitest';
import { entryHours, grossPay, estimatedDeductions, estimatedNet } from './payroll-math';

describe('entryHours', () => {
  it('returns 0 for an entry still clocked in (no checkout)', () => {
    expect(entryHours(0, null, 0)).toBe(0);
  });

  it('computes hours between check-in and check-out', () => {
    const checkIn = Date.UTC(2026, 0, 1, 8, 0);
    const checkOut = Date.UTC(2026, 0, 1, 16, 0);
    expect(entryHours(checkIn, checkOut, 0)).toBe(8);
  });

  it('subtracts break time', () => {
    const checkIn = Date.UTC(2026, 0, 1, 8, 0);
    const checkOut = Date.UTC(2026, 0, 1, 16, 0);
    expect(entryHours(checkIn, checkOut, 30 * 60 * 1000)).toBe(7.5);
  });

  it('never goes negative', () => {
    const checkIn = Date.UTC(2026, 0, 1, 8, 0);
    const checkOut = Date.UTC(2026, 0, 1, 9, 0);
    expect(entryHours(checkIn, checkOut, 5 * 3_600_000)).toBe(0);
  });
});

describe('grossPay / estimatedDeductions / estimatedNet', () => {
  it('multiplies hours by rate', () => {
    expect(grossPay(8, 25)).toBe(200);
  });

  it('applies a flat 12% deduction estimate', () => {
    expect(estimatedDeductions(200)).toBe(24);
  });

  it('nets gross minus the deduction estimate', () => {
    expect(estimatedNet(200)).toBe(176);
  });
});
