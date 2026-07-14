export function mapAttendancePolicyError(error: any, fallback: string): string {
  const msg = String(error?.message || '').toLowerCase();

  if (msg.includes('multiple shifts on the same day')) {
    return 'Shift refused: you already have a shift on the same day.';
  }

  if (msg.includes('overlap') || msg.includes('overlaps an already assigned shift')) {
    return 'Shift refused: this shift overlaps with one of your assigned shifts.';
  }

  if (msg.includes('break required') || msg.includes('before checkout for shifts over')) {
    return 'Checkout blocked: a mandatory break is required before clocking out.';
  }

  return fallback;
}
