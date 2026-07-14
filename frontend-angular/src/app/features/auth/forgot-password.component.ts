import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ToastService } from '../../core/ui/toast.service';

@Component({
  standalone: true,
  selector: 'app-forgot-password',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MatIconModule, MatButtonModule],
  template: `
    <div class="auth-shell">
      <div class="auth-orb auth-orb--a" aria-hidden="true"></div>
      <div class="auth-orb auth-orb--b" aria-hidden="true"></div>
      <div class="auth-card vs-animate-in">
        <a routerLink="/login" class="auth-back-link">
          <mat-icon>arrow_back</mat-icon>
          Back to login
        </a>

        <div class="auth-badge"><mat-icon>lock_reset</mat-icon></div>
        <div class="auth-heading">
          <h1>Reset your password</h1>
          <p>We will send a secure reset link to your email address.</p>
        </div>

        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="auth-field">
            <label for="reset-email">Email address</label>
            <div class="auth-input-wrap">
              <mat-icon>mail_outline</mat-icon>
              <input id="reset-email" type="email" formControlName="email" placeholder="you@example.com" autocomplete="email">
            </div>
          </div>

          <button type="submit" class="auth-btn" [disabled]="loading() || form.invalid">
            <span *ngIf="!loading()">Send reset link</span>
            <span *ngIf="loading()" class="auth-spinner" aria-label="Sending reset link"></span>
          </button>
        </form>

        <div class="auth-links">
          <a routerLink="/register">Create account</a>
          <span>•</span>
          <a routerLink="/">Back to home</a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .auth-shell {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(160deg, #edf4fb 0%, #f8fbff 50%, #edf2f7 100%);
      position: relative;
      overflow: hidden;
      padding: 20px;
    }
    .auth-orb { position: absolute; border-radius: 50%; filter: blur(90px); pointer-events: none; }
    .auth-orb--a { width: 420px; height: 420px; background: rgba(29,78,216,0.12); top: -120px; left: -120px; }
    .auth-orb--b { width: 340px; height: 340px; background: rgba(20,184,166,0.10); bottom: -80px; right: -80px; }
    .auth-card {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 420px;
      background: rgba(255,255,255,0.88);
      border: 1px solid rgba(15,23,42,0.10);
      border-radius: 24px;
      padding: 32px;
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      box-shadow: 0 24px 64px rgba(15,23,42,0.12);
    }
    .auth-back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 18px;
      color: #475569;
      text-decoration: none;
      font-size: 13px;
      font-weight: 700;
    }
    .auth-back-link:hover { color: #1d4ed8; }
    .auth-back-link mat-icon { font-size: 18px !important; width: 18px; height: 18px; }
    .auth-badge {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #1d4ed8, #0f766e);
      color: #fff;
      box-shadow: 0 4px 16px rgba(29,78,216,0.20);
      margin-bottom: 18px;
    }
    .auth-heading h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 900;
      color: rgba(15,23,42,0.96);
      letter-spacing: -0.02em;
    }
    .auth-heading p {
      margin: 6px 0 0;
      color: rgba(71,85,105,0.90);
      font-size: 13px;
      line-height: 1.5;
    }
    .auth-field { margin-top: 22px; }
    .auth-field label {
      display: block;
      margin-bottom: 6px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(71,85,105,0.85);
    }
    .auth-input-wrap { position: relative; display: flex; align-items: center; }
    .auth-input-wrap mat-icon {
      position: absolute;
      left: 13px;
      font-size: 18px !important;
      color: rgba(100,116,139,0.65);
    }
    .auth-input-wrap input {
      width: 100%;
      box-sizing: border-box;
      padding: 11px 14px 11px 42px;
      border-radius: 12px;
      border: 1px solid rgba(148,163,184,0.28);
      background: rgba(255,255,255,0.96);
      color: rgba(15,23,42,0.95);
      font-size: 14px;
      outline: none;
    }
    .auth-input-wrap input:focus {
      border-color: rgba(29,78,216,0.55);
      box-shadow: 0 0 0 3px rgba(29,78,216,0.14);
    }
    .auth-btn {
      width: 100%;
      margin-top: 22px;
      padding: 13px;
      border: none;
      border-radius: 12px;
      background: linear-gradient(135deg, #1d4ed8 0%, #0f766e 100%);
      color: #fff;
      font-size: 15px;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(29,78,216,0.20);
    }
    .auth-btn[disabled] { opacity: 0.6; cursor: not-allowed; }
    .auth-spinner {
      display: inline-block;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.35);
      border-top-color: #fff;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .auth-links {
      margin-top: 16px;
      display: flex;
      justify-content: center;
      gap: 10px;
      color: rgba(100,116,139,0.85);
      font-size: 12px;
      flex-wrap: wrap;
    }
    .auth-links a {
      color: #1d4ed8;
      text-decoration: none;
      font-weight: 700;
    }
    .auth-links a:hover { text-decoration: underline; }
  `]
})
export class ForgotPasswordComponent {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private toast = inject(ToastService);
  loading = signal(false);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  async submit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    try {
      const email = this.form.controls.email.value?.trim();
      await sendPasswordResetEmail(getAuth(), email!);
      this.toast.success('Password reset email sent.');
      await this.router.navigateByUrl('/login');
    } catch (e: any) {
      this.toast.errorFrom(e, e?.message ?? 'Unable to send password reset email.');
    } finally {
      this.loading.set(false);
    }
  }
}
