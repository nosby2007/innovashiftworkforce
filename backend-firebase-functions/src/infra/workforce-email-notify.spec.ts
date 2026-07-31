import { describe, expect, it } from 'vitest';
import { renderEmailHtml } from './external-notify';
import {
  DEFAULT_WORKFORCE_EMAIL_PREFERENCES,
  formatDurationMs,
  joinEmailLines,
  resolveEmailPreferences,
} from './workforce-email-notify';

describe('workforce email preferences', () => {
  it('uses enterprise-safe defaults when settings are missing', () => {
    expect(resolveEmailPreferences(undefined)).toEqual(DEFAULT_WORKFORCE_EMAIL_PREFERENCES);
    expect(DEFAULT_WORKFORCE_EMAIL_PREFERENCES.clockInManagers).toBe(false);
    expect(DEFAULT_WORKFORCE_EMAIL_PREFERENCES.clockOutManagers).toBe(false);
    expect(DEFAULT_WORKFORCE_EMAIL_PREFERENCES.callOutManagers).toBe(true);
  });

  it('honors explicit false values without changing unrelated defaults', () => {
    const preferences = resolveEmailPreferences({
      shiftAssignedEmployee: false,
      callOutManagers: false,
    });
    expect(preferences.shiftAssignedEmployee).toBe(false);
    expect(preferences.callOutManagers).toBe(false);
    expect(preferences.clockInEmployee).toBe(true);
    expect(preferences.shiftSwapDecisions).toBe(true);
  });
});

describe('workforce email formatting', () => {
  it('formats worked and break durations', () => {
    expect(formatDurationMs(0)).toBe('0 min');
    expect(formatDurationMs(30 * 60 * 1000)).toBe('30 min');
    expect(formatDurationMs(2 * 60 * 60 * 1000)).toBe('2 hr');
    expect(formatDurationMs((2 * 60 + 15) * 60 * 1000)).toBe('2 hr 15 min');
  });

  it('removes optional empty lines while preserving intentional spacing', () => {
    expect(joinEmailLines(['Hello', '', null, false, 'World'])).toBe('Hello\n\nWorld');
  });
});

describe('branded email HTML', () => {
  it('escapes user-controlled subject, message, badge, and CTA label', () => {
    const html = renderEmailHtml({
      subject: '<img src=x onerror=alert(1)>',
      message: '<script>alert(1)</script>',
      presentation: {
        badge: '<b>Alert</b>',
        ctaLabel: '<span>Open</span>',
        ctaUrl: 'javascript:alert(1)',
      },
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;Alert&lt;/b&gt;');
    expect(html).toContain('https://atlanta-e04aa.web.app');
  });

  it('uses the public Cloudinary InnovaShift logo', () => {
    const html = renderEmailHtml({ subject: 'Test', message: 'Message' });
    expect(html).toContain('res.cloudinary.com/dtdpx59sc/image/upload');
    expect(html).toContain('InnovaShift Workforce');
  });
});
