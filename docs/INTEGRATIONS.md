# External Notifications (Placeholder)

Step 8 includes a **NO-OP** external notification layer:
- `externalNotifyCallable` (callable function)
- `externalNotify()` stub in `src/infra/external-notify.ts`

## Production plan
### Email (SendGrid)
- Store SENDGRID_API_KEY as secret
- Implement SendGrid send
- Add templates

### SMS (Twilio)
- Store TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM as secrets
- Implement Twilio client send
- Compliance: opt-in/opt-out

## Important
Never store secrets in the repo. Use Firebase Functions secrets / env config.
