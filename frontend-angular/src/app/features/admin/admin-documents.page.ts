import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { OrgContextService } from '../../core/tenancy/org-context.service';
import { EmployeeDocumentRecord, EmployeeDocumentsRepo } from '../../core/repos/employee-documents.repo';
import { AdminCommands } from '../../core/commands/admin.commands';
import { ToastService } from '../../core/ui/toast.service';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, MatIconModule],
  template: `
    <div class="vs-page-pad docs-admin">
      <header class="docs-hero">
        <div>
          <span>Compliance Queue</span>
          <h1>Document Verification</h1>
          <p>Review employee uploads, approve clean records, and send correction notes when documents need updates.</p>
        </div>
        <button class="docs-refresh" type="button" (click)="bind(true)">
          <mat-icon>refresh</mat-icon> Refresh
        </button>
      </header>

      <div *ngIf="!orgId" class="docs-alert">
        <mat-icon>warning_amber</mat-icon>
        Missing organization context.
      </div>

      <ng-container *ngIf="orgId">
        <section class="docs-kpis">
          <article><span>Pending</span><strong>{{ count('pending') }}</strong></article>
          <article><span>Verified</span><strong>{{ count('verified') }}</strong></article>
          <article><span>Needs Update</span><strong>{{ count('rejected') }}</strong></article>
          <article><span>Total Records</span><strong>{{ documents().length }}</strong></article>
        </section>

        <section class="docs-toolbar">
          <label>
            <span>Status</span>
            <select [(ngModel)]="statusFilter">
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="verified">Verified</option>
              <option value="rejected">Needs update</option>
            </select>
          </label>
          <label>
            <span>Search</span>
            <input [(ngModel)]="search" placeholder="Employee, email, document title">
          </label>
        </section>

        <section class="docs-list">
          <div *ngIf="filtered().length === 0" class="docs-empty">
            <mat-icon>folder_open</mat-icon>
            No documents match this view.
          </div>

          <article *ngFor="let item of filtered()" class="docs-row">
            <div class="docs-row-main">
              <div class="docs-person">
                <span class="docs-avatar">{{ initials(item) }}</span>
                <div>
                  <strong>{{ item.userDisplayName || item.userEmail || 'Staff member' }}</strong>
                  <small>{{ item.userEmail || 'Email not set' }}</small>
                </div>
              </div>
              <div class="docs-file">
                <strong>{{ item.title || label(item) }}</strong>
                <small>{{ label(item) }} · {{ item.fileName }}</small>
                <em *ngIf="item.reviewNote">{{ item.reviewNote }}</em>
              </div>
            </div>

            <div class="docs-meta">
              <span [class.is-ok]="item.status === 'verified'" [class.is-bad]="item.status === 'rejected'">{{ statusLabel(item.status) }}</span>
              <small>{{ item.uploadedAt?.toDate?.() || item.uploadedAt | date:'mediumDate' }}</small>
            </div>

            <div class="docs-actions">
              <button type="button" (click)="open(item)">
                <mat-icon>open_in_new</mat-icon> Open
              </button>
              <button type="button" (click)="review(item, 'rejected')" [disabled]="busyId === item.id">
                <mat-icon>close</mat-icon> Reject
              </button>
              <button type="button" class="is-primary" (click)="review(item, 'verified')" [disabled]="busyId === item.id">
                <mat-icon>check</mat-icon> Verify
              </button>
            </div>
          </article>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .docs-admin { color:var(--text); }
    .docs-hero { min-height:150px; margin:-24px -22px 22px; padding:28px; display:flex; align-items:end; justify-content:space-between; gap:18px; background:#07533f; color:#fff; }
    .docs-hero span { color:rgba(255,255,255,.74); font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:.08em; }
    .docs-hero h1 { margin:6px 0; font-size:34px; line-height:1.05; }
    .docs-hero p { margin:0; max-width:720px; color:rgba(255,255,255,.82); }
    .docs-refresh { min-height:42px; border:0; border-radius:8px; padding:0 14px; display:inline-flex; align-items:center; gap:8px; background:#fff; color:#07533f; font-weight:900; cursor:pointer; }
    .docs-alert { display:flex; gap:10px; align-items:center; padding:14px 16px; border:1px solid #fed7aa; border-radius:8px; background:#fff7ed; color:#92400e; font-weight:800; }
    .docs-kpis { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:14px; margin-bottom:16px; }
    .docs-kpis article { border:1px solid var(--border); border-radius:8px; padding:16px; background:var(--panel); box-shadow:0 12px 28px rgba(15,23,42,.06); }
    .docs-kpis span { display:block; color:var(--text-muted); font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.08em; }
    .docs-kpis strong { display:block; margin-top:7px; font-size:30px; color:var(--text); }
    .docs-toolbar { display:grid; grid-template-columns:220px 1fr; gap:12px; margin-bottom:14px; }
    .docs-toolbar label span { display:block; margin-bottom:6px; color:var(--text-muted); font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.06em; }
    .docs-toolbar select, .docs-toolbar input { width:100%; min-height:42px; border:1px solid var(--border); border-radius:8px; padding:0 11px; background:var(--input-bg, #fff); color:var(--text); font-weight:700; }
    .docs-list { display:grid; gap:10px; }
    .docs-row { display:grid; grid-template-columns:1fr auto auto; gap:14px; align-items:center; border:1px solid var(--border); border-radius:8px; background:var(--panel); padding:12px; }
    .docs-row-main { display:grid; grid-template-columns:minmax(220px,.8fr) 1fr; gap:14px; align-items:center; min-width:0; }
    .docs-person { display:flex; gap:10px; align-items:center; min-width:0; }
    .docs-avatar { width:40px; height:40px; border-radius:10px; display:grid; place-items:center; background:linear-gradient(135deg,#2563eb,#14b8a6); color:#fff; font-weight:900; flex:0 0 40px; }
    .docs-person strong, .docs-file strong { display:block; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .docs-person small, .docs-file small { display:block; margin-top:3px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .docs-file em { display:block; margin-top:5px; color:#92400e; font-style:normal; font-weight:800; }
    .docs-meta { display:grid; justify-items:start; gap:6px; min-width:120px; }
    .docs-meta span { padding:5px 9px; border-radius:999px; background:#fff7ed; color:#92400e; font-size:11px; font-weight:900; text-transform:uppercase; }
    .docs-meta span.is-ok { background:#ecfdf5; color:#047857; }
    .docs-meta span.is-bad { background:#fef2f2; color:#b91c1c; }
    .docs-meta small { color:var(--text-muted); }
    .docs-actions { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
    .docs-actions button { min-height:36px; border:1px solid var(--border); border-radius:8px; padding:0 10px; display:inline-flex; align-items:center; gap:6px; background:var(--panel-2, #fff); color:var(--text); font-weight:900; cursor:pointer; }
    .docs-actions button.is-primary { border-color:#047857; background:#047857; color:#fff; }
    .docs-actions button:disabled { opacity:.55; cursor:not-allowed; }
    .docs-empty { min-height:180px; border:1px dashed var(--border); border-radius:8px; display:grid; place-items:center; gap:8px; color:var(--text-muted); font-weight:800; }
    @media (max-width:980px) { .docs-hero { margin:-14px -12px 18px; padding:22px 16px; align-items:flex-start; flex-direction:column; } .docs-kpis, .docs-toolbar, .docs-row, .docs-row-main { grid-template-columns:1fr; } .docs-actions { justify-content:flex-start; } }
  `],
})
export class AdminDocumentsPage implements OnDestroy {
  orgId: string | null = null;
  documents = signal<EmployeeDocumentRecord[]>([]);
  statusFilter: 'all' | 'pending' | 'verified' | 'rejected' = 'pending';
  search = '';
  busyId: string | null = null;
  private unsub: (() => void) | null = null;

