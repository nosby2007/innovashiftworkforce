import { Component, OnDestroy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { AvailabilityEntry, AvailabilityRepo } from '../../core/repos/availability.repo';
import { ToastService } from '../../core/ui/toast.service';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, TranslocoModule],
  template: `
    <div class="vs-page-pad">
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">{{ 'availability.title' | transloco }}</h1>
          <p class="vs-page-subtitle">
            {{ 'availability.subtitle' | transloco }}
          </p>
        </div>
      </div>

      <div *ngIf="!orgId || !uid" class="vs-glass avl-no-org">
        <mat-icon>warning_amber</mat-icon>
        {{ 'availability.missingAccountContext' | transloco }}
      </div>

      <div class="vs-grid-2" *ngIf="orgId && uid">
        <section class="vs-glass-strong vs-panel">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'availability.addAvailability' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'availability.addAvailabilitySub' | transloco }}</div>
            </div>
            <mat-icon class="avl-icon">event_available</mat-icon>
          </div>
          <div class="vs-panel-body">
            <form (ngSubmit)="submit()">
              <div class="vs-form-row vs-form-row--2">
                <div>
                  <label class="vs-field-label" for="avl-date">{{ 'availability.date' | transloco }}</label>
                  <input id="avl-date" class="vs-input" type="date" [(ngModel)]="draftDate" name="date" [min]="minDate" required>
                </div>
                <div></div>
              </div>
              <div class="vs-form-row vs-form-row--2">
                <div>
                  <label class="vs-field-label" for="avl-start">{{ 'availability.availableFrom' | transloco }}</label>
                  <input id="avl-start" class="vs-input" type="time" [(ngModel)]="draftStart" name="startTime" required>
                </div>
                <div>
                  <label class="vs-field-label" for="avl-end">{{ 'availability.availableUntil' | transloco }}</label>
                  <input id="avl-end" class="vs-input" type="time" [(ngModel)]="draftEnd" name="endTime" required>
                </div>
              </div>
              <label class="vs-field-label" for="avl-note">{{ 'availability.noteOptional' | transloco }}</label>
              <input id="avl-note" class="vs-input" [(ngModel)]="draftNote" name="note" [placeholder]="'availability.notePlaceholder' | transloco">

              <div class="avl-form-actions">
                <button class="vs-btn-primary" type="submit" [disabled]="busy() || !draftDate || !draftStart || !draftEnd">
                  <mat-icon>{{ busy() ? 'hourglass_empty' : 'add' }}</mat-icon>
                  {{ (busy() ? 'availability.adding' : 'availability.addAvailabilityAction') | transloco }}
                </button>
              </div>
            </form>
          </div>
        </section>

        <section class="vs-glass-strong vs-panel">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'availability.upcomingAvailability' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'availability.submittedCount' | transloco: { count: entries().length } }}</div>
            </div>
          </div>
          <div class="vs-panel-body">
            <div class="avl-empty" *ngIf="entries().length === 0">
              <mat-icon>event_busy</mat-icon>
              <div>{{ 'availability.noAvailabilitySubmitted' | transloco }}</div>
            </div>
            <div class="avl-row" *ngFor="let e of entries()">
              <div>
                <strong>{{ fmtDate(e.date) }}</strong>
                <span>{{ e.startTime }} – {{ e.endTime }}</span>
                <small *ngIf="e.note">{{ e.note }}</small>
              </div>
              <button class="avl-remove-btn" type="button" (click)="remove(e)" [disabled]="busy()" [title]="'availability.remove' | transloco">
                <mat-icon>close</mat-icon>
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .avl-no-org { display: flex; align-items: center; gap: 10px; padding: 16px 18px; color: var(--warning); }
    .avl-icon { color: var(--text-subtle); }
    .vs-field-label { display: block; margin-top: 12px; margin-bottom: 6px; }
    .vs-field-label:first-child { margin-top: 0; }
    .avl-form-actions { margin-top: 16px; display: flex; justify-content: flex-end; }
    .avl-empty { display: flex; align-items: flex-start; gap: 10px; padding: 20px 4px; color: var(--text-muted); font-size: 13px; }
    .avl-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 4px; border-bottom: 1px solid var(--border); }
    .avl-row:last-child { border-bottom: none; }
    .avl-row strong { display: block; font-size: 13.5px; color: var(--text); }
    .avl-row span { display: block; margin-top: 2px; font-size: 12.5px; color: var(--text-muted); }
    .avl-row small { display: block; margin-top: 4px; font-size: 12px; color: var(--text-subtle); }
    .avl-remove-btn { border: 0; background: transparent; color: var(--text-subtle); cursor: pointer; padding: 6px; border-radius: 6px; flex-shrink: 0; }
    .avl-remove-btn:hover:not(:disabled) { background: rgba(239,68,68,0.1); color: var(--danger); }
    .avl-remove-btn:disabled { opacity: .4; cursor: not-allowed; }
  `],
})
export class StaffAvailabilityPage implements OnDestroy {
  orgId: string | null = null;
  uid: string | null = null;
  minDate = todayIso();

  draftDate = '';
  draftStart = '';
  draftEnd = '';
  draftNote = '';
  busy = signal(false);

  entries = signal<AvailabilityEntry[]>([]);
  private unsub: (() => void) | null = null;

  constructor(
    private ctx: OrgContextService,
    private repo: AvailabilityRepo,
    private toast: ToastService,
    private i18n: TranslocoService,
  ) {
    const bind = () => {
      const orgId = this.ctx.orgId();
      const uid = this.ctx.uid();
      this.orgId = orgId;
      this.uid = uid;
      if (!orgId || !uid || this.unsub) return;
      this.unsub = this.repo.watchMyAvailability(orgId, uid, (items) => this.entries.set(items));
    };
    bind();
    setTimeout(bind, 700);
    setTimeout(bind, 2000);
  }

  fmtDate(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  async submit() {
    if (!this.orgId || !this.uid || this.busy()) return;
    if (!this.draftDate || !this.draftStart || !this.draftEnd) return;
    if (this.draftEnd <= this.draftStart) {
      this.toast.error(this.i18n.translate('availability.endAfterStart'));
      return;
    }
    this.busy.set(true);
    try {
      await this.repo.addEntry({
        orgId: this.orgId,
        userId: this.uid,
        userDisplayName: this.ctx.displayName(),
        jobRole: this.ctx.jobRole(),
        date: this.draftDate,
        startTime: this.draftStart,
        endTime: this.draftEnd,
        note: this.draftNote.trim() || null,
      });
      this.toast.success(this.i18n.translate('availability.availabilityAdded'));
      this.draftDate = '';
      this.draftStart = '';
      this.draftEnd = '';
      this.draftNote = '';
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('availability.addFailed'));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(entry: AvailabilityEntry) {
    if (!this.orgId || this.busy()) return;
    this.busy.set(true);
    try {
      await this.repo.removeEntry(this.orgId, entry.id);
    } catch (e: any) {
      this.toast.errorFrom(e, this.i18n.translate('availability.removeFailed'));
    } finally {
      this.busy.set(false);
    }
  }

  ngOnDestroy() {
    this.unsub?.();
    this.unsub = null;
  }
}
