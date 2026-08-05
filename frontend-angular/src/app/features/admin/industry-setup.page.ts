import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoModule } from '@jsverse/transloco';
import { OrgContextService } from '../../core/tenancy/org-context.service';
import { OrgExperienceService } from '../../core/experience/org-experience.service';
import { TerminologyService } from '../../core/experience/terminology.service';
import { IndustryProfilesRepo } from '../../core/repos/industry-profiles.repo';
import { ExperienceCommands } from '../../core/commands/experience.commands';
import { ToastService } from '../../core/ui/toast.service';
import { IndustryProfile, IndustryProfileVersion } from '../../shared/models/experience-config.model';

/**
 * First-time industry setup only — an org's own admin picks and activates
 * one of the seeded industry profiles. If the org is already `configured`,
 * this page shows a read-only summary; switching profiles (with a diff/
 * rollback UI) is a later phase, not this one.
 */
@Component({
  standalone: true,
  selector: 'app-industry-setup',
  imports: [CommonModule, RouterLink, MatIconModule, TranslocoModule],
  template: `
    <div class="vs-page-pad isw-page">
      <header class="isw-header">
        <div>
          <div class="isw-eyebrow">{{ 'industrySetup.eyebrow' | transloco }}</div>
          <h1>{{ 'industrySetup.title' | transloco }}</h1>
          <p>{{ 'industrySetup.subtitle' | transloco }}</p>
        </div>
        <a class="vs-btn-ghost" routerLink="/admin/org-settings">
          <mat-icon>arrow_back</mat-icon> {{ 'industrySetup.backToSettings' | transloco }}
        </a>
      </header>

      <div class="isw-loading" *ngIf="loading()">
        <mat-icon>hourglass_empty</mat-icon> {{ 'common.loading' | transloco }}
      </div>

      <section class="vs-glass-strong isw-section" *ngIf="!loading() && isConfigured()">
        <div class="vs-panel-head">
          <div>
            <div class="vs-panel-title">{{ 'industrySetup.activeTitle' | transloco }}</div>
            <div class="vs-panel-subtitle">{{ 'industrySetup.activeSubtitle' | transloco }}</div>
          </div>
          <mat-icon class="isw-section-icon">verified</mat-icon>
        </div>
        <div class="vs-panel-body">
          <div class="isw-active-card">
            <span class="vs-badge vs-badge--success">{{ 'industrySetup.active' | transloco }}</span>
            <strong>{{ config().industryProfileId }}</strong>
          </div>
          <p class="isw-note">{{ 'industrySetup.switchingComingSoon' | transloco }}</p>
        </div>
      </section>

      <ng-container *ngIf="!loading() && !isConfigured()">
        <section class="vs-glass-strong isw-section" *ngIf="view() === 'select'">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'industrySetup.selectTitle' | transloco }}</div>
              <div class="vs-panel-subtitle">{{ 'industrySetup.selectSubtitle' | transloco }}</div>
            </div>
          </div>
          <div class="vs-panel-body">
            <div class="isw-grid">
              <div class="isw-card" *ngFor="let profile of profiles()">
                <div class="isw-card-head">
                  <strong>{{ profile.name }}</strong>
                  <span class="vs-badge vs-badge--neutral">{{ profile.category }}</span>
                </div>
                <p>{{ profile.description }}</p>
                <button class="vs-btn-primary" type="button" [disabled]="busy()" (click)="selectProfile(profile)">
                  {{ 'industrySetup.selectButton' | transloco }}
                </button>
              </div>
            </div>
            <p class="isw-note" *ngIf="!profiles().length">{{ 'industrySetup.noProfiles' | transloco }}</p>
          </div>
        </section>

        <section class="vs-glass-strong isw-section" *ngIf="view() === 'confirm' && selectedProfile() && selectedVersion() as version">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">{{ 'industrySetup.confirmTitle' | transloco: { name: selectedProfile()!.name } }}</div>
              <div class="vs-panel-subtitle">{{ 'industrySetup.confirmSubtitle' | transloco }}</div>
            </div>
          </div>
          <div class="vs-panel-body">
            <table class="isw-compare">
              <thead>
                <tr>
                  <th>{{ 'industrySetup.concept' | transloco }}</th>
                  <th>{{ 'industrySetup.current' | transloco }}</th>
                  <th>{{ 'industrySetup.proposed' | transloco }}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{{ 'industrySetup.workUnit' | transloco }}</td>
                  <td>{{ terminology.workUnitPlural() }}</td>
                  <td><strong>{{ version.terminology.workUnit.plural }}</strong></td>
                </tr>
                <tr>
                  <td>{{ 'industrySetup.workforceMember' | transloco }}</td>
                  <td>{{ terminology.workforceMemberPlural() }}</td>
                  <td><strong>{{ version.terminology.workforceMember.plural }}</strong></td>
                </tr>
                <tr>
                  <td>{{ 'industrySetup.marketplace' | transloco }}</td>
                  <td>{{ terminology.marketplaceLabel() }}</td>
                  <td><strong>{{ version.terminology.marketplaceLabel }}</strong></td>
                </tr>
              </tbody>
            </table>

            <p class="isw-note" *ngIf="!canActivate()">{{ 'industrySetup.adminOnly' | transloco }}</p>

            <div class="isw-actions">
              <button class="vs-btn-ghost" type="button" [disabled]="busy()" (click)="back()">
                {{ 'industrySetup.backButton' | transloco }}
              </button>
              <button class="vs-btn-primary" type="button" [disabled]="busy() || !canActivate()" (click)="activate()">
                {{ busy() ? ('industrySetup.activating' | transloco) : ('industrySetup.activateButton' | transloco) }}
              </button>
            </div>
          </div>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .isw-page { display: flex; flex-direction: column; gap: 16px; }
    .isw-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .isw-header h1 { margin: 4px 0; }
    .isw-header p { margin: 0; color: var(--text-muted); }
    .isw-eyebrow { font-size: 12px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--primary); }
    .isw-loading { display: flex; align-items: center; gap: 8px; color: var(--text-muted); padding: 24px 0; }
    .isw-section { padding: 4px; }
    .isw-section-icon { color: var(--primary); }
    .isw-active-card { display: flex; align-items: center; gap: 12px; }
    .isw-note { margin: 12px 0 0; color: var(--text-muted); font-size: 13px; }
    .isw-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .isw-card { display: grid; gap: 10px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--panel); }
    .isw-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .isw-card p { margin: 0; color: var(--text-muted); font-size: 13px; line-height: 1.4; }
    .isw-compare { width: 100%; border-collapse: collapse; margin-top: 4px; }
    .isw-compare th, .isw-compare td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 14px; }
    .isw-compare th { color: var(--text-muted); font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
    .isw-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; }
  `],
})
export class IndustrySetupPage {
  private ctx = inject(OrgContextService);
  private profilesRepo = inject(IndustryProfilesRepo);
  private commands = inject(ExperienceCommands);
  private toast = inject(ToastService);
  private router = inject(Router);

