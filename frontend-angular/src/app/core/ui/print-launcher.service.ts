import { Injectable } from '@angular/core';
import { Params, Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class PrintLauncherService {
  constructor(private router: Router) {}

  open(path: string, queryParams: Params = {}, title = 'print'): void {
    if (typeof window === 'undefined') return;
    const tree = this.router.createUrlTree([path], {
      queryParams: { ...queryParams, print: '1' },
    });
    const url = this.router.serializeUrl(tree);
    const absoluteUrl = new URL(url, window.location.origin).toString();
    const features = [
      'popup=yes',
      'toolbar=no',
      'menubar=no',
      'location=yes',
      'status=no',
      'scrollbars=yes',
      'resizable=yes',
      'width=1180',
      'height=920',
    ].join(',');
    const popup = window.open(absoluteUrl, `innovashift-${title}`, features);
    if (popup) {
      popup.focus();
      return;
    }
    void this.router.navigateByUrl(url);
  }
}
