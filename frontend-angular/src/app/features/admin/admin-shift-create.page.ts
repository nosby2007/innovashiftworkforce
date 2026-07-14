import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { AdminShiftsService } from '../../core/services/admin-shifts.service';
import { ToastService } from '../../core/ui/toast.service';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import { getJobRoleOptions } from '../../shared/utils/job-role-catalog.util';

import { MatIconModule } from '@angular/material/icon';

interface OrgSite {
  id: string;
  name: string;
  address?: string;
  active?: boolean;
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="vs-page-pad">
      <!-- Header -->
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">Create Shift</h1>
          <p class="vs-page-subtitle">Draft and publish a new shift to the marketplace</p>
        </div>
      </div>

      <div *ngIf="!orgId" class="cs-no-org vs-glass">
        <mat-icon>warning_amber</mat-icon> Missing org context. (User must have orgId claim)
      </div>

      <div *ngIf="orgId" class="vs-glass-strong cs-container">
        <div class="vs-panel-head">
          <div>
            <div class="vs-panel-title">Shift Details</div>
            <div class="vs-panel-subtitle">Define the shift requirements and timing</div>
          </div>
          <mat-icon style="color:var(--text-subtle);">add_circle_outline</mat-icon>
        </div>

        <div class="vs-panel-body cs-form">
          <div class="vs-form-row vs-form-row--2">
            <div>
              <label class="vs-field-label">Shift Title *</label>
              <input class="vs-input" [(ngModel)]="title" placeholder="e.g. Wound Care Visit">
            </div>
            <div>
              <label class="vs-field-label">Location *</label>
              <select *ngIf="sites.length" class="vs-select" [(ngModel)]="locationId" (ngModelChange)="onSiteChange($event)">
                <option value="">Select a site</option>
                <option *ngFor="let site of sites" [value]="site.id">{{ site.name }}</option>
              </select>
              <input *ngIf="!sites.length" class="vs-input" [(ngModel)]="locationName" placeholder="e.g. Perry, GA">
              <div class="cs-help" *ngIf="sites.length">Choose one of your configured organization sites.</div>
            </div>
          </div>

          <div class="vs-form-row vs-form-row--2">
            <div>
              <label class="vs-field-label">Start Time *</label>
              <input type="datetime-local" class="vs-input" [(ngModel)]="startLocal">
            </div>
            <div>
              <label class="vs-field-label">End Time *</label>
              <input type="datetime-local" class="vs-input" [(ngModel)]="endLocal">
            </div>
          </div>

          <div class="vs-form-row vs-form-row--2">
            <div>
              <label class="vs-field-label">Required Job Roles *</label>
              <select class="vs-select" [(ngModel)]="primaryRole">
                <option *ngFor="let r of jobRoleOptions()" [value]="r.value">{{ r.label }}</option>
              </select>
              <div class="cs-help">{{ orgIndustry === 'Healthcare' ? 'Clinical job roles for healthcare organizations.' : 'Operational job roles for non-healthcare organizations.' }}</div>
            </div>
            <div>
              <label class="vs-field-label">Additional Required Roles</label>
              <select class="vs-select" [(ngModel)]="secondaryRole">
                <option value="">None</option>
                <option *ngFor="let r of jobRoleOptions()" [value]="r.value">{{ r.label }}</option>
              </select>
            </div>
          </div>

          <div *ngIf="primaryRole === 'Other' || secondaryRole === 'Other'" class="vs-form-row">
            <div>
              <label class="vs-field-label">Custom Required Role *</label>
              <input class="vs-input" [(ngModel)]="customRole" placeholder="e.g. Billing Specialist, Forklift Operator">
            </div>
          </div>

          <div class="cs-actions">
            <div *ngIf="msg" class="cs-msg cs-msg--ok"><mat-icon>check_circle</mat-icon> {{ msg }}</div>
            
            <button class="vs-btn-ghost cs-btn" (click)="submit(false)" [disabled]="busy || !canSubmit()">
              Save as Draft
            </button>
            <button class="vs-btn-primary cs-btn" (click)="submit(true)" [disabled]="busy || !canSubmit()">
              <mat-icon>campaign</mat-icon> Publish Shift
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .cs-no-org { display:flex; align-items:center; gap:12px; padding:20px; color:var(--warning); font-weight:600; }
    .cs-container { max-width: 800px; margin: 0 auto; overflow: hidden; }
    .cs-form { padding-top: 0 !important; }
    .cs-help { font-size: 12px; color: var(--text-muted); margin-top: 6px; }
    
