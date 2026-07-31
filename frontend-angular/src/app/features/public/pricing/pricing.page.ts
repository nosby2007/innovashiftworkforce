import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { combineLatest } from 'rxjs';
import { SeoService } from '../../../core/seo/seo.service';

const PLANS = [
  {
    id: 'starter',
    name: 'publicPricing.starterName',
    price: '$49',
    period: '/month',
    desc: 'publicPricing.starterDesc',
    badge: null,
    color: 'rgba(99,102,241,0.18)',
    features: [
      'publicPricing.starterFeat1',
      'publicPricing.starterFeat2',
      'publicPricing.starterFeat3',
      'publicPricing.starterFeat4',
      'publicPricing.starterFeat5',
      'publicPricing.starterFeat6',
    ],
    cta: 'publicPricing.starterCta',
    ctaLink: '/contact',
  },
  {
    id: 'pro',
    name: 'publicPricing.proName',
    price: '$149',
    period: '/month',
    desc: 'publicPricing.proDesc',
    badge: 'publicPricing.proBadge',
    color: 'rgba(99,102,241,0.28)',
    features: [
      'publicPricing.proFeat1',
      'publicPricing.proFeat2',
      'publicPricing.proFeat3',
      'publicPricing.proFeat4',
      'publicPricing.proFeat5',
      'publicPricing.proFeat6',
      'publicPricing.proFeat7',
      'publicPricing.proFeat8',
    ],
    cta: 'publicPricing.proCta',
    ctaLink: '/contact',
  },
  {
    id: 'enterprise',
    name: 'publicPricing.enterpriseName',
    price: 'Custom',
    period: '',
    desc: 'publicPricing.enterpriseDesc',
    badge: null,
    color: 'rgba(244,114,182,0.12)',
    features: [
      'publicPricing.enterpriseFeat1',
      'publicPricing.enterpriseFeat2',
      'publicPricing.enterpriseFeat3',
      'publicPricing.enterpriseFeat4',
      'publicPricing.enterpriseFeat5',
      'publicPricing.enterpriseFeat6',
      'publicPricing.enterpriseFeat7',
    ],
    cta: 'publicPricing.enterpriseCta',
    ctaLink: '/contact',
  },
];

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [RouterLink, TranslocoModule],
  template: `
    <div class="price-page">
      <div class="orb orb-a" aria-hidden="true"></div>
      <div class="orb orb-b" aria-hidden="true"></div>

      <!-- Header -->
      <section class="price-hero" id="pricing-hero">
        <div class="price-hero__inner">
          <div class="label">{{ 'publicPricing.kicker' | transloco }}</div>
          <h1 class="price-hero__h1">{{ 'publicPricing.h1Line1' | transloco }}<br><span class="grad">{{ 'publicPricing.h1Grad' | transloco }}</span></h1>
          <p class="price-hero__sub">{{ 'publicPricing.sub' | transloco }}</p>
        </div>
      </section>

      <!-- Cards -->
      <section class="price-cards" id="pricing-cards">
        <div class="price-cards__inner">
          @for (plan of plans; track plan.id) {
            <div class="price-card" [class.popular]="plan.badge" [id]="'plan-' + plan.id">
              @if (plan.badge) {
                <div class="price-card__badge">{{ plan.badge | transloco }}</div>
              }
              <div class="price-card__name">{{ plan.name | transloco }}</div>
              <div class="price-card__price-row">
                <span class="price-card__price">{{ plan.price }}</span>
                <span class="price-card__period">{{ plan.period }}</span>
              </div>
              <p class="price-card__desc">{{ plan.desc | transloco }}</p>
              <div class="price-card__divider"></div>
              <ul class="price-card__features">
                @for (f of plan.features; track f) {
                  <li class="price-card__feat">
                    <span class="price-card__check">✓</span> {{ f | transloco }}
                  </li>
                }
              </ul>
              <a [routerLink]="plan.ctaLink" class="price-card__cta" [class.popular-cta]="plan.badge" [id]="'plan-cta-' + plan.id">
                {{ plan.cta | transloco }} →
              </a>
            </div>
          }
        </div>
      </section>

      <!-- App Preview -->
      <section class="price-preview" id="pricing-preview">
        <div class="price-preview__inner">
          <div class="price-preview__img-wrap">
             <div class="price-preview__img-glow" aria-hidden="true"></div>
             <img src="https://res.cloudinary.com/dtdpx59sc/image/upload/v1778892469/ChatGPT_Image_15_mai_2026_20_43_58_5_eaurcw.png" alt="Dashboard Preview" class="price-preview__img" loading="lazy" />
          </div>
        </div>
      </section>

      <!-- FAQ teaser -->
      <section class="price-faq" id="pricing-faq">
        <div class="price-faq__inner">
          <h2 class="price-faq__h2">{{ 'publicPricing.faqH2' | transloco }}</h2>
          <p class="price-faq__sub">{{ 'publicPricing.faqSub' | transloco }}</p>
          <a routerLink="../contact" class="btn-primary" id="pricing-contact-cta">{{ 'publicPricing.talkToSales' | transloco }}</a>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .price-page { background: #020617;
      color: #f8fafc; min-height:100vh; position:relative; overflow:hidden; }
    .orb { position:absolute; border-radius:50%; filter:blur(100px); pointer-events:none; z-index:0; }
    .orb-a { width:500px;height:500px; background:rgba(34,211,238,0.15); top:-80px;left:-100px; }
    .orb-b { width:400px;height:400px; background:rgba(129,140,248,0.12); bottom:0;right:-100px; }
    .btn-primary { display:inline-block; padding:13px 28px; border-radius:11px; text-decoration:none;
      background:linear-gradient(135deg,#22d3ee,#818cf8); color:#fff; font-weight:800; font-size:15px;
      box-shadow:0 4px 20px rgba(34,211,238,0.3); transition:transform 150ms,box-shadow 150ms; }
    .btn-primary:hover { transform:translateY(-2px); box-shadow:0 6px 28px rgba(34,211,238,0.45); }
    .label { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.12em;
      color:#22d3ee; margin-bottom:12px; }
    .grad { background:linear-gradient(135deg,#22d3ee,#818cf8);
      -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
    /* Hero */
    .price-hero { position:relative; z-index:1; padding:80px 24px 48px; text-align:center; }
    .price-hero__inner { max-width:640px; margin:0 auto; }
    .price-hero__h1 { font-size:clamp(32px,5vw,54px); font-weight:900; letter-spacing:-0.03em;
      line-height:1.08; margin:0 0 16px; color:#f8fafc; }
    .price-hero__sub { font-size:16px; color:#cbd5e1; margin:0; line-height:1.65; }
    /* Cards */
    .price-cards { position:relative; z-index:1; padding:40px 24px 80px; }
    .price-cards__inner { max-width:1040px; margin:0 auto;
      display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:20px;
      align-items:start; }
    .price-card { position:relative; background:rgba(255,255,255,0.03); backdrop-filter:blur(20px);
      border:1px solid rgba(255,255,255,0.08); border-radius:22px; padding:32px 28px;
      display:flex; flex-direction:column; gap:0; transition:transform 200ms,border-color 200ms,box-shadow 200ms;
      box-shadow:0 10px 30px rgba(0,0,0,0.5); }
    .price-card:hover { transform:translateY(-4px); border-color:rgba(129,140,248,0.3); box-shadow:0 15px 40px rgba(0,0,0,0.6); }
    .price-card.popular { border:1px solid rgba(34,211,238,0.4);
      box-shadow:0 10px 40px rgba(34,211,238,0.1), 0 0 40px rgba(34,211,238,0.05) inset; }
    .price-card__badge { position:absolute; top:-13px; left:50%; transform:translateX(-50%);
      background:linear-gradient(135deg,#22d3ee,#818cf8); color:#fff;
      font-size:11px; font-weight:800; letter-spacing:0.08em; text-transform:uppercase;
      padding:4px 14px; border-radius:100px; white-space:nowrap; }
    .price-card__name { font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:0.10em;
      color:#94a3b8; margin-bottom:14px; }
    .price-card__price-row { display:flex; align-items:baseline; gap:4px; margin-bottom:10px; }
    .price-card__price { font-size:44px; font-weight:900; letter-spacing:-0.03em;
      color:#f8fafc; }
    .price-card__period { font-size:14px; color:#94a3b8; font-weight:500; }
    .price-card__desc { font-size:13px; color:#cbd5e1; margin:0 0 20px; line-height:1.6; }
    .price-card__divider { height:1px; background:rgba(255,255,255,0.1); margin-bottom:20px; }
    .price-card__features { list-style:none; margin:0 0 28px; padding:0; display:flex; flex-direction:column; gap:11px; }
    .price-card__feat { font-size:13.5px; color:#e2e8f0; display:flex; align-items:flex-start; gap:10px; }
    .price-card__check { color:#22d3ee; font-weight:900; flex-shrink:0; margin-top:1px; }
    .popular .price-card__check { color:#818cf8; }
    .price-card__cta { display:block; text-align:center; padding:13px; border-radius:12px;
      text-decoration:none; font-weight:800; font-size:14px; margin-top:auto;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); box-shadow:0 1px 2px rgba(0,0,0,0.2);
      color:#cbd5e1; transition:background 150ms; }
    .price-card__cta:hover { background:rgba(255,255,255,0.1); border-color:rgba(255,255,255,0.2); }
    .price-card__cta.popular-cta { background:linear-gradient(135deg,#22d3ee,#818cf8);
      border-color:transparent; box-shadow:0 4px 20px rgba(34,211,238,0.3); color:#fff; }
    .price-card__cta.popular-cta:hover { box-shadow:0 6px 28px rgba(34,211,238,0.45); background:linear-gradient(135deg,#22d3ee,#818cf8); border-color:transparent; }
    /* Preview */
    .price-preview { padding: 40px 24px; position: relative; z-index: 1; }
    .price-preview__inner { max-width: 900px; margin: 0 auto; }
    .price-preview__img-wrap { position: relative; }
    .price-preview__img-glow {
      position: absolute; inset: -30px; z-index: 0;
      background: radial-gradient(ellipse at center, rgba(34,211,238,0.1) 0%, transparent 60%);
      border-radius: 50%; filter: blur(40px);
    }
    .price-preview__img {
      position: relative; z-index: 1; width: 100%; border-radius: 20px;
      box-shadow: 0 30px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1);
      transition: transform 400ms ease;
    }
    .price-preview__img:hover { transform: scale(1.02) translateY(-4px); }
    /* FAQ */
    .price-faq { position:relative; z-index:1; padding:20px 24px 80px; text-align:center; }
    .price-faq__inner { max-width:520px; margin:0 auto; }
    .price-faq__h2 { font-size:clamp(22px,3vw,30px); font-weight:900; letter-spacing:-0.02em; margin:0 0 12px; color:#f8fafc; }
    .price-faq__sub { font-size:15px; color:#cbd5e1; margin:0 0 28px; line-height:1.65; }
  `]
})
export class PricingPage {
  private route = inject(ActivatedRoute);
  private i18n = inject(TranslocoService);

  plans = PLANS;

  constructor(seo: SeoService) {
    const locale = (this.route.snapshot.parent?.data['locale'] as 'en' | 'fr') ?? 'en';
    combineLatest([
      this.i18n.selectTranslate('publicPricing.seoTitle'),
      this.i18n.selectTranslate('publicPricing.seoDescription'),
    ]).subscribe(([title, description]) => {
      seo.setPage({ title, description, path: '/pricing', locale });
    });
  }
}
