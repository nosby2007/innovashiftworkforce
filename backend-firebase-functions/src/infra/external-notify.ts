/**
 * Placeholder: external notifications (email/SMS).
 * - For production: integrate SendGrid/Mailgun for email, Twilio for SMS.
 * - Use secrets / environment config, do NOT hardcode credentials.
 */
export async function externalNotify(payload: {
  channel: 'email'|'sms';
  to: string;
  subject?: string;
  message: string;
  meta?: any;
}) {
  // Intentionally NO-OP for MVP.
  console.log('[externalNotify placeholder]', payload);
  return { ok: true };
}
