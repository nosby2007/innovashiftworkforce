import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { combineLatest } from 'rxjs';
import { SeoService } from '../../../core/seo/seo.service';

// Cloudinary image assets
const IMG = {
  hero:        'https://res.cloudinary.com/dtdpx59sc/image/upload/v1778890633/innovashift/ChatGPT_Image_15_mai_2026_20_13_13_10_pkzgj0.png',
  shifts:      'https://res.cloudinary.com/dtdpx59sc/image/upload/v1778890634/innovashift/ChatGPT_Image_15_mai_2026_20_13_12_6_k5yay4.png',
  timesheets:  'https://res.cloudinary.com/dtdpx59sc/image/upload/v1778890634/innovashift/ChatGPT_Image_15_mai_2026_20_13_11_4_ssm16o.png',
  multisite:   'https://res.cloudinary.com/dtdpx59sc/image/upload/v1778890635/innovashift/ChatGPT_Image_15_mai_2026_20_13_13_9_b8f4et.png',
  leave:       'https://res.cloudinary.com/dtdpx59sc/image/upload/v1778890632/innovashift/ChatGPT_Image_15_mai_2026_20_13_12_5_wtgxud.png',
};

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink, TranslocoModule],
  template: `
    <div class="land">

      <!-- ── HERO ─────────────────────────────────────────────────────── -->
      <section class="hero" id="hero">
        <div class="hero__bg-mesh" aria-hidden="true"></div>
        <div class="hero__particles" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span>
        </div>

        <div class="hero__inner">
          <!-- Left copy -->
          <div class="hero__copy">
            <div class="hero__badge">{{ 'landing.heroBadge' | transloco }}</div>
            <h1 class="hero__h1">
              {{ 'landing.heroH1Line1' | transloco }}<br>
              <span class="grad">{{ 'landing.heroH1Grad' | transloco }}</span>
            </h1>
            <p class="hero__sub">
              {{ 'landing.heroSub' | transloco }}
            </p>
            <div class="hero__actions">
              <a routerLink="contact" class="btn-primary" id="hero-get-started">{{ 'landing.startFreeTrial' | transloco }}</a>
              <a routerLink="features" class="btn-ghost"  id="hero-features">{{ 'landing.seeFeatures' | transloco }}</a>
            </div>
            <div class="hero__trust">
              <div class="hero__trust-item"><span class="hero__trust-num">10k+</span><span class="hero__trust-lbl">{{ 'landing.trustShifts' | transloco }}</span></div>
              <div class="hero__trust-div"></div>
              <div class="hero__trust-item"><span class="hero__trust-num">98%</span><span class="hero__trust-lbl">{{ 'landing.trustOnTime' | transloco }}</span></div>
              <div class="hero__trust-div"></div>
              <div class="hero__trust-item"><span class="hero__trust-num">99.9%</span><span class="hero__trust-lbl">{{ 'landing.trustUptime' | transloco }}</span></div>
            </div>
          </div>

          <!-- Right hero image -->
          <div class="hero__img-wrap" id="hero-image">
            <div class="hero__img-glow" aria-hidden="true"></div>
            <img [src]="img.hero" alt="INNOVASHIFT all-in-one workforce platform" class="hero__img" loading="eager" />
          </div>
        </div>
      </section>

      <!-- ── FEATURE SECTIONS ────────────────────────────────────────── -->

      <!-- Shifts & Swaps -->
      <section class="feat-row" id="feat-shifts">
        <div class="feat-row__inner">
          <div class="feat-row__img-wrap">
            <div class="feat-row__img-badge">{{ 'landing.shiftsBadge' | transloco }}</div>
            <img [src]="img.shifts" alt="Open shifts and swap requests" class="feat-row__img" loading="lazy" />
          </div>
          <div class="feat-row__copy">
            <div class="section-label">{{ 'landing.shiftsLabel' | transloco }}</div>
            <h2 class="section-h2">{{ 'landing.shiftsH2' | transloco }}</h2>
            <p class="section-body">
              {{ 'landing.shiftsBody' | transloco }}
            </p>
            <ul class="feat-list">
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.shiftsFeat1' | transloco }}</li>
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.shiftsFeat2' | transloco }}</li>
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.shiftsFeat3' | transloco }}</li>
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.shiftsFeat4' | transloco }}</li>
            </ul>
            <a routerLink="features" class="feat-row__link" id="shifts-learn-more">{{ 'landing.learnMore' | transloco }}</a>
          </div>
        </div>
      </section>

      <!-- Timesheets -->
      <section class="feat-row feat-row--rev" id="feat-timesheets">
        <div class="feat-row__inner">
          <div class="feat-row__img-wrap">
            <div class="feat-row__img-badge">{{ 'landing.timesheetsBadge' | transloco }}</div>
            <img [src]="img.timesheets" alt="Timesheets and reports" class="feat-row__img" loading="lazy" />
          </div>
          <div class="feat-row__copy">
            <div class="section-label">{{ 'landing.timesheetsLabel' | transloco }}</div>
            <h2 class="section-h2">{{ 'landing.timesheetsH2' | transloco }}</h2>
            <p class="section-body">
              {{ 'landing.timesheetsBody' | transloco }}
            </p>
            <ul class="feat-list">
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.timesheetsFeat1' | transloco }}</li>
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.timesheetsFeat2' | transloco }}</li>
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.timesheetsFeat3' | transloco }}</li>
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.timesheetsFeat4' | transloco }}</li>
            </ul>
            <a routerLink="features" class="feat-row__link" id="timesheets-learn-more">{{ 'landing.learnMore' | transloco }}</a>
          </div>
        </div>
      </section>

      <!-- Multi-site -->
      <section class="feat-row" id="feat-multisite">
        <div class="feat-row__inner">
          <div class="feat-row__img-wrap">
            <div class="feat-row__img-badge">{{ 'landing.multisiteBadge' | transloco }}</div>
            <img [src]="img.multisite" alt="Multi-location workforce control" class="feat-row__img" loading="lazy" />
          </div>
          <div class="feat-row__copy">
            <div class="section-label">{{ 'landing.multisiteLabel' | transloco }}</div>
            <h2 class="section-h2">{{ 'landing.multisiteH2' | transloco }}</h2>
            <p class="section-body">
              {{ 'landing.multisiteBody' | transloco }}
            </p>
            <ul class="feat-list">
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.multisiteFeat1' | transloco }}</li>
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.multisiteFeat2' | transloco }}</li>
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.multisiteFeat3' | transloco }}</li>
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.multisiteFeat4' | transloco }}</li>
            </ul>
            <a routerLink="features" class="feat-row__link" id="multisite-learn-more">{{ 'landing.learnMore' | transloco }}</a>
          </div>
        </div>
      </section>

      <!-- Leave Management -->
      <section class="feat-row feat-row--rev" id="feat-leave">
        <div class="feat-row__inner">
          <div class="feat-row__img-wrap">
            <div class="feat-row__img-badge">{{ 'landing.leaveBadge' | transloco }}</div>
            <img [src]="img.leave" alt="Leave requests and approvals" class="feat-row__img" loading="lazy" />
          </div>
          <div class="feat-row__copy">
            <div class="section-label">{{ 'landing.leaveLabel' | transloco }}</div>
            <h2 class="section-h2">{{ 'landing.leaveH2' | transloco }}</h2>
            <p class="section-body">
              {{ 'landing.leaveBody' | transloco }}
            </p>
            <ul class="feat-list">
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.leaveFeat1' | transloco }}</li>
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.leaveFeat2' | transloco }}</li>
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.leaveFeat3' | transloco }}</li>
              <li class="feat-list__item"><span class="feat-list__dot"></span>{{ 'landing.leaveFeat4' | transloco }}</li>
            </ul>
            <a routerLink="features" class="feat-row__link" id="leave-learn-more">{{ 'landing.learnMore' | transloco }}</a>
          </div>
        </div>
      </section>

      <!-- ── QUICK STATS ──────────────────────────────────────────────── -->
      <section class="stats-band" id="stats">
        <div class="stats-band__inner">
          <div class="stats-band__item"><span class="stats-num">150+</span><span class="stats-lbl">{{ 'landing.statsOrgs' | transloco }}</span></div>
          <div class="stats-band__div"></div>
          <div class="stats-band__item"><span class="stats-num">10k+</span><span class="stats-lbl">{{ 'landing.statsShifts' | transloco }}</span></div>
          <div class="stats-band__div"></div>
          <div class="stats-band__item"><span class="stats-num">98%</span><span class="stats-lbl">{{ 'landing.statsOnTime' | transloco }}</span></div>
          <div class="stats-band__div"></div>
          <div class="stats-band__item"><span class="stats-num">5 min</span><span class="stats-lbl">{{ 'landing.statsOnboarding' | transloco }}</span></div>
          <div class="stats-band__div"></div>
          <div class="stats-band__item"><span class="stats-num">99.9%</span><span class="stats-lbl">{{ 'landing.statsUptime' | transloco }}</span></div>
        </div>
      </section>

      <!-- ── CTA ─────────────────────────────────────────────────────── -->
      <section class="cta-band" id="cta">
        <div class="cta-band__inner">
          <div class="cta-band__glow" aria-hidden="true"></div>
          <h2 class="cta-band__h2">{{ 'landing.ctaH2' | transloco }}</h2>
          <p class="cta-band__sub">{{ 'landing.ctaSub' | transloco }}</p>
          <div class="cta-band__btns">
            <a routerLink="contact" class="btn-primary" id="cta-demo">{{ 'landing.ctaRequestDemo' | transloco }}</a>
            <a routerLink="pricing" class="btn-ghost"   id="cta-pricing">{{ 'landing.ctaViewPricing' | transloco }}</a>
          </div>
        </div>
      </section>

    </div>
  `,
  styles: [`
    /* ── Design System ──────────────────────────────────────────────────── */
    :host {
      --bg:     #f8fbff;
      --bg2:    #eef4fb;
      --bg3:    #ffffff;
      --teal:   #1d4ed8;
      --teal2:  #0f766e;
      --ind:    #2563eb;
      --rose:   #f43f5e;
      --tx:     #0f172a;
      --tx2:    #334155;
      --muted:  #64748b;
      --dim:    #94a3b8;
      --bdr:    rgba(15,23,42,0.10);
      --card-bg: rgba(255,255,255,0.92);
    }

    .land { background: linear-gradient(180deg, #f8fbff 0%, #eef4fb 100%); color: var(--tx); overflow: hidden; }

    /* Shared */
    .btn-primary {
      display: inline-block; padding: 14px 28px; border-radius: 12px;
      text-decoration: none; font-weight: 800; font-size: 15px;
      background: linear-gradient(135deg, var(--teal) 0%, var(--ind) 100%);
      color: #fff; box-shadow: 0 4px 20px rgba(34,211,238,0.3);
      transition: transform 160ms, box-shadow 160ms;
    }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 6px 28px rgba(34,211,238,0.45); }
    .btn-ghost {
      display: inline-block; padding: 14px 28px; border-radius: 12px;
      text-decoration: none; font-weight: 700; font-size: 15px;
      background: rgba(255,255,255,0.9); border: 1px solid var(--bdr);
      color: var(--tx2); box-shadow: 0 1px 2px rgba(15,23,42,0.06);
      transition: background 150ms, border-color 150ms;
    }
    .btn-ghost:hover { background: #fff; border-color: rgba(15,23,42,0.18); }

    .section-label {
      font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.14em;
      color: var(--teal); margin-bottom: 12px;
    }
    .section-h2 {
      font-size: clamp(26px,4vw,42px); font-weight: 900; letter-spacing: -0.025em;
      line-height: 1.1; margin: 0 0 16px; color: var(--tx);
    }
    .section-body {
      font-size: 16px; color: var(--muted); line-height: 1.75; margin: 0 0 24px;
    }
    .grad {
      background: linear-gradient(135deg, #06b6d4, #4f46e5);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }

    /* ── Hero ─────────────────────────────────────────────────────────── */
    .hero {
      position: relative; overflow: hidden;
      padding: 100px 24px 80px;
      background: radial-gradient(ellipse 80% 60% at 50% -10%, rgba(37,99,235,0.08) 0%, transparent 70%),
                  linear-gradient(180deg, #f8fbff 0%, #eef4fb 100%);
    }
    .hero__bg-mesh {
      position: absolute; inset: 0; z-index: 0;
      background-image:
        radial-gradient(circle at 20% 30%, rgba(79,70,229,0.05) 0%, transparent 50%),
        radial-gradient(circle at 80% 70%, rgba(6,182,212,0.05) 0%, transparent 50%),
        radial-gradient(circle at 50% 100%, rgba(225,29,72,0.03) 0%, transparent 50%);
    }
    .hero__particles {
      position: absolute; inset: 0; z-index: 0; pointer-events: none;
    }
    .hero__particles span {
      position: absolute; width: 2px; height: 2px; border-radius: 50%;
      background: rgba(6,182,212,0.6); animation: float 6s ease-in-out infinite;
    }
    .hero__particles span:nth-child(1) { top: 15%; left: 10%; animation-delay: 0s; }
    .hero__particles span:nth-child(2) { top: 60%; left: 25%; animation-delay: 1s; width: 3px; height: 3px; }
    .hero__particles span:nth-child(3) { top: 30%; right: 15%; animation-delay: 2s; background: rgba(99,102,241,0.7); }
    .hero__particles span:nth-child(4) { top: 75%; right: 30%; animation-delay: 3s; }
    .hero__particles span:nth-child(5) { top: 50%; left: 50%; animation-delay: 4s; background: rgba(244,63,94,0.6); }
    @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }

    .hero__inner {
      position: relative; z-index: 1;
      max-width: 1200px; margin: 0 auto;
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 60px; align-items: center;
    }
    @media(max-width: 900px) { .hero__inner { grid-template-columns: 1fr; } }

    .hero__badge {
      display: inline-block; padding: 6px 16px; border-radius: 100px;
      background: #ffffff; border: 1px solid var(--bdr);
      font-size: 13px; font-weight: 700; color: var(--ind); margin-bottom: 24px;
    }
    .hero__h1 {
      font-size: clamp(36px, 5.5vw, 64px); font-weight: 900; letter-spacing: -0.03em;
      line-height: 1.06; margin: 0 0 20px; color: var(--tx);
    }
    .hero__sub {
      font-size: 17px; color: var(--muted); line-height: 1.75; margin: 0 0 36px; max-width: 520px;
    }
    .hero__actions { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 48px; }
    .hero__trust {
      display: flex; align-items: center; gap: 0; flex-wrap: wrap;
      background: #ffffff; border: 1px solid var(--bdr);
      border-radius: 14px; padding: 16px 24px; box-shadow: 0 12px 28px rgba(15,23,42,0.08);
    }
    .hero__trust-item { text-align: center; padding: 0 20px; }
    .hero__trust-num {
      display: block; font-size: 22px; font-weight: 900;
      background: linear-gradient(135deg, #06b6d4, #4f46e5);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    .hero__trust-lbl { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.06em; }
    .hero__trust-div { width: 1px; height: 36px; background: var(--bdr); }

    .hero__img-wrap {
      position: relative;
    }
    .hero__img-glow {
      position: absolute; inset: -40px; z-index: 0;
      background: radial-gradient(ellipse at center, rgba(34,211,238,0.2) 0%, transparent 70%);
      border-radius: 50%; filter: blur(40px);
    }
    .hero__img {
      position: relative; z-index: 1; width: 100%; border-radius: 20px;
      box-shadow: 0 30px 60px rgba(15,23,42,0.18), 0 0 0 1px rgba(255,255,255,0.1);
      transition: transform 400ms ease;
    }
    .hero__img:hover { transform: scale(1.02) translateY(-4px); }

    /* ── Feature rows ─────────────────────────────────────────────────── */
    .feat-row {
      padding: 80px 24px;
      background: linear-gradient(180deg, #f8fbff 0%, #eef4fb 50%, #f8fbff 100%);
      border-top: 1px solid var(--bdr);
    }
    .feat-row--rev .feat-row__inner { direction: rtl; }
    .feat-row--rev .feat-row__copy { direction: ltr; }
    .feat-row--rev .feat-row__img-wrap { direction: ltr; }

    .feat-row__inner {
      max-width: 1100px; margin: 0 auto;
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 60px; align-items: center;
    }
    @media(max-width: 860px) {
      .feat-row__inner { grid-template-columns: 1fr; direction: ltr; }
      .feat-row--rev .feat-row__inner { direction: ltr; }
    }

    .feat-row__img-wrap { position: relative; }
    .feat-row__img-badge {
      position: absolute; top: -14px; left: 20px; z-index: 2;
      padding: 6px 14px; border-radius: 100px;
      background: linear-gradient(135deg, var(--teal), var(--ind));
      font-size: 12px; font-weight: 800; color: #fff;
      box-shadow: 0 4px 16px rgba(34,211,238,0.4);
    }
    .feat-row__img {
      width: 100%; border-radius: 18px;
      box-shadow: 0 30px 60px rgba(15,23,42,0.16), 0 0 0 1px rgba(255,255,255,0.2);
      transition: transform 350ms ease, box-shadow 350ms ease;
    }
    .feat-row__img:hover { transform: translateY(-6px); box-shadow: 0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(34,211,238,0.3); }

    .feat-list { list-style: none; margin: 0 0 28px; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .feat-list__item {
      display: flex; align-items: center; gap: 12px;
      font-size: 14.5px; color: var(--tx2);
    }
    .feat-list__dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: linear-gradient(135deg, var(--teal), var(--ind)); flex-shrink: 0;
      box-shadow: 0 0 10px rgba(34,211,238,0.5);
    }
    .feat-row__link {
      font-size: 14px; font-weight: 700; color: var(--teal); text-decoration: none;
      display: inline-flex; align-items: center; gap: 6px;
      transition: gap 150ms, color 150ms;
    }
    .feat-row__link:hover { color: #67e8f9; gap: 10px; }

    /* ── Stats ────────────────────────────────────────────────────────── */
    .stats-band {
      padding: 56px 24px;
      background: linear-gradient(135deg, rgba(37,99,235,0.05) 0%, rgba(15,118,110,0.05) 100%);
      border-top: 1px solid var(--bdr); border-bottom: 1px solid var(--bdr);
    }
    .stats-band__inner {
      max-width: 1000px; margin: 0 auto;
      display: flex; align-items: center; justify-content: center;
      flex-wrap: wrap; gap: 0;
    }
    .stats-band__item { text-align: center; padding: 0 32px; }
    .stats-num {
      display: block; font-size: 36px; font-weight: 900; letter-spacing: -0.03em;
      background: linear-gradient(135deg, var(--teal), var(--ind));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    .stats-lbl { font-size: 12px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--dim); margin-top: 4px; display: block; }
    .stats-band__div { width: 1px; height: 50px; background: var(--bdr); }
    @media(max-width: 600px) {
      .stats-band__inner { gap: 16px; }
      .stats-band__div { display: none; }
      .stats-band__item { padding: 8px 16px; }
    }

    /* ── CTA Band ─────────────────────────────────────────────────────── */
    .cta-band { padding: 100px 24px; position: relative; overflow: hidden; background: var(--bg); }
    .cta-band__glow {
      position: absolute; width: 600px; height: 400px; z-index: 0;
      top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: radial-gradient(ellipse, rgba(34,211,238,0.2) 0%, rgba(129,140,248,0.15) 40%, transparent 70%);
      filter: blur(40px);
    }
    .cta-band__inner {
      position: relative; z-index: 1;
      max-width: 680px; margin: 0 auto; text-align: center;
      background: rgba(255,255,255,0.92); border: 1px solid var(--bdr);
      backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
      border-radius: 28px; padding: 64px 40px;
      box-shadow: 0 0 40px rgba(37,99,235,0.05) inset, 0 20px 40px rgba(15,23,42,0.10);
    }
    .cta-band__h2 {
      font-size: clamp(24px,3.5vw,38px); font-weight: 900; letter-spacing: -0.025em; margin: 0 0 14px;
    }
    .cta-band__sub { font-size: 16px; color: var(--muted); margin: 0 0 36px; line-height: 1.65; }
    .cta-band__btns { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
  `]
})
export class LandingPage {
  private route = inject(ActivatedRoute);
  private i18n = inject(TranslocoService);

  img = IMG;

  constructor(seo: SeoService) {
    const locale = (this.route.snapshot.parent?.data['locale'] as 'en' | 'fr') ?? 'en';
    // selectTranslate (not translate()) waits for the translation to
    // actually be loaded — translate() returns synchronously and would
    // bake in the raw key if this runs before loading finishes, which it
    // reliably does during prerendering.
    combineLatest([
      this.i18n.selectTranslate('landing.seoTitle'),
      this.i18n.selectTranslate('landing.seoDescription'),
    ]).subscribe(([title, description]) => {
      seo.setPage({ title, description, path: '/', locale });
    });
  }
}
