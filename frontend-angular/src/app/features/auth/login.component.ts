import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';

function normalizePlatformRole(role: unknown): string | undefined {
  const value = String(role ?? '').trim();
  if (!value) return undefined;
  if (value === 'super_admin' || value === 'super-admin' || value === 'superAdmin') return 'superAdmin';
  return value;
}

function normalizeAccessRole(role: unknown): string | undefined {
  const value = String(role ?? '').trim();
  if (!value) return undefined;
  if (value === 'super_admin' || value === 'super-admin') return 'admin';
  return value;
}

function isAdminLikeRole(role: unknown): boolean {
  return ['admin', 'scheduler', 'manager', 'hr'].includes(String(role ?? '').trim());
}

@Component({
  standalone: true,
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MatIconModule, MatButtonModule],
  template: `
    <div class="login-shell">
      <!-- Background gradient orbs -->
      <div class="login-orb login-orb--a" aria-hidden="true"></div>
      <div class="login-orb login-orb--b" aria-hidden="true"></div>
      <div class="login-orb login-orb--c" aria-hidden="true"></div>

      <div class="login-card vs-animate-in">
        <a routerLink="/" class="login-home-link">
          <mat-icon>arrow_back</mat-icon>
          Back to home
        </a>

        <!-- Logo -->
        <div class="login-brand">
          <div class="login-logo">IS</div>
          <div class="login-brand-text">
            <div class="login-brand-name">INNOVASHIFT</div>
            <div class="login-brand-tag">Workforce Management Platform</div>
          </div>
        </div>

        <div class="login-divider"></div>

        <div class="login-heading">
          <h1 class="login-title">Welcome back</h1>
          <p class="login-sub">Sign in to your organization workspace</p>
        </div>

        <form [formGroup]="form" (ngSubmit)="submit()" id="login-form" novalidate>

          <!-- Email -->
          <div class="login-field">
            <label class="login-label" for="login-email">Email address</label>
            <div class="login-input-wrap">
              <mat-icon class="login-input-icon">mail_outline</mat-icon>
              <input
                id="login-email"
                class="login-input"
                type="email"
                formControlName="email"
                placeholder="you@example.com"
                autocomplete="email"
                inputmode="email">
            </div>
          </div>

          <!-- Password -->
          <div class="login-field">
            <label class="login-label" for="login-password">
              Password
              <button type="button" class="login-forgot" (click)="forgotPassword()">Forgot?</button>
            </label>
            <div class="login-input-wrap">
              <mat-icon class="login-input-icon">lock_outline</mat-icon>
              <input
                id="login-password"
                class="login-input"
                [type]="showPass() ? 'text' : 'password'"
                formControlName="password"
                placeholder="••••••••"
                autocomplete="current-password">
              <button type="button" class="login-eye" (click)="togglePass()" [attr.aria-label]="showPass() ? 'Hide password' : 'Show password'">
                <mat-icon>{{ showPass() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
            </div>
          </div>

          <!-- Submit -->
          <button
            type="submit"
            id="login-submit"
            class="login-btn"
            [disabled]="form.invalid || loading()">
            <span *ngIf="!loading()">Sign in</span>
            <span *ngIf="loading()" class="login-spinner" aria-label="Signing in"></span>
          </button>
        </form>

        <div class="login-footer">
          <span class="login-footer-text">Powered by</span>
          <span class="login-footer-brand">INNOVASHIFT SaaS</span>
          <span class="login-footer-sep">•</span>
          <span class="login-footer-text">v2.0</span>
        </div>

        <div class="login-links">
          <a routerLink="/register">Create account</a>
          <span>•</span>
          <a routerLink="/forgot-password">Forgot password?</a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .login-shell {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(160deg, #edf4fb 0%, #f8fbff 50%, #edf2f7 100%);
      position: relative;
      overflow: hidden;
      padding: 20px;
    }

    /* Ambient orbs */
    .login-orb {
      position: absolute;
      border-radius: 50%;
      filter: blur(90px);
      pointer-events: none;
    }
    .login-orb--a {
      width: 500px; height: 500px;
      background: rgba(29,78,216,0.12);
      top: -120px; left: -120px;
    }
    .login-orb--b {
      width: 400px; height: 400px;
      background: rgba(20,184,166,0.10);
      bottom: -80px; right: -80px;
    }
    .login-orb--c {
      width: 280px; height: 280px;
      background: rgba(14,165,233,0.10);
      top: 40%; left: 55%;
    }

    /* Card */
    .login-card {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 420px;
      background: rgba(255,255,255,0.88);
      border: 1px solid rgba(15,23,42,0.10);
      border-radius: 24px;
      padding: 36px 32px 28px;
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      box-shadow: 0 24px 64px rgba(15,23,42,0.12), 0 0 0 1px rgba(255,255,255,0.56) inset;
    }

    .login-home-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 18px;
      text-decoration: none;
      color: #475569;
      font-size: 13px;
      font-weight: 700;
    }
    .login-home-link:hover { color: #1d4ed8; }
    .login-home-link mat-icon { font-size: 18px !important; width: 18px; height: 18px; }

    /* Brand */
    .login-brand {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 24px;
    }
    .login-logo {
      width: 44px; height: 44px;
      border-radius: 14px;
      background: linear-gradient(135deg, #1d4ed8, #0f766e);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; font-weight: 900; color: #fff;
      letter-spacing: 0.05em;
      box-shadow: 0 4px 16px rgba(29,78,216,0.22);
      flex-shrink: 0;
    }
    .login-brand-name {
      font-size: 18px; font-weight: 900; letter-spacing: -0.02em;
      color: rgba(15,23,42,0.96);
    }
    .login-brand-tag {
      font-size: 11px; color: rgba(148,163,184,0.80);
      margin-top: 2px;
    }

    .login-divider {
      height: 1px;
      background: rgba(15,23,42,0.08);
      margin-bottom: 24px;
    }

    .login-heading { margin-bottom: 24px; }
    .login-title {
      margin: 0;
      font-size: 22px; font-weight: 900; letter-spacing: -0.02em;
      color: rgba(15,23,42,0.96);
    }
    .login-sub {
      margin: 4px 0 0;
      font-size: 13px; color: rgba(148,163,184,0.88);
    }

    /* Fields */
    .login-field { margin-bottom: 16px; }
    .login-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: rgba(71,85,105,0.85);
      margin-bottom: 6px;
    }
    .login-forgot {
      background: none; border: none; cursor: pointer;
      font-size: 11px; color: rgba(165,180,252,0.80);
      font-family: inherit; padding: 0;
      transition: color 150ms ease;
    }
    .login-forgot:hover { color: rgba(165,180,252,1); }

    .login-input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }
    .login-input-icon {
      position: absolute;
      left: 13px;
      font-size: 18px !important;
      color: rgba(100,116,139,0.65);
      pointer-events: none;
    }
    .login-input {
      width: 100%;
      padding: 11px 14px 11px 42px;
      background: rgba(255,255,255,0.96);
      border: 1px solid rgba(148,163,184,0.28);
      border-radius: 12px;
      color: rgba(15,23,42,0.95);
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      outline: none;
      transition: border-color 150ms ease, box-shadow 150ms ease;
      box-sizing: border-box;
    }
    .login-input:focus {
      border-color: rgba(29,78,216,0.55);
      box-shadow: 0 0 0 3px rgba(29,78,216,0.14);
    }
    .login-input::placeholder { color: rgba(100,116,139,0.70); }

    .login-eye {
      position: absolute;
      right: 10px;
      background: none; border: none; cursor: pointer;
      color: rgba(100,116,139,0.65);
      display: flex; align-items: center;
      padding: 4px;
      border-radius: 6px;
      transition: color 150ms ease;
    }
    .login-eye:hover { color: rgba(71,85,105,0.95); }
    .login-eye mat-icon { font-size: 18px !important; }

    /* Error */
    .login-error {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      margin-bottom: 14px;
      background: rgba(239,68,68,0.12);
      border: 1px solid rgba(239,68,68,0.25);
      border-radius: 10px;
      color: #fca5a5;
      font-size: 13px;
    }
    .login-error mat-icon { font-size: 16px !important; flex-shrink: 0; }

    /* Submit */
    .login-btn {
      width: 100%;
      padding: 13px;
      border-radius: 12px;
      border: none;
      background: linear-gradient(135deg, #1d4ed8 0%, #0f766e 100%);
      color: #fff;
      font-family: 'Inter', sans-serif;
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0.01em;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(29,78,216,0.20);
      transition: transform 150ms ease, box-shadow 150ms ease;
      margin-top: 4px;
      position: relative;
    }
    .login-btn:hover:not([disabled]) {
      transform: translateY(-1px);
      box-shadow: 0 6px 22px rgba(29,78,216,0.28);
    }
    .login-btn:active:not([disabled]) { transform: translateY(0); }
    .login-btn[disabled] { opacity: 0.5; cursor: not-allowed; }

    /* Spinner */
    .login-spinner {
      display: inline-block;
      width: 18px; height: 18px;
      border: 2px solid rgba(255,255,255,0.30);
      border-top-color: #fff;
      border-radius: 50%;
      animation: loginSpin 0.7s linear infinite;
      vertical-align: middle;
    }
    @keyframes loginSpin { to { transform: rotate(360deg); } }

    /* Footer */
    .login-footer {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 24px;
      font-size: 11px;
      color: rgba(100,116,139,0.82);
    }
    .login-footer-brand { font-weight: 700; color: rgba(71,85,105,0.78); }
    .login-footer-sep { opacity: 0.4; }

    .login-links {
      margin-top: 12px;
      display: flex;
      justify-content: center;
      gap: 10px;
      font-size: 12px;
      color: rgba(100,116,139,0.85);
      flex-wrap: wrap;
    }
    .login-links a {
      color: #1d4ed8;
      text-decoration: none;
      font-weight: 700;
    }
    .login-links a:hover { text-decoration: underline; }
  `]
})
export class LoginComponent {
  private fb     = inject(FormBuilder);
  private router = inject(Router);
  private auth   = inject(AuthService);
  private toast  = inject(ToastService);

