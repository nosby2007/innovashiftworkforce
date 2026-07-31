import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@jsverse/transloco';
import { PayPeriodService, PayPeriodOption } from '../../../core/tenancy/pay-period.service';

/**
 * A bounded dropdown of the org's known pay periods (current + every
 * already-finalized past one) rather than free-form prev/next-by-length
 * navigation — every page using this hard-restricts to exactly the
 * selected period with no fallback, so stepping to a boundary that isn't a
 * real period would silently render an empty page. Constraining navigation
 * to PayPeriodService.periods() indices makes that impossible.
 */
@Component({
  standalone: true,
  selector: 'app-pay-period-selector',
  imports: [CommonModule, FormsModule, MatIconModule, TranslocoModule],
  template: `
    <div class="pps-bar">
      <button type="button" class="pps-nav" (click)="step(1)" [disabled]="atOldest()" [attr.aria-label]="'payPeriod.older' | transloco">
        <mat-icon>chevron_left</mat-icon>
      </button>
      <select class="pps-select" [ngModel]="svc.selectedIndex()" (ngModelChange)="pick(+$event)">
        <option *ngFor="let opt of svc.periods(); let i = index" [value]="i">
          {{ opt.label }}{{ opt.isCurrent ? (' · ' + ('payPeriod.current' | transloco)) : '' }}
        </option>
      </select>
      <button type="button" class="pps-nav" (click)="step(-1)" [disabled]="svc.selectedIndex() === 0" [attr.aria-label]="'payPeriod.newer' | transloco">
        <mat-icon>chevron_right</mat-icon>
      </button>
      <button type="button" class="pps-current-btn" *ngIf="svc.selectedIndex() !== 0" (click)="pick(0)">
        {{ 'payPeriod.backToCurrent' | transloco }}
      </button>
    </div>
  `,
  styles: [`
    .pps-bar { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
    .pps-nav { width:30px; height:30px; border:1px solid var(--border, #cbd5e1); border-radius:6px; background:var(--panel, #fff); color:var(--text, #0f172a); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
    .pps-nav:disabled { opacity:.4; cursor:not-allowed; }
    .pps-nav mat-icon { font-size:18px; width:18px; height:18px; }
    .pps-select { height:30px; border:1px solid var(--border, #cbd5e1); border-radius:6px; padding:0 8px; background:var(--panel, #fff); color:var(--text, #0f172a); font-size:12px; font-weight:800; min-width:170px; }
    .pps-current-btn { height:30px; border:1px solid var(--border, #cbd5e1); border-radius:6px; background:transparent; color:var(--text-muted, #64748b); padding:0 10px; font-size:11px; font-weight:800; cursor:pointer; white-space:nowrap; }
    .pps-current-btn:hover { color:var(--text, #0f172a); }
  `],
})
export class PayPeriodSelectorComponent {
  /** Fires whenever this selector picks a period — reactive (signal-driven)
   *  pages can ignore it and just read svc.selectedPeriod(); imperative
   *  pages built around plain fromDate/toDate fields use it to copy the
   *  picked period's bounds into their own state once. */
  @Output() periodChange = new EventEmitter<PayPeriodOption>();

  constructor(public svc: PayPeriodService) {}

  atOldest() {
    return this.svc.selectedIndex() >= this.svc.periods().length - 1;
  }

  pick(i: number) {
    this.svc.selectIndex(i);
    this.emitCurrent();
  }

  step(delta: number) {
    this.svc.selectIndex(this.svc.selectedIndex() + delta);
    this.emitCurrent();
  }

  private emitCurrent() {
    const opt = this.svc.periods()[this.svc.selectedIndex()];
    if (opt) this.periodChange.emit(opt);
  }
}
