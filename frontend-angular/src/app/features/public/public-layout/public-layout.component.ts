import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-public-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="pub-nav" id="pub-navbar">
      <div class="pub-nav__inner">
        <a routerLink="/" class="pub-nav__brand" id="pub-nav-brand">
          <div class="pub-nav__logo">IS</div>
          <span class="pub-nav__name">INNO<span class="pub-nav__accent">VASHIFT</span></span>
        </a>
        <nav class="pub-nav__links">
          <a routerLink="/features" routerLinkActive="active" class="pub-nav__link" id="nav-features">Features</a>
          <a routerLink="/pricing"  routerLinkActive="active" class="pub-nav__link" id="nav-pricing">Pricing</a>
          <a routerLink="/contact"  routerLinkActive="active" class="pub-nav__link" id="nav-contact">Contact</a>
        </nav>
        <div class="pub-nav__actions">
          <a routerLink="/login"   class="pub-nav__signin" id="nav-signin">Sign in</a>
          <a routerLink="/contact" class="pub-nav__cta"    id="nav-get-started">Get Started</a>
        </div>
        <button class="pub-nav__burger" [class.open]="open" (click)="open=!open" id="pub-hamburger" aria-label="Menu">
          <span></span><span></span><span></span>
        </button>
      </div>
      <div class="pub-nav__drawer" [class.open]="open" id="pub-mobile-menu">
        <a routerLink="/features" (click)="open=false" class="pub-nav__dl">Features</a>
        <a routerLink="/pricing"  (click)="open=false" class="pub-nav__dl">Pricing</a>
        <a routerLink="/contact"  (click)="open=false" class="pub-nav__dl">Contact</a>
        <a routerLink="/login"    (click)="open=false" class="pub-nav__dl">Sign in</a>
        <a routerLink="/contact"  (click)="open=false" class="pub-nav__dcta">Get Started →</a>
      </div>
    </header>

    <main class="pub-main"><router-outlet></router-outlet></main>

    <footer class="pub-footer" id="pub-footer">
      <div class="pub-footer__inner">
        <div class="pub-footer__brand">
          <div class="pub-footer__logo">IS</div>
          <div>
            <div class="pub-footer__name">INNOVASHIFT</div>
            <div class="pub-footer__tag">Workforce Management Platform by Innovacare</div>
          </div>
        </div>
        <div class="pub-footer__cols">
          <div class="pub-footer__col">
            <p class="pub-footer__ht">Product</p>
            <a routerLink="/features" class="pub-footer__lk">Features</a>
            <a routerLink="/pricing"  class="pub-footer__lk">Pricing</a>
            <a routerLink="/contact"  class="pub-footer__lk">Request Demo</a>
          </div>
          <div class="pub-footer__col">
            <p class="pub-footer__ht">Company</p>
            <a routerLink="/contact" class="pub-footer__lk">Contact</a>
            <a routerLink="/"        class="pub-footer__lk">About</a>
          </div>
          <div class="pub-footer__col">
            <p class="pub-footer__ht">Workspace</p>
            <a routerLink="/login"     class="pub-footer__lk">Employee Login</a>
            <a routerLink="/admin" class="pub-footer__lk">Admin Portal</a>
          </div>
        </div>
      </div>
      <div class="pub-footer__bottom">
        <span>© {{ year }} INNOVASHIFT · Healthcare Workforce Management</span>
      </div>
    </footer>
  `,
  styles: [`
    :host { display:flex; flex-direction:column; min-height:100vh;
      --bg:#f8fbff; --bg2:#eef4fb; --surf:rgba(255,255,255,0.90);
      --bdr:rgba(15,23,42,0.10); --teal:#1d4ed8; --ind:#0f766e; --rose:#f43f5e;
      --tx:#0f172a; --mt:#475569; --dm:#64748b;
    }
    /* Nav */
    .pub-nav { position:sticky; top:0; z-index:100;
      background:rgba(248,251,255,0.86); backdrop-filter:blur(24px);
      -webkit-backdrop-filter:blur(24px); border-bottom:1px solid var(--bdr); }
    .pub-nav__inner { max-width:1200px; margin:0 auto; padding:0 24px;
      height:64px; display:flex; align-items:center; gap:28px; }
    .pub-nav__brand { display:flex; align-items:center; gap:10px; text-decoration:none; flex-shrink:0; }
    .pub-nav__logo { width:36px; height:36px; border-radius:10px;
      background:linear-gradient(135deg,var(--teal),var(--ind)); display:flex;
      align-items:center; justify-content:center; font-size:13px; font-weight:900;
      color:#fff; box-shadow:0 0 20px rgba(34,211,238,0.4); }
    .pub-nav__name { font-size:17px; font-weight:900; letter-spacing:-0.02em; color:var(--tx); }
    .pub-nav__accent { color:var(--teal); }
    .pub-nav__links { display:flex; align-items:center; gap:2px; flex:1; }
    .pub-nav__link { padding:6px 14px; border-radius:8px; text-decoration:none;
      font-size:14px; font-weight:500; color:var(--mt); transition:color 150ms,background 150ms; }
    .pub-nav__link:hover,.pub-nav__link.active { color:var(--tx); background:#ffffff; box-shadow:0 0 0 1px var(--bdr) inset; }
    .pub-nav__actions { display:flex; align-items:center; gap:8px; }
    .pub-nav__signin { padding:7px 14px; border-radius:8px; text-decoration:none;
      font-size:14px; font-weight:600; color:var(--mt); transition:color 150ms; }
    .pub-nav__signin:hover { color:var(--tx); }
    .pub-nav__cta { padding:8px 18px; border-radius:9px; text-decoration:none;
      font-size:14px; font-weight:700; background:linear-gradient(135deg,var(--teal),var(--ind));
      color:#fff; box-shadow:0 4px 20px rgba(34,211,238,0.3); transition:transform 150ms,box-shadow 150ms; }
    .pub-nav__cta:hover { transform:translateY(-1px); box-shadow:0 6px 24px rgba(34,211,238,0.5); }
    .pub-nav__burger { display:none; flex-direction:column; gap:5px; background:none;
      border:none; cursor:pointer; padding:4px; margin-left:auto; }
    .pub-nav__burger span { display:block; width:22px; height:2px; background:var(--mt);
      border-radius:2px; transition:all 250ms; }
    .pub-nav__burger.open span:nth-child(1) { transform:translateY(7px) rotate(45deg); }
    .pub-nav__burger.open span:nth-child(2) { opacity:0; }
    .pub-nav__burger.open span:nth-child(3) { transform:translateY(-7px) rotate(-45deg); }
    .pub-nav__drawer { display:none; flex-direction:column; gap:2px; padding:10px 24px 14px; border-top:1px solid var(--bdr); }
    .pub-nav__drawer.open { display:flex; }
    .pub-nav__dl { padding:10px 4px; text-decoration:none; font-size:15px; font-weight:500;
      color:var(--mt); border-bottom:1px solid var(--bdr); }
    .pub-nav__dcta { margin-top:10px; padding:12px; text-align:center; border-radius:10px;
      text-decoration:none; background:linear-gradient(135deg,var(--teal),var(--ind)); color:#fff; font-weight:700; }
    @media(max-width:768px){.pub-nav__links,.pub-nav__actions{display:none}.pub-nav__burger{display:flex}}
    /* Main */
    .pub-main { flex:1; }
    /* Footer */
    .pub-footer { background:linear-gradient(180deg, #f8fbff 0%, #eef4fb 100%); border-top:1px solid var(--bdr); padding:48px 24px 20px; }
    .pub-footer__inner { max-width:1200px; margin:0 auto; display:flex; flex-wrap:wrap;
      gap:40px; justify-content:space-between; padding-bottom:28px; border-bottom:1px solid var(--bdr); }
    .pub-footer__brand { display:flex; align-items:flex-start; gap:12px; }
    .pub-footer__logo { width:38px; height:38px; border-radius:10px;
      background:linear-gradient(135deg,var(--teal),var(--ind)); display:flex; align-items:center;
      justify-content:center; font-size:13px; font-weight:900; color:#fff; flex-shrink:0; box-shadow:0 0 15px rgba(34,211,238,0.3); }
    .pub-footer__name { font-size:15px; font-weight:900; color:var(--tx); }
    .pub-footer__tag  { font-size:11px; color:var(--dm); margin-top:3px; }
    .pub-footer__cols { display:flex; gap:48px; flex-wrap:wrap; }
    .pub-footer__col  { display:flex; flex-direction:column; gap:9px; }
    .pub-footer__ht { margin:0; font-size:11px; font-weight:800; text-transform:uppercase;
      letter-spacing:0.10em; color:var(--dm); }
    .pub-footer__lk { font-size:13px; color:var(--mt); text-decoration:none; transition:color 150ms; }
    .pub-footer__lk:hover { color:var(--tx); }
    .pub-footer__bottom { max-width:1200px; margin:16px auto 0; font-size:12px; color:var(--dm); }
  `]
})
export class PublicLayoutComponent {
  open = false;
  year = new Date().getFullYear();
}
