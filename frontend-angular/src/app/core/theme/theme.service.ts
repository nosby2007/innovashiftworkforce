import { Injectable, signal, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ThemeId, ThemeOption } from './theme.model';

const STORAGE_KEY = 'vs_theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private doc = inject(DOCUMENT);

  private readonly themes: ThemeOption[] = [
    { id: 'ocean', label: 'Recommended', bodyClass: 'theme-ocean', recommended: true, description: 'Clear navy and light surfaces for daily operations.' },
    { id: 'light', label: 'Light', bodyClass: 'theme-light', description: 'Bright workspace with maximum table readability.' },
    { id: 'dark', label: 'Navy Night', bodyClass: 'theme-dark', description: 'Accessible dark mode with slate panels.' },
    { id: 'emerald', label: 'Healthcare Green', bodyClass: 'theme-emerald', description: 'Calm green accent for clinical teams.' },
    { id: 'contrast', label: 'High Contrast', bodyClass: 'theme-contrast', description: 'Maximum contrast for accessibility.' },
  ];

  readonly current = signal<ThemeId>('ocean');

  getThemeOptions(): ThemeOption[] {
    return this.themes;
  }

  init(): void {
    const saved = (localStorage.getItem(STORAGE_KEY) as ThemeId | null) ?? 'ocean';
    this.apply(saved);
  }

  apply(themeId: ThemeId): void {
    const body = this.doc.body;

    for (const t of this.themes) body.classList.remove(t.bodyClass);

    const match = this.themes.find(t => t.id === themeId) ?? this.themes[0];
    body.classList.add(match.bodyClass);

    localStorage.setItem(STORAGE_KEY, match.id);
    this.current.set(match.id);
  }
}
