import { maskLast4 } from './direct-deposit.repo';

describe('maskLast4', () => {
  it('shows only the last 4 digits, masking the rest', () => {
    expect(maskLast4('123456789')).toBe('•••• 6789');
  });

  it('strips non-digit characters before masking', () => {
    expect(maskLast4('1234-5678-9012')).toBe('•••• 9012');
  });

  it('handles a short number without a full 4-digit tail', () => {
    expect(maskLast4('12')).toBe('••• 12');
  });

  it('returns empty string for empty/missing input', () => {
    expect(maskLast4('')).toBe('');
    expect(maskLast4(undefined as any)).toBe('');
  });
});
