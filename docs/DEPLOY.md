# Deploying to Firebase

Every push to `main` runs `.github/workflows/deploy.yml`, which builds the
frontend and functions and runs `firebase deploy` (hosting + functions +
Firestore rules/indexes + Storage rules) against the `atlanta-e04aa`
project. Until the one-time setup below is done, the workflow builds
successfully but **skips the deploy step** with a warning — it will not
fail loudly, it just won't ship anything.

## One-time setup (do this once, from your own Google account)

### 1. Create a deploy service account

In the [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts?project=atlanta-e04aa):

1. **IAM & Admin → Service Accounts → Create Service Account**.
   - Name: `github-actions-deploy` (or anything memorable).
2. Grant it these roles:
   - **Firebase Admin** (`roles/firebase.admin`) — covers Hosting,
     Functions, Firestore rules, Storage rules.
   - **Service Account User** (`roles/iam.serviceAccountUser`) — required
     so it can deploy Cloud Functions, which run under their own service
     account.
   - **Secret Manager Secret Accessor** (`roles/secretmanager.secretAccessor`)
     — required because several functions bind secrets via
     `defineSecret()` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
     `SENDGRID_API_KEY`, `ACTION_TOKEN_SECRET`); without this role,
     `firebase deploy` fails partway through with `Permission
     'secretmanager.secrets.get' denied` the first time it needs to read
     one of them.
3. Open the new service account → **Keys → Add Key → Create new key →
   JSON**. This downloads a `.json` file — treat it like a password, it
   grants deploy access to your whole project.

### 2. Add it as a GitHub secret

In the GitHub repo → **Settings → Secrets and variables → Actions → New
repository secret**:

- Name: `FIREBASE_SERVICE_ACCOUNT`
- Value: paste the **entire contents** of the JSON key file you just
  downloaded.

That's it — the next push to `main` (or a manual run via the **Actions**
tab → **Deploy → Run workflow**) will deploy for real.

### 3. Rotate/remove the key if it's ever exposed

If the JSON key is ever committed, pasted somewhere public, or you're
unsure whether it leaked, delete it immediately from **IAM & Admin →
Service Accounts → (the account) → Keys** and create a new one, then
update the GitHub secret.

## Things this workflow does *not* handle

A few pieces from earlier features need their own one-time setup and
aren't part of this deploy pipeline:

