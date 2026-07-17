/**
 * Scores how good a fit a shift-switch candidate is, based on conflicts and
 * rest against their own existing shifts. Role compatibility is already
 * enforced as a pre-filter in listShiftSwapCandidates, so this only flags
 * scheduling issues — mirrors the "flag, don't hide" approach used for
 * marketplace matching (frontend shift-match.util.ts), ranking candidates
 * best-first rather than removing anyone from the list.
 */

const MIN_REST_HOURS = 8;

export type SwapMatchLabel = 'great_fit' | 'conflict' | 'tight_turnaround';

export interface SwapMatch {
  score: number;
  label: SwapMatchLabel;
  hasConflict: boolean;
}

export interface SwapShiftSlice {
  startAtMs: number;
  endAtMs: number;
}

export function scoreSwapCandidate(source: SwapShiftSlice, candidateShifts: SwapShiftSlice[]): SwapMatch {
  let hasConflict = false;
  let minRestHours = Infinity;

  for (const other of candidateShifts) {
    if (source.startAtMs < other.endAtMs && source.endAtMs > other.startAtMs) {
      hasConflict = true;
      continue;
    }
    const gapHours = other.startAtMs >= source.endAtMs
      ? (other.startAtMs - source.endAtMs) / 3_600_000
      : (source.startAtMs - other.endAtMs) / 3_600_000;
    minRestHours = Math.min(minRestHours, gapHours);
  }

  if (hasConflict) return { score: -1000, label: 'conflict', hasConflict: true };
  if (minRestHours < MIN_REST_HOURS) return { score: -15, label: 'tight_turnaround', hasConflict: false };
  return { score: 10, label: 'great_fit', hasConflict: false };
}
