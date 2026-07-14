import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

const FEATURES = [
  { icon: '📋', title: 'Shift Marketplace', desc: 'Post open shifts to a live marketplace. Employees browse and claim shifts that fit their availability — no more manual assignment chaos.' },
  { icon: '📅', title: 'Smart Scheduling', desc: 'Drag-and-drop visual scheduler with conflict detection, overtime alerts, and automated notifications sent directly to staff.' },
  { icon: '⏱️', title: 'Attendance & Timesheets', desc: 'GPS-verified clock in/out, automated timesheet generation, time correction requests with manager approval workflow.' },
  { icon: '💬', title: 'Real-time Messaging', desc: 'Built-in in-app messaging with read receipts, push notifications, and threaded conversations to keep your team aligned.' },
  { icon: '📊', title: 'Admin Analytics', desc: 'Live dashboards showing attendance rates, shift coverage, labor cost trends, and compliance reports — export-ready.' },
  { icon: '🏢', title: 'Multi-Tenant SaaS', desc: 'Each organization is fully isolated with its own data space, roles, and configuration. Scale from 10 to 10,000 employees.' },
  { icon: '🔔', title: 'Smart Notifications', desc: 'Configurable push, email and in-app alerts for shift changes, overtime warnings, clock-in reminders and approvals.' },
  { icon: '👥', title: 'Role-Based Access', desc: 'Granular permission system: Super Admin, Org Admin, Scheduler, Manager, HR, and Staff — each with tailored access.' },
  { icon: '🔒', title: 'Enterprise Security', desc: 'Firebase Authentication, JWT-secured APIs, Firestore security rules, and full audit logging on every sensitive action.' },
];

