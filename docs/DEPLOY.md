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
- **`ANTHROPIC_API_KEY`** (AI Copilot, `/admin/ai-copilot`, Pro plan and
  up) — an Anthropic API key from
  [console.anthropic.com](https://console.anthropic.com/settings/keys).
  Set it the same way: `firebase functions:secrets:set ANTHROPIC_API_KEY`.
  Uses the same **Secret Manager Secret Accessor** role on
  `github-actions-deploy` already granted above — nothing extra to add
  in IAM. The assistant only ever *proposes* shift actions (create,
  assign, publish, unassign); it calls the same audited callables the
  rest of the app uses, and only after an admin clicks Confirm in the
  UI — it never writes to Firestore directly.
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

## Manual deploy (without CI)

If you ever need to deploy from your own machine instead:

```bash
firebase login
cd frontend-angular && npm run build && cd ..
firebase deploy --project atlanta-e04aa
```
