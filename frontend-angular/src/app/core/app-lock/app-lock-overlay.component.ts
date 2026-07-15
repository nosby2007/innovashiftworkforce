import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { getAuth, signOut } from 'firebase/auth';
import { AppLockService } from './app-lock.service';
import { OrgContextService } from '../tenancy/org-context.service';

@Component({
  standalone: true,
  selector: 'app-lock-overlay',
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="al-backdrop" *ngIf="lock.locked()">
      <div class="al-card">
        <mat-icon class="al-icon">fingerprint</mat-icon>
        <h1>InnovaShift Locked</h1>
        <p *ngIf="ctx.displayName() as name">Welcome back, {{ name }}.</p>
        <p class="al-error" *ngIf="error">{{ error }}</p>
        <button class="al-unlock" type="button" (click)="unlock()" [disabled]="busy">
          <mat-icon>fingerprint</mat-icon>
          {{ busy ? 'Verifying…' : 'Unlock' }}
        </button>
        <button class="al-fallback" type="button" (click)="usePasswordInstead()" [disabled]="busy">
          Use password instead
        </button>
      </div>
    </div>
  `,
  styles: [`
    .al-backdrop { position:fixed; inset:0; z-index:5000; background:#07533f; display:flex; align-items:center; justify-content:center; }
    .al-card { width:min(340px, 88vw); text-align:center; color:#fff; display:flex; flex-direction:column; align-items:center; gap:10px; }
    .al-icon { font-size:56px; width:56px; height:56px; opacity:.95; }
    .al-card h1 { margin:0; font-size:20px; font-weight:800; }
    .al-card p { margin:0; color:rgba(255,255,255,.85); font-size:13px; }
    .al-error { color:#fecaca !important; }
    .al-unlock { margin-top:14px; width:100%; height:46px; border-radius:12px; border:0; background:#fff; color:#07533f; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; }
    .al-unlock:disabled { opacity:.7; cursor:not-allowed; }
    .al-fallback { margin-top:4px; background:transparent; border:0; color:rgba(255,255,255,.85); font-size:12px; text-decoration:underline; cursor:pointer; padding:8px; }
    .al-fallback:disabled { opacity:.6; cursor:not-allowed; }
  `],
})
export class AppLockOverlayComponent {
  busy = false;
  error: string | null = null;

  constructor(public lock: AppLockService, public ctx: OrgContextService) {}

  async unlock() {
    const uid = this.ctx.uid();
    if (!uid || this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      const ok = await this.lock.unlock(uid);
      if (ok) {
        this.lock.disarm();
      } else {
        this.error = 'Verification failed or was cancelled. Try again.';
      }
    } finally {
      this.busy = false;
    }
  }

  async usePasswordInstead() {
    this.lock.reset();
    await signOut(getAuth());
  }
}