  experience = inject(OrgExperienceService);
  terminology = inject(TerminologyService);

  loading = signal(true);
  busy = signal(false);
  profiles = signal<IndustryProfile[]>([]);
  view = signal<'select' | 'confirm'>('select');
  selectedProfile = signal<IndustryProfile | null>(null);
  selectedVersion = signal<IndustryProfileVersion | null>(null);

  config = computed(() => this.experience.config());
  isConfigured = computed(() => this.config().configurationStatus === 'configured');
  canActivate = computed(() => this.ctx.accessRole() === 'admin');

  constructor() {
    void this.profilesRepo.listActive().then((items) => {
      this.profiles.set(items);
      this.loading.set(false);
    }).catch(() => this.loading.set(false));
  }

  async selectProfile(profile: IndustryProfile) {
    this.busy.set(true);
    try {
      const versionId = profile.latestVersionId || 'v1';
      const version = await this.profilesRepo.getPublishedVersion(profile.id, versionId);
      if (!version) {
        this.toast.error('This profile is not available right now.');
        return;
      }
      this.selectedProfile.set(profile);
      this.selectedVersion.set(version);
      this.view.set('confirm');
    } finally {
      this.busy.set(false);
    }
  }

  back() {
    this.view.set('select');
    this.selectedProfile.set(null);
    this.selectedVersion.set(null);
  }

  async activate() {
    const profile = this.selectedProfile();
    const version = this.selectedVersion();
    if (!profile || !version) return;
    this.busy.set(true);
    try {
      await this.commands.activateIndustryProfile(profile.id, version.versionId);
      await this.experience.refresh();
      this.toast.success(`Activated: ${profile.name}`);
    } catch (e: any) {
      this.toast.errorFrom(e, 'Could not activate this profile.');
    } finally {
      this.busy.set(false);
    }
  }
}
