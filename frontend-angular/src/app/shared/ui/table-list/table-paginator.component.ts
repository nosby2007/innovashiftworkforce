import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableListController } from './table-list.controller';

/**
 * Drop-in Prev/Next + page-size + range widget for any table driven by a
 * TableListController. Styled to match the app's existing muted-toolbar
 * look (CSS variables shared with the rest of the app) rather than
 * Angular Material, per the "keep current look" scope decision.
 */
@Component({
  standalone: true,
  selector: 'app-table-paginator',
  imports: [CommonModule],
  template: `
    <div class="tbl-pager" *ngIf="controller">
      <label class="tbl-pager-size">
        <span>Rows per page</span>
        <select [value]="controller.pageSize()" (change)="controller.setPageSize(+$any($event.target).value)">
          <option *ngFor="let n of pageSizeOptions" [value]="n">{{ n }}</option>
        </select>
      </label>
      <div class="tbl-pager-range">{{ controller.rangeLabel() }}</div>
      <div class="tbl-pager-nav">
        <button type="button" (click)="controller.prevPage()" [disabled]="controller.effectivePageIndex() === 0" aria-label="Previous page">‹</button>
        <button type="button" (click)="controller.nextPage()" [disabled]="controller.effectivePageIndex() >= controller.totalPages() - 1" aria-label="Next page">›</button>
      </div>
    </div>
  `,
  styles: [`
    .tbl-pager { display:flex; align-items:center; justify-content:flex-end; gap:16px; flex-wrap:wrap; padding:10px 4px; font-size:12px; color:var(--text-muted, #64748b); }
    .tbl-pager-size { display:flex; align-items:center; gap:6px; }
    .tbl-pager-size select { border:1px solid var(--border, #cbd5e1); border-radius:6px; padding:4px 6px; background:var(--panel, #fff); color:var(--text, #0f172a); font-size:12px; }
    .tbl-pager-nav { display:flex; gap:4px; }
    .tbl-pager-nav button { width:28px; height:28px; border:1px solid var(--border, #cbd5e1); border-radius:6px; background:var(--panel, #fff); color:var(--text, #0f172a); cursor:pointer; font-size:14px; line-height:1; }
    .tbl-pager-nav button:disabled { opacity:.4; cursor:not-allowed; }
  `],
})
export class TablePaginatorComponent {
  @Input({ required: true }) controller!: TableListController<any>;
  @Input() pageSizeOptions: number[] = [10, 25, 50, 100];
}
