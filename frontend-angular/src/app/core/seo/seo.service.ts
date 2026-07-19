import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

export const SITE_URL = 'https://innovashiftworkforce.com';
export const SITE_NAME = 'InnovaShift Workforce';
const DEFAULT_OG_IMAGE = 'https://res.cloudinary.com/dtdpx59sc/image/upload/v1778890633/innovashift/ChatGPT_Image_15_mai_2026_20_13_13_10_pkzgj0.png';

export interface PageMeta {
  /** Page-specific title, without the site name suffix — that's added automatically. */
  title: string;
  description: string;
  /** Path starting with '/', e.g. '/features'. Used to build the canonical URL and og:url. */
  path: string;
  image?: string;
}

/**
 * Sets document title, meta description, canonical link, and Open
 * Graph/Twitter Card tags for the current route. Only meaningful for the
 * public marketing pages (landing/features/pricing/contact) — the
 * authenticated app shell has no reason to distinguish itself in search
 * results or link previews.
 *
 * Note: this only affects the DOM after Angular bootstraps and runs.
 * Crawlers/bots that don't execute JavaScript (most social-link-preview
 * unfurlers, some search engines) will only ever see index.html's static
 * defaults, not these per-route overrides — see docs note in index.html.
 * Prerendering the public routes is the real fix for that gap.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private titleService = inject(Title);
  private meta = inject(Meta);
  private doc = inject(DOCUMENT);

  setPage(page: PageMeta): void {
    const fullTitle = page.title.includes(SITE_NAME) ? page.title : `${page.title} | ${SITE_NAME}`;
    const url = `${SITE_URL}${page.path}`;
    const image = page.image || DEFAULT_OG_IMAGE;

    this.titleService.setTitle(fullTitle);

    this.meta.updateTag({ name: 'description', content: page.description });

    this.meta.updateTag({ property: 'og:title', content: fullTitle });
    this.meta.updateTag({ property: 'og:description', content: page.description });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ property: 'og:image', content: image });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:site_name', content: SITE_NAME });

    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title', content: fullTitle });
    this.meta.updateTag({ name: 'twitter:description', content: page.description });
    this.meta.updateTag({ name: 'twitter:image', content: image });

    this.setCanonical(url);
  }

  private setCanonical(url: string): void {
    let link = this.doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.doc.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }
}
