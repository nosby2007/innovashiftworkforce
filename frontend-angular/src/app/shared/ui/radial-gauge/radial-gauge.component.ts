import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type RadialGaugeVariant = 'primary' | 'success' | 'warning' | 'danger';

/**
 * Themed circular gauge — generalizes the conic-gradient ring technique
 * already used in staff-documents.page.ts's .doc-ring, but driven by the
 * real --success/--warning/--danger/--primary design tokens (so it stays
 * theme-reactive) instead of hardcoded hex.
 */
@Component({
  selector: 'app-radial-gauge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rg" [class]="'rg--' + variant" [style.--pct.%]="pct()" [style.--size.px]="size">
      <span class="rg-value">{{ displayValue ?? (pct() + '%') }}</span>
    </div>
    <div class="rg-label" *ngIf="label">{{ label }}</div>
  `,
  styles: [`
    :host { display: inline-flex; flex-direction: column; align-items: center; gap: 6px; }
    .rg {
      --size: 96px; --pct: 0%;
      width: var(--size); height: var(--size); border-radius: 50%;
      display: grid; place-items: center; position: relative;
      background: conic-gradient(var(--rg-color) var(--pct), var(--border) 0);
      transition: background var(--t-slow, 350ms ease);
    }
    .rg::before {
      content: ''; position: absolute; inset: 10%; border-radius: 50%;
      background: var(--panel-2, var(--panel));
    }
    .rg-value { position: relative; z-index: 1; font-weight: 900; font-size: 18px; color: var(--text); }
    .rg-label { font-size: 12px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .rg--primary { --rg-color: var(--primary); }
    .rg--success { --rg-color: var(--success); }
    .rg--warning { --rg-color: var(--warning); }
    .rg--danger  { --rg-color: var(--danger); }
  `],
})
export class RadialGaugeComponent {
  @Input() value = 0;
  @Input() max = 100;
  @Input() variant: RadialGaugeVariant = 'primary';
  @Input() label?: string;
  @Input() size = 96;
  @Input() displayValue?: string;

  pct() {
    if (this.max <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((this.value / this.max) * 100)));
  }
}
