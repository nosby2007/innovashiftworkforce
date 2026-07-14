import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { AuditRepo, AuditLog } from '../../core/repos/audit.repo';
import { formatDateTime } from '../../shared/utils/date.util';

@Component({
  standalone: true,
  imports: [CommonModule],
  template: `
    <h2>Audit Logs</h2>
    <div *ngIf="!orgId" style="color:#b91c1c;">Missing org context.</div>

    <div *ngIf="orgId" style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;">
      <div *ngIf="items().length===0" style="color:#6b7280;">No audit entries yet.</div>

      <table *ngIf="items().length>0" style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="text-align:left;border-bottom:1px solid #e5e7eb;">
            <th style="padding:8px;">Time</th>
            <th style="padding:8px;">Action</th>
            <th style="padding:8px;">Actor</th>
            <th style="padding:8px;">Target</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let a of items()" style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:8px;">{{ fmt(a.createdAt) }}</td>
            <td style="padding:8px;font-weight:900;">{{ a.action }}</td>
            <td style="padding:8px;">{{ actorLabel(a) }}</td>
            <td style="padding:8px;">{{ targetLabel(a) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `
})
export class AdminAuditPage implements OnDestroy {
  orgId: string | null = null;
  items = signal<AuditLog[]>([]);
  private unsub: (() => void) | null = null;

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

  ngOnDestroy() {
    if (this.unsub) this.unsub();
    this.unsub = null;
  }
}
