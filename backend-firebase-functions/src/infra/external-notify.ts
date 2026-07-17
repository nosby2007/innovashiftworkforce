import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import sgMail from '@sendgrid/mail';

export const sendgridApiKey = defineSecret('SENDGRID_API_KEY');

const FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL || 'contact@innovacarereview.com';
const FROM_NAME = process.env.NOTIFY_FROM_NAME || 'InnovaShift Workforce';
const REPLY_TO_EMAIL = process.env.NOTIFY_REPLY_TO_EMAIL || 'contact@innovacarereview.com';
const LOGO_URL = process.env.NOTIFY_LOGO_URL ||
  'https://res.cloudinary.com/dtdpx59sc/image/upload/c_limit,w_640,q_auto,f_png/v1784264081/ChatGPT_Image_Jul_14_2026_06_56_50_PM_sekkmd.png';
const APP_URL = process.env.NOTIFY_APP_URL || 'https://atlanta-e04aa.web.app';

let sgConfigured = false;

export interface ExternalEmailPresentation {
  badge?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}

export interface ExternalNotifyPayload {
  channel: 'email' | 'sms';
  to: string;
  subject?: string;
  message: string;
  meta?: unknown;
  presentation?: ExternalEmailPresentation;
}

export interface ExternalNotifyResult {
  ok: boolean;
  sent: boolean;
  channel?: 'email' | 'sms';
  reason?: string;
  statusCode?: number;
  providerMessageId?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeUrl(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return 'invalid-email';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

function sanitizeProviderBody(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value).slice(0, 2000);
  } catch {
    return String(value).slice(0, 2000);
  }
}

export function renderEmailHtml(input: {
  subject: string;
  message: string;
  presentation?: ExternalEmailPresentation;
}): string {
  const safeSubject = escapeHtml(input.subject);
  const safeMessage = escapeHtml(input.message)
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '<br>');
  const safeBadge = escapeHtml(input.presentation?.badge || 'Workforce notification');
  const safeCtaLabel = escapeHtml(input.presentation?.ctaLabel || 'Open InnovaShift');
  const ctaUrl = escapeHtml(safeUrl(input.presentation?.ctaUrl, APP_URL));
  const safeFooterNote = escapeHtml(
    input.presentation?.footerNote ||
      'This operational message was sent because your email address is associated with an InnovaShift organization.'
  );
  const year = new Date().getFullYear();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${safeSubject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f7fb;font-family:Arial,Helvetica,sans-serif;color:#172033;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeSubject}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f7fb;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(16,42,67,.10);">
          <tr>
            <td align="center" bgcolor="#072f68" style="padding:26px 28px 22px;background-color:#072f68;background-image:linear-gradient(135deg,#072f68 0%,#0878cf 100%);">
              <img src="${escapeHtml(LOGO_URL)}" width="320" alt="InnovaShift - Smart Workforce Scheduling" style="display:block;width:100%;max-width:320px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;">
            </td>
          </tr>
          <tr><td style="height:5px;background-color:#55b800;"></td></tr>
          <tr>
            <td style="padding:38px 38px 20px;">
              <div style="display:inline-block;padding:7px 12px;margin-bottom:18px;border-radius:999px;background:#eaf5ff;color:#0868b5;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">${safeBadge}</div>
              <h1 style="margin:0 0 18px;color:#102a43;font-size:26px;line-height:1.25;font-weight:700;">${safeSubject}</h1>
              <div style="margin:0;color:#425466;font-size:16px;line-height:1.75;">${safeMessage}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 38px 38px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" bgcolor="#0878cf" style="border-radius:10px;">
                    <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;border-radius:10px;">${safeCtaLabel}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 38px 34px;">
              <div style="padding:17px 18px;background:#f4f8fb;border-left:4px solid #55b800;border-radius:8px;color:#52616f;font-size:13px;line-height:1.6;">For assistance, reply to this email or contact your organization administrator.</div>
            </td>
          </tr>
          <tr>
            <td align="center" bgcolor="#0b2341" style="padding:24px 28px;background:#0b2341;color:#c9d7e5;font-size:12px;line-height:1.6;">
              <strong style="color:#ffffff;">InnovaShift Workforce</strong><br>
              Smart Workforce Scheduling<br><br>
              &copy; ${year} InnovaCare Review. All rights reserved.<br>
              <a href="${escapeHtml(APP_URL)}" style="color:#7ec8ff;text-decoration:none;">Access InnovaShift</a>
            </td>
          </tr>
        </table>
        <div style="max-width:620px;padding:18px 20px 0;color:#7b8794;font-size:11px;line-height:1.5;text-align:center;">${safeFooterNote}</div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * External notifications. Email is delivered through SendGrid. SMS remains
 * inactive until an SMS provider is configured.
 */
export async function externalNotify(payload: ExternalNotifyPayload): Promise<ExternalNotifyResult> {
  if (payload.channel === 'sms') {
    logger.info('[externalNotify] SMS provider is not configured - skipped.', { meta: payload.meta });
    return { ok: true, sent: false, channel: 'sms' };
  }

  const apiKey = sendgridApiKey.value();
  if (!apiKey) {
    logger.warn('[externalNotify] SENDGRID_API_KEY is missing - email skipped.', {
      to: maskEmail(payload.to),
      subject: payload.subject,
    });
    return { ok: false, sent: false, reason: 'missing-sendgrid-api-key' };
  }

  if (!sgConfigured) {
    sgMail.setApiKey(apiKey);
    sgConfigured = true;
  }

  const subject = payload.subject?.trim() || 'Notification from InnovaShift Workforce';

  try {
    const [response] = await sgMail.send({
      to: payload.to,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      replyTo: { email: REPLY_TO_EMAIL, name: 'InnovaShift Support' },
      subject,
      text: payload.message,
      html: renderEmailHtml({
        subject,
        message: payload.message,
        presentation: payload.presentation,
      }),
    });

    const headers = response.headers as Record<string, string | string[] | undefined>;
    const rawMessageId = headers?.['x-message-id'];
    const providerMessageId = Array.isArray(rawMessageId) ? rawMessageId[0] : rawMessageId || null;

    logger.info('[externalNotify] SendGrid email accepted', {
      to: maskEmail(payload.to),
      from: FROM_EMAIL,
      subject,
      statusCode: response.statusCode,
      providerMessageId,
    });

    return {
      ok: true,
      sent: true,
      statusCode: response.statusCode,
      providerMessageId,
    };
  } catch (error: any) {
    logger.error('[externalNotify] SendGrid send failed', {
      to: maskEmail(payload.to),
      from: FROM_EMAIL,
      subject,
      statusCode: error?.code || error?.response?.statusCode || null,
      responseBody: sanitizeProviderBody(error?.response?.body),
      message: error?.message || 'Unknown SendGrid error',
    });

    return {
      ok: false,
      sent: false,
      reason: 'sendgrid-send-failed',
      statusCode: Number(error?.code || error?.response?.statusCode) || undefined,
    };
  }
}