- **`ACTION_TOKEN_SECRET`** (push notification accept-links) — set via
  `firebase functions:secrets:set ACTION_TOKEN_SECRET` from your own
  machine with the Firebase CLI logged in (this is Firebase Secret
  Manager, not a GitHub secret, so CI can't set it for you).
- **`OPENAI_API_KEY`** (AI Copilot, `/admin/ai-copilot`, Pro plan and
  up) — an OpenAI API key from
  [platform.openai.com](https://platform.openai.com/api-keys). Verify
  the exact model id in `MODEL` (`callable/aiAssistantChat.ts` and
  `scheduled/dailyDigest.ts`, kept in sync between the two) still
  matches what's available on your account before relying on this in
  production — model ids shown in the ChatGPT app don't always match
  the API model id exactly.
  Set it the same way: `firebase functions:secrets:set OPENAI_API_KEY`.
  Uses the same **Secret Manager Secret Accessor** role on
  `github-actions-deploy` already granted above — nothing extra to add
  in IAM. The assistant only ever *proposes* shift actions (create,
  assign, publish, unassign); it calls the same audited callables the
  rest of the app uses, and only after an admin clicks Confirm in the
  UI — it never writes to Firestore directly.
- **Daily AI digest** (`dailyDigest` scheduled function) — runs every
  day at 8am America/New_York automatically once deployed, no extra
  setup beyond the same `OPENAI_API_KEY` above. For each active org
  it scans shifts starting in the next 3 days, and if any are unfilled
  it writes a summary + publish proposals to
  `orgs/{orgId}/aiDigests/{date}`, shown at the top of the AI Copilot
  page. The same run also flags staffing compliance risks over an
  ~8-day window (yesterday through next week): double-bookings, under
  8h rest between shifts, 7+ consecutive scheduled days, and 60+
  scheduled hours — informational only, no proposal attached, since
  fixing them is a judgment call for the admin. Orgs with full
  coverage and no alerts get no digest doc that day (no API call
  either — it's skipped entirely, not just hidden). When a digest is
  generated, admin-like staff (admin/manager/scheduler/hr) also get an
  in-app notification and a best-effort push (same infra as the other
  push notifications below) linking to `/admin/ai-copilot` — reuses
  their existing registered device tokens, no extra setup. On Mondays,
  the same run also checks the org's own `aiDigests` history over the
  last 8 weeks for a long-term understaffing trend (recent 4 weeks of
  problem-days vs the prior 4) and, if there's enough history, adds a
  `forecast` field with a direction (worsening/improving/stable) and a
  one-sentence AI outlook — shown as a callout on the AI Copilot page.
  Weekly rather than daily to keep the extra OpenAI call bounded;
  no extra setup beyond `OPENAI_API_KEY` above. Requires
  Cloud Scheduler to be enabled on the GCP project, which `firebase
  deploy` does automatically on first deploy of a scheduled function.
  If that first deploy fails with a permissions error creating the
  Cloud Scheduler job (separate from the Secret Manager one already
  fixed), grant `github-actions-deploy` the **Cloud Scheduler Admin**
  (`roles/cloudscheduler.admin`) role too — untested whether
  **Firebase Admin** alone already covers it on this project.
- **Web push VAPID key** — done (`VAPID_KEY` is set in
  `push-notifications.service.ts`).
- **Native push (Android)** — done. The app is registered in Firebase
  (App ID `1:404381833719:android:5df93f9adcee078f4d36f2`) and
  `google-services.json` is committed at
  `frontend-angular/android/app/google-services.json`. iOS still needs
  `GoogleService-Info.plist` from Firebase Console if/when that platform
  is built.
- **Two-factor authentication** — Firebase Console → Authentication →
  Sign-in method → Advanced → enable Multi-Factor Authentication + TOTP.
- **Stripe self-serve plan upgrades** (`/admin/org-settings` → Subscription
  & Plan, org admins upgrading their own org without a super admin) — needs
  three things beyond `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (already
  listed above):
  1. Create a **Product** in the [Stripe
     Dashboard](https://dashboard.stripe.com/products) with two recurring
     **Prices** — one for Starter ($49/mo to match the public pricing page),
     one for Pro ($149/mo).
  2. Set their price ids (`price_...`) via Secret Manager, same as the API
     keys above — not because they're sensitive (they aren't), but because
     it's the only config mechanism this repo's CI deploy pipeline actually
     delivers: a `.env` file would need to be committed, but the repo's
     `.gitignore` excludes `.env`/`.env.*` everywhere, so it would never
     reach the GitHub Actions checkout.
     ```
     firebase functions:secrets:set STRIPE_PRICE_STARTER
     firebase functions:secrets:set STRIPE_PRICE_PRO
     ```
     Until both are set, `stripeCreateCheckout` fails cleanly with a
     "Billing is not configured for the {plan} plan yet" error rather than
     silently no-oping. Uses the same **Secret Manager Secret Accessor**
     role already granted above — nothing extra to add in IAM.
  3. In the Stripe Dashboard, configure the **customer portal**
     (`stripeCreatePortal`'s target) — at minimum enable "Cancel
     subscription" and "Update payment method"; enabling "Switch plan"
     there too is optional but works out of the box, since the webhook
     already maps a portal-driven price change back to `starter`/`pro` via
     `infra/stripe-plans.ts`.
  Enterprise stays custom pricing sold through the demo-request flow, not
  Stripe Checkout — its pricing card links to Contact Sales, same as today.

## Android — deploy to testers (`android-distribute.yml`)

Every push to `main` that touches `frontend-angular/**` builds a debug
APK and uploads it to **Firebase App Distribution**, so testers get a
new build automatically without going through Play Store review. Setup,
both steps already done:

1. **Deploy service account has App Distribution access** — the
   `github-actions-deploy` service account has **Firebase App
   Distribution Admin** (`roles/firebaseappdistro.admin`) in addition to
   Firebase Admin, granted from
   [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=atlanta-e04aa).
2. **Tester group** — Firebase Console → App Distribution → Testers &
   Groups → group named `internal-testers` (matches `groups:` in
   `android-distribute.yml`), with testers added to it.
3. **`FIREBASE_ANDROID_APP_ID` secret** — GitHub repo → Settings →
   Secrets and variables → Actions → New repository secret. Value is the
   Android app ID from Firebase Console → Project Settings → Your apps
   (format `1:...:android:...`). Not sensitive on its own, but kept as a
   secret rather than hardcoded so the workflow isn't tied to one app
   registration.

Note: the workflow uploads via the
[`wzieba/Firebase-Distribution-Github-Action`](https://github.com/wzieba/Firebase-Distribution-Github-Action)
action, not `firebase-tools`' own `appdistribution:distribute` CLI
command — that command doesn't reliably authenticate in CI (confirmed:
it failed with "Failed to authenticate, have you run firebase login?"
even with a valid service account key passed via
`GOOGLE_APPLICATION_CREDENTIALS` and via `--service-account-json`).

This ships a **debug-signed APK** — fine for internal testers, but not
suitable for the Play Store. A real Play Store release needs a release
signing keystore (store it as a GitHub secret, never commit it) wired
into `frontend-angular/android/app/build.gradle`'s `signingConfigs`, plus
switching the workflow from `assembleDebug` to `assembleRelease` and
adding the Play Console publishing step separately.

## Firestore indexes

`firestore.indexes.json` is the source of truth `firebase deploy` uses —
it's declared in `firebase.json` and deployed automatically alongside
rules/functions/hosting on every push to `main`, no `--only` flag needed.

If a deploy ever fails with `firestore: there are N indexes defined in
your project that are not present in your firestore indexes file`, it
means someone (often via a "This query requires an index" error link
in the Firebase Console or Cloud Functions logs) created a composite
index directly in the console without it ever being added to this file.
**Do not pass `--force`** to fix this — that flag tells the CLI to
*delete* those live indexes, which is destructive and will break
whatever query needed them. Instead, sync the file to match reality:

```bash
firebase login
firebase firestore:indexes --project atlanta-e04aa > firestore.indexes.json
```

This is a **read-only** pull (it only lists what's currently live, no
writes), so it's always safe to run. Review the diff, commit it, and
the next deploy will succeed without needing `--force`.

## Manual deploy (without CI)

If you ever need to deploy from your own machine instead:

```bash
firebase login
cd frontend-angular && npm run build && cd ..
firebase deploy --project atlanta-e04aa
```
