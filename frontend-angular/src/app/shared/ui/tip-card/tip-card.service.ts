import { Injectable } from '@angular/core';

const STORAGE_KEY = 'innovashift.tips.seen.v1';

/**
 * Tracks which contextual tip cards a user has dismissed, so a first-visit
 * explanation card never repeats. localStorage-only by design: onboarding
 * tips aren't high-stakes if they reappear once on a new device, and this
 * avoids a Firestore write (and any cross-device sync complexity) for what
 * is purely a "have I seen this before" flag.
 */
@Injectable({ providedIn: 'root' })
export class TipCardService {
  private seen: Set<string> | null = null;

  isSeen(tipId: string): boolean {
    return this.loadSeen().has(tipId);
  }

  markSeen(tipId: string): void {
    const seen = this.loadSeen();
    if (seen.has(tipId)) return;
    seen.add(tipId);
    this.persist(seen);
  }

  private loadSeen(): Set<string> {
    if (this.seen) return this.seen;
    this.seen = new Set(this.readRaw());
    return this.seen;
  }

  private readRaw(): string[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private persist(seen: Set<string>): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(seen)));
    } catch {
      // Private-mode storage errors — ignore, the tip just shows again next time.
    }
  }
}