@Component({
  selector: 'app-features',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="feat-page">
      <div class="orb orb-a" aria-hidden="true"></div>
      <div class="orb orb-b" aria-hidden="true"></div>

      <!-- Header -->
      <section class="feat-hero" id="features-hero">
        <div class="feat-hero__inner">
          <div class="label">Everything you need</div>
          <h1 class="feat-hero__h1">Powerful features,<br><span class="grad">built for healthcare</span></h1>
          <p class="feat-hero__sub">From the moment a shift is created to the moment payroll exports — INNOVASHIFT has every step covered.</p>
          <div class="feat-hero__actions">
            <a routerLink="/contact" class="btn-primary" id="feat-cta">Request a Demo →</a>
          </div>
          <div class="feat-hero__img-wrap">
            <div class="feat-hero__img-glow" aria-hidden="true"></div>
            <img src="https://res.cloudinary.com/dtdpx59sc/image/upload/v1778892468/ChatGPT_Image_15_mai_2026_20_43_58_4_1_cqaleo.png" alt="Valid Shift Features Overview" class="feat-hero__img" loading="eager" />
          </div>
        </div>
      </section>

      <!-- Grid -->
      <section class="feat-grid" id="features-grid">
        <div class="feat-grid__inner">
          @for (f of features; track f.title; let i = $index) {
            <div class="feat-card" [id]="'feat-card-' + i">
              <div class="feat-card__icon">{{ f.icon }}</div>
              <h3 class="feat-card__title">{{ f.title }}</h3>
              <p class="feat-card__desc">{{ f.desc }}</p>
            </div>
          }
        </div>
      </section>

      <!-- Bottom CTA -->
      <section class="feat-cta" id="features-bottom-cta">
        <div class="feat-cta__inner">
          <h2 class="feat-cta__h2">Ready to see it in action?</h2>
          <div class="feat-cta__btns">
            <a routerLink="/contact" class="btn-primary" id="feat-bottom-demo">Book a Demo</a>
            <a routerLink="/pricing" class="btn-ghost"   id="feat-bottom-pricing">See Pricing</a>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .feat-page { background: #020617;
      color: #f8fafc; min-height:100vh; position:relative; overflow:hidden; }
    .orb { position:absolute; border-radius:50%; filter:blur(100px); pointer-events:none; z-index:0; }
    .orb-a { width:500px;height:500px; background:rgba(34,211,238,0.15); top:-100px;right:-100px; }
    .orb-b { width:400px;height:400px; background:rgba(129,140,248,0.12); bottom:100px;left:-100px; }
    .btn-primary { display:inline-block; padding:13px 26px; border-radius:11px; text-decoration:none;
      background:linear-gradient(135deg,#22d3ee,#818cf8); color:#fff; font-weight:800; font-size:15px;
      box-shadow:0 4px 20px rgba(34,211,238,0.3); transition:transform 150ms,box-shadow 150ms; }
    .btn-primary:hover { transform:translateY(-2px); box-shadow:0 6px 28px rgba(34,211,238,0.45); }
    .btn-ghost { display:inline-block; padding:13px 26px; border-radius:11px; text-decoration:none;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
      color:#cbd5e1; font-weight:700; font-size:15px; box-shadow:0 1px 2px rgba(0,0,0,0.2); transition:background 150ms; }
    .btn-ghost:hover { background:rgba(255,255,255,0.1); border-color:rgba(255,255,255,0.2); }
    .label { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.12em;
      color:#22d3ee; margin-bottom:12px; }
    .grad { background:linear-gradient(135deg,#22d3ee,#818cf8);
      -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
    /* Hero */
    .feat-hero { position:relative; z-index:1; padding:80px 24px 60px; text-align:center; }
    .feat-hero__inner { max-width:720px; margin:0 auto; }
    .feat-hero__h1 { font-size:clamp(32px,5vw,56px); font-weight:900; letter-spacing:-0.03em;
      line-height:1.08; margin:0 0 18px; color:#f8fafc; }
    .feat-hero__sub { font-size:17px; color:#cbd5e1; margin:0 auto 32px; max-width:580px; line-height:1.7; }
    .feat-hero__actions { margin-bottom: 60px; }
    .feat-hero__img-wrap { max-width: 900px; margin: 0 auto; position: relative; }
    .feat-hero__img-glow {
      position: absolute; inset: -30px; z-index: 0;
      background: radial-gradient(ellipse at center, rgba(34,211,238,0.15) 0%, transparent 60%);
      border-radius: 50%; filter: blur(40px);
    }
    .feat-hero__img {
      position: relative; z-index: 1; width: 100%; border-radius: 20px;
      box-shadow: 0 30px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1);
      transition: transform 400ms ease;
    }
    .feat-hero__img:hover { transform: scale(1.02) translateY(-4px); }
    /* Grid */
    .feat-grid { position:relative; z-index:1; padding:40px 24px 80px; }
    .feat-grid__inner { max-width:1100px; margin:0 auto;
      display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:18px; }
    .feat-card { background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); box-shadow:0 4px 6px -1px rgba(0,0,0,0.3); backdrop-filter:blur(10px);
      border-radius:18px; padding:30px 26px; transition:transform 200ms,border-color 200ms,box-shadow 200ms; }
    .feat-card:hover { transform:translateY(-4px); border-color:rgba(129,140,248,0.4); box-shadow:0 10px 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(129,140,248,0.2) inset; }
    .feat-card__icon { font-size:32px; margin-bottom:16px; }
    .feat-card__title { font-size:16px; font-weight:800; color:#f8fafc; margin:0 0 10px; }
    .feat-card__desc  { font-size:13.5px; color:#94a3b8; line-height:1.65; margin:0; }
    /* Bottom CTA */
    .feat-cta { position:relative; z-index:1; padding:40px 24px 80px; text-align:center; }
    .feat-cta__inner { max-width:600px; margin:0 auto;
      background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); backdrop-filter:blur(20px);
      border-radius:22px; padding:48px 32px; box-shadow:0 10px 30px rgba(0,0,0,0.5), 0 0 40px rgba(34,211,238,0.1) inset; }
    .feat-cta__h2 { font-size:clamp(22px,3.5vw,34px); font-weight:900; letter-spacing:-0.02em;
      margin:0 0 28px; color:#f8fafc; }
    .feat-cta__btns { display:flex; gap:14px; justify-content:center; flex-wrap:wrap; }
  `]
})
export class FeaturesPage {
  features = FEATURES;
}
