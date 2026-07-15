import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { AuditRepo, AuditLog } from '../../core/repos/audit.repo';
import { formatDateTime, tsToDate } from '../../shared/utils/date.util';
import { TableListController } from '../../shared/ui/table-list/table-list.controller';
import { TablePaginatorComponent } from '../../shared/ui/table-list/table-paginator.component';

@Component({
  standalone: true,
  imports: [CommonModule, TablePaginatorComponent],
  template: `
    <h2>Audit Logs</h2>
    <div *ngIf="!orgId" style="color:#b91c1c;">Missing org context.</div>

    <div *ngIf="orgId" style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;">
      <div *ngIf="items().length===0" style="color:#6b7280;">No audit entries yet.</div>

      <div *ngIf="items().length>0" style="margin-bottom:10px;">
        <input
          type="search"
          placeholder="Search action, actor, or target…"
          style="width:100%;max-width:320px;height:36px;padding:0 12px;border:1px solid #cbd5e1;border-radius:6px;"
          [value]="ctrl.filterText()"
          (input)="ctrl.setFilter($any($event.target).value)">
      </div>

      <table *ngIf="items().length>0" style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="text-align:left;border-bottom:1px solid #e5e7eb;">
            <th style="padding:8px;cursor:pointer;user-select:none;" (click)="ctrl.toggleSort('time')">Time {{ ctrl.sortIndicator('time') }}</th>
            <th style="padding:8px;cursor:pointer;user-select:none;" (click)="ctrl.toggleSort('action')">Action {{ ctrl.sortIndicator('action') }}</th>
            <th style="padding:8px;cursor:pointer;user-select:none;" (click)="ctrl.toggleSort('actor')">Actor {{ ctrl.sortIndicator('actor') }}</th>
            <th style="padding:8px;">Target</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngIf="ctrl.pageRows().length===0">
            <td colspan="4" style="padding:14px;color:#6b7280;">No entries match your search.</td>
          </tr>
          <tr *ngFor="let a of ctrl.pageRows()" style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:8px;">{{ fmt(a.createdAt) }}</td>
            <td style="padding:8px;font-weight:900;">{{ a.action }}</td>
            <td style="padding:8px;">{{ actorLabel(a) }}</td>
            <td style="padding:8px;">{{ targetLabel(a) }}</td>
          </tr>
        </tbody>
      </table>

      <app-table-paginator *ngIf="items().length>0" [controller]="ctrl"></app-table-paginator>
    </div>
  `
})
export class AdminAuditPage implements OnDestroy {
  orgId: string | null = null;
  items = signal<AuditLog[]>([]);
  private unsub: (() => void) | null = null;

  ctrl = new TableListController<AuditLog>(this.items, {
    pageSize: 25,
    initialSort: { key: 'time', dir: 'desc' },
    filterPredicate: (a, q) => this.searchText(a).includes(q),
    sortAccessor: (a, key) => {
      if (key === 'time') return tsToDate(a.createdAt)?.getTime() ?? 0;
      if (key === 'action') return a.action?.toLowerCase() ?? '';
      if (key === 'actor') return this.actorLabel(a).toLowerCase();
      return null;
    },
  });

  constructor(private ctx: OrgContextService, private repo: AuditRepo) {
    const bind = () => {
      const orgId = this.ctx.orgId();
      this.orgId = orgId;
      if (!orgId) return;
      if (this.unsub) return;
      this.unsub = this.repo.watchRecent(orgId, (items) => this.items.set(items));
    };
    bind();
    setTimeout(bind, 900);
    setTimeout(bind, 2400);
  }

  fmt(ts: any) { return formatDateTime(ts); }

  actorLabel(a: AuditLog) {
    return (a as any).actorName || (a as any).actorEmail || 'System or admin';
  }

  targetLabel(a: AuditLog) {
    return (a as any).targetUserName || (a as any).documentTitle || a.target?.title || a.target?.name || a.action || 'Record updated';
  }

  private searchText(a: AuditLog): string {
    return `${a.action ?? ''} ${this.actorLabel(a)} ${this.targetLabel(a)}`.toLowerCase();
  }

  ngOnDestroy() {
    if (this.unsub) this.unsub();
    this.unsub = null;
  }
}
