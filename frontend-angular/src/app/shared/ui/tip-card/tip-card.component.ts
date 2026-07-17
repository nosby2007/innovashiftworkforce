import { Component, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { TipCardService } from './tip-card.service';

/**
 * Small dismissible explanation card for first-time page visits. Drop it at
 * the top of a page's template with a unique tipId; once dismissed it never
 * shows again for that user on that device (see TipCardService).
 */
@Component({
  selector: 'app-tip-card',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="tip-card" *ngIf="!dismissed()">
      <mat-icon class="tip-card-icon">{{ icon }}</mat-icon>
      <div class="tip-card-body">
        <div class="tip-card-title" *ngIf="title">{{ title }}</div>
        <div class="tip-card-text"><ng-content></ng-content></div>
      </div>
      <button class="tip-card-close" type="button" (click)="dismiss()" aria-label="Dismiss tip">
        <mat-icon>close</mat-icon>
      </button>
    </div>
  `,
  styles: [`
    .tip-card {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      margin-bottom: 16px;
      border-radius: var(--radius, 12px);
      background: color-mix(in srgb, var(--accent, #0891b2) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent, #0891b2) 30%, transparent);
    }
    .tip-card-icon {
      color: var(--accent, #0891b2);
      flex-shrink: 0;
      margin-top: 1px;
      font-size: 20px !important;
      width: 20px !important;
      height: 20px !important;
    }
    .tip-card-body { flex: 1; min-width: 0; }
    .tip-card-title { font-weight: 800; font-size: 13px; color: var(--text); margin-bottom: 2px; }
    .tip-card-text { font-size: 12.5px; line-height: 1.5; color: var(--text-muted); }
    .tip-card-close {
      flex-shrink: 0;
      border: 0;
      background: transparent;
      color: var(--text-subtle);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px;
      border-radius: 50%;
    }
    .tip-card-close:hover { color: var(--text); background: rgba(148,163,184,0.15); }
    .tip-card-close mat-icon { font-size: 16px !important; width: 16px !important; height: 16px !important; }
  `],
})
export class TipCardComponent implements OnInit {
  @Input({ required: true }) tipId!: string;
  @Input() title = '';
  @Input() icon = 'lightbulb';

  dismissed = signal(true); // default hidden until ngOnInit resolves seen-state, avoids a flash

  constructor(private tips: TipCardService) {}

  ngOnInit(): void {
    this.dismissed.set(this.tips.isSeen(this.tipId));
  }

  dismiss(): void {
    this.tips.markSeen(this.tipId);
    this.dismissed.set(true);
  }
}
