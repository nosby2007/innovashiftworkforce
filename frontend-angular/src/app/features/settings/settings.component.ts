import { Component, inject } from '@angular/core';
import { NgFor, CommonModule } from '@angular/common';


import { MatIconModule } from '@angular/material/icon';
import { ThemeId } from '../../core/theme/theme.model';
import { ThemeService } from '../../core/theme/theme.service';
import { ToastService } from '../../core/ui/toast.service';

@Component({
  selector: 'vs-settings',
  standalone: true,
  imports: [NgFor, CommonModule, MatIconModule],
  template: `
    <div class="vs-page-pad">
      <!-- Header -->
      <div class="vs-page-header">
        <div class="vs-page-title">
          <h1 class="vs-title">My Settings</h1>
          <p class="vs-page-subtitle">Manage your personal profile, security, and preferences</p>
        </div>
      </div>

      <div class="vs-grid-2">
        
        <!-- Preferences Panel -->
        <div class="vs-glass-strong stg-panel">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Appearance</div>
              <div class="vs-panel-subtitle">Customize the look and feel of your workspace</div>
            </div>
            <mat-icon style="color:var(--text-subtle);">palette</mat-icon>
          </div>
          <div class="vs-panel-body">
            <label class="vs-field-label">Color Theme</label>
            <div class="stg-theme-grid" role="list">
              <button
                type="button"
                class="stg-theme-card"
                role="listitem"
                *ngFor="let t of themeOptions"
                [class.stg-theme-card--active]="selectedTheme === t.id"
                (click)="setTheme(t.id)">
                <div class="stg-theme-top">
                  <span class="stg-swatch" [class]="'stg-swatch stg-swatch--' + t.id"></span>
                  <span class="stg-theme-name">{{ t.label }}</span>
                  <span class="stg-rec" *ngIf="t.recommended">Recommended</span>
                </div>
                <div class="stg-theme-desc">{{ t.description }}</div>
              </button>
            </div>

            <div class="stg-preview vs-glass">
              <div style="font-size:12px; font-weight:700; color:var(--text-subtle); margin-bottom:12px; text-transform:uppercase; letter-spacing:1px;">Theme Preview</div>
              <div style="display:flex; gap:12px; flex-wrap:wrap;">
                <button class="vs-btn-primary">Primary Action</button>
                <button class="vs-btn-secondary">Secondary</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Security Panel (Scaffold) -->
        <div class="vs-glass-strong stg-panel">
          <div class="vs-panel-head">
            <div>
              <div class="vs-panel-title">Security & Password</div>
              <div class="vs-panel-subtitle">Keep your account secure</div>
            </div>
            <mat-icon style="color:var(--text-subtle);">lock</mat-icon>
          </div>
          <div class="vs-panel-body">
            <div class="vs-form-row">
              <div>
                <label class="vs-field-label">New Password</label>
                <input class="vs-input" type="password" placeholder="Enter new password">
              </div>
            </div>
            <div class="vs-form-row">
              <div>
                <label class="vs-field-label">Confirm Password</label>
                <input class="vs-input" type="password" placeholder="Confirm new password">
              </div>
            </div>
            <div style="margin-top:16px; display:flex; justify-content:flex-end;">
              <button class="vs-btn-primary" (click)="alertMock()">Update Password</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  `,
  styles: [`
    .stg-panel {
      margin-bottom: 24px;
      border: 1px solid var(--border);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
    }
    .stg-theme-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
      margin-top: 10px;
    }
    .stg-theme-card {
      appearance: none;
      width: 100%;
      min-height: 108px;
      text-align: left;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-surface);
      color: var(--text);
      padding: 14px;
      cursor: pointer;
      transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease, background 150ms ease;
    }
    .stg-theme-card:hover {
      border-color: var(--border-strong);
      background: var(--bg-elevated);
      transform: translateY(-1px);
    }
    .stg-theme-card--active {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-glow);
      background: linear-gradient(135deg, var(--primary-glow), rgba(8,145,178,0.07)), var(--bg-surface);
    }
    .stg-theme-top {
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
    }
    .stg-swatch {
      width: 28px;
      height: 28px;
      flex: 0 0 28px;
      border-radius: 10px;
      border: 1px solid rgba(15,23,42,0.14);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.55);
    }
    .stg-swatch--ocean {
      background: linear-gradient(135deg, #1d4ed8, #0891b2 55%, #f8fafc 56%);
    }
    .stg-swatch--light {
      background: linear-gradient(135deg, #2563eb, #f8fafc 54%, #e2e8f0 55%);
    }
    .stg-swatch--dark {
      background: linear-gradient(135deg, #08111f, #1d4ed8);
      border-color: rgba(148,163,184,0.36);
    }
    .stg-swatch--emerald {
      background: linear-gradient(135deg, #047857, #14b8a6 55%, #ecfdf5 56%);
    }
    .stg-swatch--contrast {
      background: linear-gradient(135deg, #000000, #facc15 52%, #ffffff 53%);
    }
    .stg-theme-name {
      font-size: 14px;
      font-weight: 900;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .stg-rec {
      margin-left: auto;
      flex: 0 0 auto;
      border-radius: 999px;
      padding: 4px 8px;
      background: rgba(8,145,178,0.12);
      color: var(--accent-2);
      border: 1px solid rgba(8,145,178,0.24);
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .stg-theme-desc {
      margin-top: 10px;
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .stg-preview {
      padding: 20px;
      border-radius: var(--radius-md);
      margin-top: 20px;
      border: 1px dashed rgba(148,163,184,0.34);
      background: linear-gradient(135deg, rgba(37,99,235,0.07), rgba(20,184,166,0.06));
    }
  `]
})
export class SettingsComponent {
  private theme = inject(ThemeService);
  private toast = inject(ToastService);

  themeOptions = this.theme.getThemeOptions();
  selectedTheme: ThemeId = 'ocean';

  constructor() {
    this.selectedTheme = this.theme.current();

  }

  onThemeChange(event: any) {
    const themeId = event.target.value as ThemeId;
    this.setTheme(themeId);
  }

  setTheme(themeId: ThemeId) {
    this.selectedTheme = themeId;
    this.theme.apply(themeId);
    // Option Firestore later: save user preference here
  }

  alertMock() {
    this.toast.info('Password update flow would trigger here. (Requires Firebase Reauthentication in production)');
  }
}