    .cs-actions { display:flex; align-items:center; justify-content:flex-end; gap:12px; margin-top:24px; padding-top:20px; border-top:1px solid var(--border); flex-wrap:wrap; }
    .cs-btn { padding: 10px 20px !important; display:inline-flex; align-items:center; gap:6px; }
    
    .cs-msg { display:flex; align-items:center; gap:8px; padding:8px 14px; border-radius:var(--radius-sm); font-size:13px; font-weight:600; margin-right:auto; }
    .cs-msg mat-icon { font-size: 16px !important; }
    .cs-msg--ok  { background: rgba(34,197,94,0.12); color: #86efac; border: 1px solid rgba(34,197,94,0.25); }
    .cs-msg--err { background: rgba(239,68,68,0.12); color: #fca5a5; border: 1px solid rgba(239,68,68,0.25); }
  `]
})
export class AdminShiftCreatePage {
  orgId: string | null = null;
  orgIndustry = 'Healthcare';

  title = '';
  locationId = '';
  locationName = '';
  startLocal = '';
  endLocal = '';
  primaryRole = 'RN';
  secondaryRole = '';
  customRole = '';
  sites: OrgSite[] = [];

  busy = false;
  msg = '';

  constructor(private ctx: OrgContextService, private api: AdminShiftsService, private toast: ToastService) {
    this.orgId = this.ctx.orgId();

    // Si ton OrgContext met du temps à hydrater (claims), on retente
    setTimeout(() => { if (!this.orgId) this.orgId = this.ctx.orgId(); }, 500);
    setTimeout(() => { if (!this.orgId) this.orgId = this.ctx.orgId(); }, 1500);

    if (this.orgId) {
      void this.loadOrgIndustry(this.orgId);
    }
  }

  jobRoleOptions() {
    return getJobRoleOptions(this.orgIndustry);
  }

  canSubmit() {
    return !!this.orgId
      && !!this.title.trim()
      && !!this.startLocal
      && !!this.endLocal
      && (!!this.locationId || !!this.locationName.trim());
  }

  private toIso(local: string) {
    const d = new Date(local);
    return d.toISOString();
  }

  async submit(publish: boolean) {
    this.msg = '';
    this.busy = true;
    try {
      const requiredJobRoles = Array.from(new Set([
        this.primaryRole === 'Other' ? this.customRole.trim() : this.primaryRole.trim(),
        this.secondaryRole === 'Other' ? this.customRole.trim() : this.secondaryRole.trim(),
      ].filter(Boolean)));

      const res = await this.api.createShift({
        orgId: this.orgId!,
        title: this.title.trim(),
        locationId: this.locationId || null,
        locationName: this.locationName.trim(),
        startAtIso: this.toIso(this.startLocal),
        endAtIso: this.toIso(this.endLocal),
        requiredJobRoles,
        status: publish ? 'published' : 'draft',
        publish
      });

      this.msg = 'Shift created successfully.';

      // reset
      this.title = '';
      this.locationId = '';
      this.locationName = '';
      this.startLocal = '';
      this.endLocal = '';
      this.primaryRole = this.jobRoleOptions()[0]?.value ?? 'RN';
      this.secondaryRole = '';
      this.customRole = '';
    } catch (e: any) {
      this.toast.errorFrom(e, 'Create shift failed.');
    } finally {
      this.busy = false;
    }
  }

  private async loadOrgIndustry(orgId: string) {
    try {
      const snap = await getDoc(doc(getFirestore(), 'orgs', orgId));
      const industry = String((snap.data() as any)?.industry || '').trim();
      const sites = Array.isArray((snap.data() as any)?.sites) ? (snap.data() as any).sites : [];
      if (industry) {
        this.orgIndustry = industry;
        this.primaryRole = this.jobRoleOptions()[0]?.value ?? this.primaryRole;
      }
      this.sites = sites.filter((site: OrgSite) => site?.active !== false && site?.id && site?.name);
      if (this.sites.length === 1) {
        this.locationId = this.sites[0].id;
        this.locationName = this.sites[0].name;
      }
    } catch {
      // Keep default catalog if the org doc is unavailable.
    }
  }

  onSiteChange(siteId: string) {
    this.locationId = siteId;
    const site = this.sites.find((item) => item.id === siteId);
    this.locationName = site?.name || '';
  }
}
