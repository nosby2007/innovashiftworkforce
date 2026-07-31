import { Component, OnDestroy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { AvailabilityEntry, AvailabilityRepo } from '../../core/repos/availability.repo';

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface DateGroup {
  date: string;
  label: string;
  entries: AvailabilityEntry[];
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="vs-page-pad">
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">Staff Availability</h1>
          <p class="vs-page-subtitle">Who's available and when — submitted by staff, especially useful for filling PRN/on-call shifts. The AI Copilot reads this too when proposing assignments.</p>
        </div>
      </div>

      <div *ngIf="!orgId" class="vs-glass avl-no-org">
        <mat-icon>warning_amber</mat-icon>
        Missing organization context.
      </div>

      <div class="vs-glass avl-filter-bar" *ngIf="orgId">
        <div class="vs-form-row vs-form-row--3">
          <div>
            <label class="vs-field-label">From</label>
            <input class="vs-input" type="date" [(ngModel)]="fromDate" (ngModelChange)="reload()">
          </div>
          <div>
            <label class="vs-field-label">To</label>
            <input class="vs-input" type="date" [(ngModel)]="toDate" (ngModelChange)="reload()">
          </div>
          <div>
            <label class="vs-field-label">Job role</label>
            <input class="vs-input" [(ngModel)]="jobRoleFilter" placeholder="e.g. RN — leave blank for all">
          </div>
        </div>
      </div>

      <section class="vs-glass-strong vs-panel" *ngIf="orgId">
        <div class="vs-panel-head">
          <div>
            <div class="vs-panel-title">Submissions</div>
            <div class="vs-panel-subtitle">{{ filteredEntries().length }} entr{{ filteredEntries().length === 1 ? 'y' : 'ies' }} in range</div>
          </div>
          <mat-icon [class.sa-spin]="loading()">refresh</mat-icon>
        </div>
        <div class="vs-panel-body">
          <div class="avl-empty" *ngIf="!loading() && groups().length === 0">
            <mat-icon>event_busy</mat-icon>
            <div>No availability submitted for this range yet.</div>
          </div>
          <div class="avl-group" *ngFor="let g of groups()">
            <div class="avl-group-date">{{ g.label }}</div>
            <div class="avl-group-row" *ngFor="let e of g.entries">
              <div class="avl-person">
                <strong>{{ e.userDisplayName || 'Staff member' }}</strong>
                <span class="vs-badge vs-badge--neutral" *ngIf="e.jobRole">{{ e.jobRole }}</span>
              </div>
              <div class="avl-time">{{ e.startTime }} – {{ e.endTime }}</div>
              <div class="avl-note" *ngIf="e.note">{{ e.note }}</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .avl-no-org { display: flex; align-items: center; gap: 10px; padding: 16px 18px; color: var(--warning); margin-bottom: 16px; }
    .avl-filter-bar { padding: 16px 18px; margin-bottom: 20px; }
    .avl-empty { display: flex; align-items: flex-start; gap: 10px; padding: 20px 4px; color: var(--text-muted); font-size: 13px; }
    .avl-group { margin-bottom: 18px; }
    .avl-group:last-child { margin-bottom: 0; }
    .avl-group-date { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-subtle); padding: 8px 4px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
    .avl-group-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; padding: 10px 4px; border-bottom: 1px solid var(--border); }
    .avl-group-row:last-child { border-bottom: none; }
    .avl-person { display: flex; align-items: center; gap: 8px; }
    .avl-person strong { font-size: 13.5px; color: var(--text); }
    .avl-time { font-size: 13px; font-weight: 700; color: var(--text); white-space: nowrap; }
    .avl-note { font-size: 12px; color: var(--text-muted); text-align: right; }
    @media (max-width: 700px) { .avl-group-row { grid-template-columns: 1fr; } .avl-note { text-align: left; } }
  `],
})
export class AdminAvailabilityPage implements OnDestroy {
  orgId: string | null = null;
  fromDate = toIso(new Date());
  toDate = toIso(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));
  jobRoleFilter = '';

  loading = signal(false);
  entries = signal<AvailabilityEntry[]>([]);
  filteredEntries = computed(() => {
    const wanted = this.jobRoleFilter.trim().toLowerCase();
    if (!wanted) return this.entries();
    return this.entries().filter((e) => String(e.jobRole || '').toLowerCase().includes(wanted));
  });
  groups = computed<DateGroup[]>(() => {
    const byDate = new Map<string, AvailabilityEntry[]>();
    for (const e of this.filteredEntries()) {
      const bucket = byDate.get(e.date) ?? [];
      bucket.push(e);
      byDate.set(e.date, bucket);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, entries]) => ({
        date,
        label: this.fmtDate(date),
        entries: entries.sort((a, b) => a.startTime.localeCompare(b.startTime)),
      }));
  });

  private unsub: (() => void) | null = null;

  constructor(
    private ctx: OrgContextService,
    private repo: AvailabilityRepo,
  ) {
    const bind = () => {
      const orgId = this.ctx.orgId();
      this.orgId = orgId;
      if (!orgId) return;
      this.reload();
    };
    bind();
    setTimeout(bind, 700);
    setTimeout(bind, 2000);
  }

  fmtDate(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }

  reload() {
    if (!this.orgId || !this.fromDate || !this.toDate) return;
    this.unsub?.();
    this.loading.set(true);
    this.unsub = this.repo.watchOrgAvailability(this.orgId, this.fromDate, this.toDate, (items) => {
      this.entries.set(items);
      this.loading.set(false);
    });
  }

  ngOnDestroy() {
    this.unsub?.();
    this.unsub = null;
  }
}