  constructor(
    private ctx: OrgContextService,
    private docs: EmployeeDocumentsRepo,
    private admin: AdminCommands,
    private toast: ToastService,
  ) {
    this.bind();
    setTimeout(() => this.bind(), 900);
  }

  bind(force = false) {
    const orgId = this.ctx.orgId();
    this.orgId = orgId;
    if (!orgId) return;
    if (force) {
      this.unsub?.();
      this.unsub = null;
    }
    if (this.unsub) return;
    this.unsub = this.docs.watchOrgQueue(orgId, (items) => this.documents.set(items), 150);
  }

  filtered() {
    const q = this.search.trim().toLowerCase();
    return this.documents().filter((item) => {
      const statusOk = this.statusFilter === 'all' || item.status === this.statusFilter;
      const haystack = [item.userDisplayName, item.userEmail, item.title, item.fileName, item.type].filter(Boolean).join(' ').toLowerCase();
      return statusOk && (!q || haystack.includes(q));
    });
  }

  count(status: string) {
    return this.documents().filter((item) => item.status === status).length;
  }

  label(item: EmployeeDocumentRecord) {
    return this.docs.labelFor(item.type);
  }

  initials(item: EmployeeDocumentRecord) {
    const raw = item.userDisplayName || item.userEmail || 'Staff';
    const parts = raw.split(/[\s@.]+/).filter(Boolean);
    return parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : raw.slice(0, 2).toUpperCase();
  }

  statusLabel(status: string) {
    if (status === 'verified') return 'Verified';
    if (status === 'rejected') return 'Needs update';
    return 'Pending';
  }

  async open(item: EmployeeDocumentRecord) {
    try {
      window.open(await this.docs.getDocumentUrl(item), '_blank', 'noopener');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Unable to open document.');
    }
  }

  async review(item: EmployeeDocumentRecord, decision: 'verified' | 'rejected') {
    if (!this.orgId) return;
    let reviewNote = '';
    if (decision === 'rejected') {
      reviewNote = String(window.prompt('What should the employee correct?') || '').trim();
      if (!reviewNote) return;
    }
    this.busyId = item.id;
    try {
      await this.admin.reviewEmployeeDocument({
        orgId: this.orgId,
        documentId: item.id,
        decision,
        reviewNote: reviewNote || undefined,
      });
      this.toast.success(decision === 'verified' ? 'Document verified.' : 'Document rejected.');
    } catch (e: any) {
      this.toast.errorFrom(e, 'Failed to review document.');
    } finally {
      this.busyId = null;
    }
  }

  ngOnDestroy() {
    this.unsub?.();
  }
}
