import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { createUserWithEmailAndPassword, getAuth, updateProfile } from 'firebase/auth';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ToastService } from '../../core/ui/toast.service';

@Component({
  standalone: true,
  selector: 'app-register',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MatIconModule, MatButtonModule],
  template: `
    <div class="auth-shell">
      <div class="auth-orb auth-orb--a" aria-hidden="true"></div>
      <div class="auth-orb auth-orb--b" aria-hidden="true"></div>
      <div class="auth-card vs-animate-in">
        <a routerLink="/" class="auth-back-link">
          <mat-icon>arrow_back</mat-icon>
          Back to home
        </a>

        <div class="auth-badge"><mat-icon>person_add</mat-icon></div>
        <div class="auth-heading">
          <h1>Create your account</h1>
          <p>Set up your login to join the workspace. Your organization access can be assigned after sign-up.</p>
        </div>

        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="auth-field">
            <label for="register-name">Full name</label>
            <div class="auth-input-wrap">
              <mat-icon>badge</mat-icon>
              <input id="register-name" type="text" formControlName="name" placeholder="Jane Doe" autocomplete="name">
            </div>
          </div>

          <div class="auth-field">
            <label for="register-email">Email address</label>
            <div class="auth-input-wrap">
              <mat-icon>mail_outline</mat-icon>
              <input id="register-email" type="email" formControlName="email" placeholder="you@example.com" autocomplete="email">
            </div>
          </div>

          <div class="auth-field">
            <label for="register-password">Password</label>
            <div class="auth-input-wrap">
              <mat-icon>lock_outline</mat-icon>
              <input id="register-password" [type]="showPass() ? 'text' : 'password'" formControlName="password" placeholder="At least 6 characters" autocomplete="new-password">
              <button type="button" class="auth-eye" (click)="togglePass()" [attr.aria-label]="showPass() ? 'Hide password' : 'Show password'">
                <mat-icon>{{ showPass() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
            </div>
          </div>

          <div class="auth-field">
            <label for="register-confirm">Confirm password</label>
            <div class="auth-input-wrap">
              <mat-icon>verified_user</mat-icon>
              <input id="register-confirm" [type]="showPass() ? 'text' : 'password'" formControlName="confirmPassword" placeholder="Repeat password" autocomplete="new-password">
            </div>
          </div>

          <div class="auth-note">
            <mat-icon>info</mat-icon>
            <span>Use your work email if your organization already invited you.</span>
          </div>

          <button type="submit" class="auth-btn" [disabled]="loading() || form.invalid">
            <span *ngIf="!loading()">Create account</span>
            <span *ngIf="loading()" class="auth-spinner" aria-label="Creating account"></span>
          </button>
        </form>

        <div class="auth-links">
          <a routerLink="/login">Already have an account?</a>
          <span>•</span>
          <a routerLink="/forgot-password">Forgot password?</a>
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
      max-width: 440px;
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
    .auth-field { margin-top: 18px; }
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
    .auth-eye {
      position: absolute;
      right: 10px;
      border: none;
      background: transparent;
      color: rgba(100,116,139,0.72);
      cursor: pointer;
      display: flex;
      align-items: center;
      padding: 4px;
    }
    .auth-eye:hover { color: rgba(71,85,105,0.95); }
    .auth-eye mat-icon { font-size: 18px !important; width: 18px; height: 18px; }
    .auth-note {
      margin-top: 16px;
      display: flex;
      gap: 8px;
      align-items: flex-start;
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(29,78,216,0.06);
      border: 1px solid rgba(29,78,216,0.10);
      color: rgba(71,85,105,0.92);
      font-size: 13px;
      line-height: 1.5;
    }
    .auth-note mat-icon { font-size: 18px !important; width: 18px; height: 18px; color: #1d4ed8; flex-shrink: 0; }
    .auth-btn {
      width: 100%;
      margin-top: 20px;
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
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private toast = inject(ToastService);
  loading = signal(false);
  showPass = signal(false);

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    confirmPassword: ['', [Validators.required]],
  }, { validators: [(group) => {
    const password = group.get('password')?.value;
    const confirm = group.get('confirmPassword')?.value;
    return password && confirm && password !== confirm ? { passwordMismatch: true } : null;
  }] });

  togglePass() {
    this.showPass.update((value) => !value);
  }

  async submit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    try {
      const { name, email, password } = this.form.getRawValue();
      const auth = getAuth();
      const credential = await createUserWithEmailAndPassword(auth, email!, password!);
      await updateProfile(credential.user, { displayName: name?.trim() || null });
      this.toast.success('Account created. You can now sign in.');
      await this.router.navigateByUrl('/login');
    } catch (e: any) {
      this.toast.errorFrom(e, e?.message ?? 'Unable to create account.');
    } finally {
      this.loading.set(false);
    }
  }
}
