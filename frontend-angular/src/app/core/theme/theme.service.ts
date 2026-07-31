import { Injectable, PLATFORM_ID, signal, inject } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ThemeId, ThemeOption } from './theme.model';

const STORAGE_KEY = 'vs_theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private doc = inject(DOCUMENT);
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

  private readonly themes: ThemeOption[] = [
    { id: 'ocean', label: 'theme.ocean', bodyClass: 'theme-ocean', recommended: true, description: 'theme.oceanDesc' },
    { id: 'light', label: 'theme.light', bodyClass: 'theme-light', description: 'theme.lightDesc' },
    { id: 'dark', label: 'theme.dark', bodyClass: 'theme-dark', description: 'theme.darkDesc' },
    { id: 'emerald', label: 'theme.emerald', bodyClass: 'theme-emerald', description: 'theme.emeraldDesc' },
    { id: 'contrast', label: 'theme.contrast', bodyClass: 'theme-contrast', description: 'theme.contrastDesc' },
  ];

  readonly current = signal<ThemeId>('ocean');

  getThemeOptions(): ThemeOption[] {
    return this.themes;
  }

  init(): void {
    const saved = (this.isBrowser ? (localStorage.getItem(STORAGE_KEY) as ThemeId | null) : null) ?? 'ocean';
    this.apply(saved);
  }

  apply(themeId: ThemeId): void {
    const body = this.doc.body;

    for (const t of this.themes) body.classList.remove(t.bodyClass);

    const match = this.themes.find(t => t.id === themeId) ?? this.themes[0];
    body.classList.add(match.bodyClass);

    if (this.isBrowser) localStorage.setItem(STORAGE_KEY, match.id);
    this.current.set(match.id);
  }
}
