import { Injectable } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Server-only counterpart to TranslocoHttpLoader. Node's HTTP client (both
 * the xhr2 polyfill and native fetch) needs a real absolute origin to
 * resolve a request — there's no browser location to resolve a leading-
 * slash URL like '/assets/i18n/en.json' against — so during prerendering
 * these loads either silently fail or throw. Assets are already on disk in
 * the same build output that the server bundle runs from, so reading them
 * directly sidesteps the network layer entirely.
 *
 * Reads synchronously and wraps the result in an already-resolved promise.
 * A genuinely async read (fs/promises, or even callback-style fs.readFile)
 * depends on NgZone correctly tracking it as a pending macrotask before
 * Angular's SSR stability check decides the app is idle and snapshots the
 * render — in practice that tracking doesn't reliably cover the render
 * pipeline's own zone context here, so the snapshot can be taken before the
 * read finishes. A sync read removes the race entirely: by the time any
 * component asks for a translation, the data already exists. See docs/SSR.md.
 */
@Injectable({ providedIn: 'root' })
export class TranslocoServerLoader implements TranslocoLoader {
  getTranslation(lang: string): Promise<Translation> {
    // Server bundle runs from dist/innovacare-shift-frontend/server/main.js;
    // assets are copied into the sibling browser/ output directory.
    const assetPath = join(__dirname, '../browser/assets/i18n', `${lang}.json`);
    const content = readFileSync(assetPath, 'utf8');
    return Promise.resolve(JSON.parse(content));
  }
}
