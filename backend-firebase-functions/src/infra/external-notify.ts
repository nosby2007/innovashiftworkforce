import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import sgMail from '@sendgrid/mail';

export const sendgridApiKey = defineSecret('SENDGRID_API_KEY');

const FROM_EMAIL =
  process.env.NOTIFY_FROM_EMAIL || 'contact@innovacarereview.com';

const FROM_NAME =
  process.env.NOTIFY_FROM_NAME || 'InnovaShift Workforce';

const LOGO_URL =
  process.env.NOTIFY_LOGO_URL ||
  'https://res.cloudinary.com/dtdpx59sc/image/upload/v1784264081/ChatGPT_Image_Jul_14_2026_06_56_50_PM_sekkmd.png';

const APP_URL =
  process.env.NOTIFY_APP_URL ||
  'https://atlanta-e04aa.web.app';

let sgConfigured = false;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createEmailHtml(input: {
  subject: string;
  message: string;
}): string {
  const safeSubject = escapeHtml(input.subject);
  const safeMessage = escapeHtml(input.message)
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '<br>');

  const year = new Date().getFullYear();

  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${safeSubject}</title>
</head>

<body style="
  margin:0;
  padding:0;
  background-color:#f3f7fb;
  font-family:Arial, Helvetica, sans-serif;
  color:#172033;
">
  <div style="
    display:none;
    max-height:0;
    overflow:hidden;
    opacity:0;
    color:transparent;
  ">
    ${safeSubject}
  </div>

  <table
    role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="background-color:#f3f7fb;"
  >
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            max-width:640px;
            background:#ffffff;
            border-radius:16px;
            overflow:hidden;
            box-shadow:0 8px 30px rgba(16, 42, 67, 0.10);
          "
        >
          <!-- Header -->
          <tr>
            <td
              align="center"
              style="
                padding:26px 28px 22px;
                background:linear-gradient(135deg, #072f68 0%, #0878cf 100%);
              "
            >
             <img
  src="${LOGO_URL}"
  width="320"
  alt="InnovaShift — Smart Workforce Scheduling"
  style="
    display:block;
    width:100%;
    max-width:320px;
    height:auto;
    margin:0 auto;
    border:0;
    outline:none;
    text-decoration:none;
  "
>
            </td>
          </tr>

          <!-- Accent -->
          <tr>
            <td style="
              height:5px;
              background:linear-gradient(
                90deg,
                #0878cf 0%,
                #0878cf 55%,
                #55b800 55%,
                #55b800 100%
              );
            "></td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:38px 38px 20px;">
              <div style="
                display:inline-block;
                padding:7px 12px;
                margin-bottom:18px;
                border-radius:999px;
                background:#eaf5ff;
                color:#0868b5;
                font-size:12px;
                font-weight:700;
                letter-spacing:0.5px;
                text-transform:uppercase;
              ">
                Workforce notification
              </div>

              <h1 style="
                margin:0 0 18px;
                color:#102a43;
                font-size:26px;
                line-height:1.25;
                font-weight:700;
              ">
                ${safeSubject}
              </h1>

              <div style="
                margin:0;
                color:#425466;
                font-size:16px;
                line-height:1.75;
              ">
                ${safeMessage}
              </div>
            </td>
          </tr>

          <!-- Call to action -->
          <tr>
            <td style="padding:18px 38px 38px;">
              <table
                role="presentation"
                cellspacing="0"
                cellpadding="0"
                border="0"
              >
                <tr>
                  <td
                    align="center"
                    bgcolor="#0878cf"
                    style="border-radius:10px;"
                  >
                    <a
                      href="${APP_URL}"
                      target="_blank"
                      style="
                        display:inline-block;
                        padding:14px 24px;
                        color:#ffffff;
                        text-decoration:none;
                        font-size:15px;
                        font-weight:700;
                        border-radius:10px;
                      "
                    >
                      Open InnovaShift
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Help box -->
          <tr>
            <td style="padding:0 38px 34px;">
              <div style="
                padding:17px 18px;
                background:#f4f8fb;
                border-left:4px solid #55b800;
                border-radius:8px;
                color:#52616f;
                font-size:13px;
                line-height:1.6;
              ">
                This message was sent through the InnovaShift
                Communication Center. For assistance, reply to this
                email or contact your organization administrator.
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td
              align="center"
              style="
                padding:24px 28px;
                background:#0b2341;
                color:#c9d7e5;
                font-size:12px;
                line-height:1.6;
              "
            >
              <strong style="color:#ffffff;">
                InnovaShift Workforce
              </strong>
              <br>
              Smart Workforce Scheduling
              <br><br>
              © ${year} InnovaCare Review. All rights reserved.
              <br>
              <a
                href="${APP_URL}"
                style="color:#7ec8ff; text-decoration:none;"
              >
                Access InnovaShift
              </a>
            </td>
          </tr>
        </table>

        <div style="
          max-width:620px;
          padding:18px 20px 0;
          color:#7b8794;
          font-size:11px;
          line-height:1.5;
          text-align:center;
        ">
          You are receiving this operational message because your email
          address is associated with an InnovaShift organization.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * External notifications.
 * Email is delivered through SendGrid.
 * SMS remains inactive until an SMS provider is configured.
 */
export async function externalNotify(payload: {
  channel: 'email' | 'sms';
  to: string;
  subject?: string;
  message: string;
  meta?: unknown;
}) {
  if (payload.channel === 'sms') {
    logger.info(
      '[externalNotify] SMS provider is not configured — skipped.',
      { meta: payload.meta }
    );

    return {
      ok: true,
      sent: false,
      channel: 'sms',
    };
  }

  const apiKey = sendgridApiKey.value();

  if (!apiKey) {
    logger.warn(
      '[externalNotify] SENDGRID_API_KEY is missing — email skipped.',
      {
        to: payload.to,
        subject: payload.subject,
      }
    );

    return {
      ok: false,
      sent: false,
      reason: 'missing-sendgrid-api-key',
    };
  }

  if (!sgConfigured) {
    sgMail.setApiKey(apiKey);
    sgConfigured = true;
  }

  const subject =
    payload.subject?.trim() ||
    'Notification from InnovaShift Workforce';

  try {
    const [response] = await sgMail.send({
      to: payload.to,

      from: {
        email: FROM_EMAIL,
        name: FROM_NAME,
      },

      replyTo: {
        email: 'contact@innovacarereview.com',
        name: 'InnovaShift Support',
      },

      subject,

      // Version texte pour les clients bloquant le HTML.
      text: payload.message,

      // Version professionnelle.
      html: createEmailHtml({
        subject,
        message: payload.message,
      }),
    });

    logger.info('[externalNotify] SendGrid email accepted', {
      to: payload.to,
      from: FROM_EMAIL,
      subject,
      statusCode: response.statusCode,
    });

    return {
      ok: true,
      sent: true,
      statusCode: response.statusCode,
    };
  } catch (error: any) {
    logger.error('[externalNotify] SendGrid send failed', {
      to: payload.to,
      from: FROM_EMAIL,
      subject,
      statusCode: error?.code || error?.response?.statusCode || null,
      responseBody: error?.response?.body || null,
      message: error?.message || 'Unknown SendGrid error',
    });

    return {
      ok: false,
      sent: false,
      reason: 'sendgrid-send-failed',
    };
  }
}
