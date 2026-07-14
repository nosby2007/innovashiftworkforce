import { Component, signal, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="contact-page">
      <div class="orb orb-a" aria-hidden="true"></div>
      <div class="orb orb-b" aria-hidden="true"></div>

      <div class="contact-layout" id="contact-layout">

        <!-- Left info panel -->
        <aside class="contact-info" id="contact-info">
          <div class="label">Get in Touch</div>
          <h1 class="contact-info__h1">Let's get your<br><span class="grad">team shifting</span></h1>
          <p class="contact-info__sub">Fill out the form and our team will reach out within one business day to schedule your personalized demo.</p>

          <div class="contact-info__items">
            <div class="ci-item">
              <div class="ci-icon">📧</div>
              <div>
                <div class="ci-label">Email</div>
                <div class="ci-value">hello&#64;innovashift.com</div>
              </div>
            </div>
            <div class="ci-item">
              <div class="ci-icon">🕐</div>
              <div>
                <div class="ci-label">Response Time</div>
                <div class="ci-value">Within 1 business day</div>
              </div>
            </div>
            <div class="ci-item">
              <div class="ci-icon">🔒</div>
              <div>
                <div class="ci-label">Privacy</div>
                <div class="ci-value">Your data is never shared</div>
              </div>
            </div>
          </div>
        </aside>

        <!-- Form card -->
        <div class="contact-card" id="contact-card">

          @if (!submitted()) {
            <form [formGroup]="form" (ngSubmit)="submit()" id="contact-form" novalidate>
              <div class="contact-card__title">Request a Demo</div>
              <div class="contact-card__sub">Tell us about your organization</div>

              <div class="form-row">
                <div class="form-field" id="field-name">
                  <label class="form-label" for="c-name">Full Name</label>
                  <input id="c-name" class="form-input" formControlName="name" placeholder="Jane Smith" autocomplete="name" [class.err]="touched('name')" />
                </div>
                <div class="form-field" id="field-org">
                  <label class="form-label" for="c-org">Organization</label>
                  <input id="c-org" class="form-input" formControlName="organization" placeholder="City Medical Center" autocomplete="organization" [class.err]="touched('org')" />
                </div>
              </div>

              <div class="form-field" id="field-email">
                <label class="form-label" for="c-email">Work Email</label>
                <input id="c-email" class="form-input" formControlName="email" type="email" autocomplete="email" placeholder="jane@hospital.org" [class.err]="touched('email')" />
              </div>

              <div class="form-field" id="field-size">
                <label class="form-label" for="c-size">Team Size</label>
                <select id="c-size" class="form-input form-select" formControlName="size">
                  <option value="" disabled>Select team size</option>
                  <option value="1-25">1 – 25 employees</option>
                  <option value="26-100">26 – 100 employees</option>
                  <option value="101-500">101 – 500 employees</option>
                  <option value="500+">500+ employees</option>
                </select>
              </div>

              <div class="form-field" id="field-message">
                <label class="form-label" for="c-message">Message <span class="form-opt">(optional)</span></label>
                <textarea id="c-message" class="form-input form-textarea" formControlName="message" placeholder="Tell us about your scheduling challenges..."></textarea>
              </div>

              <div class="hp-field" aria-hidden="true">
                <label for="c-website">Website</label>
                <input id="c-website" type="text" formControlName="website" tabindex="-1" autocomplete="off" />
              </div>

              @if (error()) {
                <div class="form-error" role="alert" aria-live="assertive">⚠️ {{ error() }}</div>
              }

              <button type="submit" id="contact-submit" class="contact-btn" [disabled]="form.invalid || loading()">
                @if (loading()) { <span class="contact-spinner"></span> }
                @else { Send Request → }
              </button>
            </form>
          } @else {
            <div class="contact-success" id="contact-success" role="status" aria-live="polite">
              <div class="contact-success__icon">✅</div>
              <h2 class="contact-success__h2">Request Sent!</h2>
              <p class="contact-success__sub">Thanks! Our team will reach out to <strong>{{ submittedEmail() }}</strong> within one business day.</p>
              <a routerLink="/" class="btn-ghost" id="contact-success-home">← Back to Home</a>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .contact-page { background: #020617;
      color: #f8fafc; min-height:100vh; position:relative; overflow:hidden;
      padding:80px 24px; }
    .orb { position:absolute; border-radius:50%; filter:blur(100px); pointer-events:none; z-index:0; }
    .orb-a { width:500px;height:500px; background:rgba(34,211,238,0.15); top:-100px;left:-100px; }
    .orb-b { width:400px;height:400px; background:rgba(129,140,248,0.12); bottom:0;right:-80px; }
    .btn-ghost { display:inline-block; padding:11px 22px; border-radius:10px; text-decoration:none;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); box-shadow:0 1px 2px rgba(0,0,0,0.2);
      color:#cbd5e1; font-weight:700; font-size:14px; transition:background 150ms; }
    .btn-ghost:hover { background:rgba(255,255,255,0.1); border-color:rgba(255,255,255,0.2); }
    .label { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.12em;
      color:#22d3ee; margin-bottom:12px; }
    .grad { background:linear-gradient(135deg,#22d3ee,#818cf8);
      -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
    /* Layout */
    .contact-layout { position:relative; z-index:1; max-width:1040px; margin:0 auto;
      display:grid; grid-template-columns:1fr 1.4fr; gap:48px; align-items:start; }
    @media(max-width:768px) { .contact-layout { grid-template-columns:1fr; } }
    /* Info */
    .contact-info {}
    .contact-info__h1 { font-size:clamp(28px,4vw,44px); font-weight:900; letter-spacing:-0.03em;
      line-height:1.1; margin:0 0 16px; color:#f8fafc; }
    .contact-info__sub { font-size:15px; color:#94a3b8; line-height:1.7; margin:0 0 40px; }
    .contact-info__items { display:flex; flex-direction:column; gap:22px; }
    .ci-item { display:flex; align-items:flex-start; gap:14px; }
    .ci-icon { font-size:22px; flex-shrink:0; margin-top:2px; }
    .ci-label { font-size:11px; text-transform:uppercase; letter-spacing:0.08em;
      color:#94a3b8; font-weight:700; margin-bottom:3px; }
    .ci-value { font-size:14px; color:#cbd5e1; font-weight:600; }
    /* Card */
    .contact-card { background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px);
      border-radius:22px; padding:36px 32px;
      box-shadow:0 24px 60px rgba(0,0,0,0.5); }
    .contact-card__title { font-size:20px; font-weight:900; color:#f8fafc; margin-bottom:4px; }
    .contact-card__sub { font-size:13px; color:#94a3b8; margin-bottom:28px; }
    /* Form */
    .form-row { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    @media(max-width:520px) { .form-row { grid-template-columns:1fr; } }
    .form-field { margin-bottom:16px; }
    .form-label { display:block; font-size:11.5px; font-weight:700; text-transform:uppercase;
      letter-spacing:0.07em; color:#94a3b8; margin-bottom:6px; }
    .form-opt { text-transform:none; font-weight:400; letter-spacing:0; opacity:0.8; }
    .form-input { width:100%; padding:11px 14px; background:rgba(255,255,255,0.05);
      border:1px solid rgba(255,255,255,0.1); border-radius:11px; color:#f8fafc;
      font-family:'Inter',sans-serif; font-size:14px; outline:none; box-sizing:border-box;
      transition:border-color 150ms,box-shadow 150ms,background 150ms; }
    .form-input:focus { background:rgba(255,255,255,0.08); border-color:#818cf8; box-shadow:0 0 0 3px rgba(129,140,248,0.2); }
    .form-input.err { border-color:rgba(239,68,68,0.5); }
    .form-input::placeholder { color:rgba(255,255,255,0.3); }
    .form-select { appearance:none; cursor:pointer; }
    .form-textarea { resize:vertical; min-height:100px; }
    .form-error { padding:10px 14px; margin-bottom:14px; background:rgba(239,68,68,0.1);
      border:1px solid rgba(239,68,68,0.2); border-radius:10px; color:#fca5a5; font-size:13px; }
    .hp-field { position:absolute; left:-9999px; opacity:0; width:1px; height:1px; overflow:hidden; }
    /* Button */
    .contact-btn { width:100%; padding:14px; border-radius:12px; border:none;
      background:linear-gradient(135deg,#22d3ee,#818cf8); color:#fff;
      font-family:'Inter',sans-serif; font-size:15px; font-weight:800; cursor:pointer;
      box-shadow:0 4px 14px rgba(34,211,238,0.3); transition:transform 150ms,box-shadow 150ms;
      display:flex; align-items:center; justify-content:center; gap:8px; }
    .contact-btn:hover:not([disabled]) { transform:translateY(-1px); box-shadow:0 6px 20px rgba(34,211,238,0.4); }
    .contact-btn[disabled] { opacity:0.5; cursor:not-allowed; }
    .contact-spinner { display:inline-block; width:18px; height:18px;
      border:2px solid rgba(255,255,255,0.30); border-top-color:#fff;
      border-radius:50%; animation:spin 0.7s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    /* Success */
    .contact-success { text-align:center; padding:20px 0; }
    .contact-success__icon { font-size:52px; margin-bottom:16px; }
    .contact-success__h2 { font-size:26px; font-weight:900; margin:0 0 12px; color:#f8fafc; }
    .contact-success__sub { font-size:15px; color:#94a3b8; line-height:1.65; margin:0 0 28px; }
  `]
})
export class ContactPage {
  private fb = inject(FormBuilder);

  loading       = signal(false);
  error         = signal<string | null>(null);
  submitted     = signal(false);
  submittedEmail = signal('');

  form = this.fb.group({
    name:         ['', [Validators.required, Validators.minLength(2)]],
    organization: ['', [Validators.required]],
    email:        ['', [Validators.required, Validators.email]],
    size:         ['', [Validators.required]],
    message:      [''],
    website:      [''],
  });

  touched(field: string) {
    const c = this.form.get(field === 'org' ? 'organization' : field);
    return c?.invalid && c?.touched;
  }

  async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.error.set(null);
    this.loading.set(true);
    try {
      const body = this.form.getRawValue();
      await this.postWithRetry('/v1/contact', body);
      this.submittedEmail.set(body.email ?? '');
      this.submitted.set(true);
    } catch (e: any) {
      this.error.set(e?.message || 'Could not send your request. Please try again or email us directly.');
    } finally {
      this.loading.set(false);
    }
  }

  private async postWithRetry(url: string, payload: Record<string, unknown>) {
    let lastErr: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        return data;
      } catch (e) {
        lastErr = e;
        if (attempt === 0) continue;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr || new Error('Network error');
  }
}
