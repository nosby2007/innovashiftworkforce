import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import sgMail from '@sendgrid/mail';

export const sendgridApiKey = defineSecret('SENDGRID_API_KEY');
const FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL || 'no-reply@innovashiftworkforce.com';

let sgConfigured = false;

/**
 * External notifications (email/SMS).
 * - Email is sent via SendGrid, gated on SENDGRID_API_KEY being bound to the
 *   calling function via {secrets: [sendgridApiKey]}.
 * - SMS remains a NO-OP placeholder until a provider (e.g. Twilio) is chosen.
 */
export async function externalNotify(payload: {
  channel: 'email'|'sms';
  to: string;
  subject?: string;
  message: string;
  meta?: any;
}) {
  if (payload.channel === 'sms') {
    logger.info('[externalNotify] SMS not yet wired to a provider — skipped.', payload);
    return { ok: true, sent: false };
  }

  const apiKey = sendgridApiKey.value();
  if (!apiKey) {
    logger.warn('[externalNotify] SENDGRID_API_KEY not set — email skipped.', { to: payload.to, subject: payload.subject });
    return { ok: true, sent: false };
  }

  if (!sgConfigured) {
    sgMail.setApiKey(apiKey);
    sgConfigured = true;
  }

  try {
    await sgMail.send({
      to: payload.to,
      from: FROM_EMAIL,
      subject: payload.subject || 'Notification from InnovaShift Workforce',
      text: payload.message,
    });
    return { ok: true, sent: true };
  } catch (err) {
    logger.error('[externalNotify] SendGrid send failed', err);
    return { ok: false, sent: false };
  }
}
