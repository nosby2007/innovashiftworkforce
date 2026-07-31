import { Injectable } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { MatSnackBar } from '@angular/material/snack-bar';
import { filter } from 'rxjs/operators';

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * The service worker caches app-shell assets (index.html, *.js, *.css) at
 * "prefetch" install mode — once installed, a browser keeps serving those
 * cached files on every load regardless of HTTP cache headers, until a new
 * SW version is both downloaded AND activated. Angular downloads updates in
 * the background but never activates/reloads on its own, so without this,
 * every deploy is invisible to anyone who doesn't fully close and reopen
 * their browser tab — this prompts (rather than force-reloading, so an
 * admin mid-form doesn't lose unsaved work) as soon as a new version is
 * ready, and polls periodically for anyone who leaves a tab open.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  constructor(private swUpdate: SwUpdate, private snackBar: MatSnackBar) {}

  init(): void {
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates
      .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
      .subscribe(() => this.promptReload());

    setInterval(() => {
      this.swUpdate.checkForUpdate().catch(() => {});
    }, CHECK_INTERVAL_MS);
  }

  private promptReload(): void {
    const ref = this.snackBar.open('A new version of InnovaShift is available.', 'Reload', {
      horizontalPosition: 'right',
      verticalPosition: 'top',
      panelClass: ['vs-snack', 'vs-snack--info'],
    });
    ref.onAction().subscribe(() => document.location.reload());
  }
}
