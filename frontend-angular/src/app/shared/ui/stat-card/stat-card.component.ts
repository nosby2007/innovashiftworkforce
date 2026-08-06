import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

export type StatCardVariant = 'primary' | 'accent' | 'success' | 'warning' | 'danger';

/** Wraps the global .vs-stat-card CSS (styles.scss) so callers stop copy-pasting the same markup. */
@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="vs-stat-card" [ngClass]="'vs-stat--' + variant">
      <div class="vs-stat-label">{{ label }}</div>
      <div class="vs-stat-value">{{ value }}</div>
      <div class="vs-stat-sub" *ngIf="sub">{{ sub }}</div>
      <mat-icon class="vs-stat-icon" *ngIf="icon">{{ icon }}</mat-icon>
    </div>
  `,
})
export class StatCardComponent {
  @Input() label = '';
  @Input() value: string | number = '';
  @Input() sub?: string;
  @Input() icon?: string;
  @Input() variant: StatCardVariant = 'primary';
}