  loading  = signal(false);
  showPass = signal(false);
  resetting = signal(false);

  form = this.fb.group({
    email:    ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  togglePass() { this.showPass.update(v => !v); }

  async forgotPassword() {
    await this.router.navigateByUrl('/forgot-password');
  }

  async submit() {
    this.loading.set(true);
    try {
      const auth = getAuth();
      const { email, password } = this.form.getRawValue();
      await signInWithEmailAndPassword(auth, email!, password!);
      // Force-refresh token so session bootstrap picks up fresh claims
      const token = await auth.currentUser?.getIdTokenResult(true);
      const tokenPlatformRole = normalizePlatformRole(token?.claims?.['platformRole']);
      const tokenAccessRole = normalizeAccessRole(token?.claims?.['accessRole']);
      const tokenOrgId = String(token?.claims?.['orgId'] || '').trim();
      const fallback = await this.auth.resolveOrgContext(auth.currentUser?.uid ?? '');
      const platformRole = tokenPlatformRole ?? normalizePlatformRole(fallback.platformRole);
      const accessRole = tokenAccessRole ?? normalizeAccessRole(fallback.accessRole);
      const orgId = tokenOrgId || fallback.orgId;
      const target = platformRole === 'superAdmin'
        ? '/platform'
        : orgId && isAdminLikeRole(accessRole)
          ? '/admin'
          : '/app/dashboard';
      await this.router.navigateByUrl(target);
    } catch (e: any) {
      const msg = e?.code === 'auth/invalid-credential' || e?.code === 'auth/wrong-password'
        ? 'Invalid email or password.'
        : e?.code === 'auth/too-many-requests'
        ? 'Too many attempts. Please try again later.'
        : e?.message ?? 'Sign in failed.';
      this.toast.errorFrom(e, msg);
    } finally {
      this.loading.set(false);
    }
  }
}
