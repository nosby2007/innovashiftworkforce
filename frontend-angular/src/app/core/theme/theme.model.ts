export type ThemeId = 'ocean' | 'light' | 'dark' | 'emerald' | 'contrast';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  bodyClass: `theme-${ThemeId}`;
  description?: string;
  recommended?: boolean;
}
